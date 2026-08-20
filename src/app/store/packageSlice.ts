import { toast } from "sonner";
import {
  buildChecklistExport,
  type BuiltChecklistExport
} from "../../domain/checklistExport/buildChecklistExport";
import type {
  ChecklistExportOptions,
  ChecklistPdfExportOptions
} from "../../domain/checklistExport/types";
import { buildProjectPackage } from "../../domain/package/packageService";
import {
  finalizePackageImport,
  openSightlinesPackage,
  planPackageImport,
  validatePackageAssets,
  type ConflictResolution,
  type ImportPlan
} from "../../domain/package/importPackage";
import type { Artwork, Project } from "../../domain/project";
import { AssetNotFoundError } from "../../domain/repositories/assetRepository";
import { SYNC_PROTOCOL_VERSION } from "../../domain/repositories/syncMetaRepository";
import { syncHeadPath } from "../cloud/dropboxAuth";
import type { PackageExportMode } from "../../domain/schema/packageSchema";
import { migrateProjectJsonWithReport } from "../../domain/schema/projectSchema";
import type { AppState, AppStoreDeps } from "../store";
import { selectBackupFingerprint } from "./cloudBackupSlice";
import { BOOKKEEPING_MESSAGE } from "./cloudSyncSlice";
import { writeCloudBackupMeta } from "./cloudBackupMeta";
import { telemetry } from "../telemetry/telemetry";

// Set when the bytes being imported came from this account's own cloud backup
// (the cloud project browser), carrying the timestamp of the file that was
// downloaded. Absent for every other import path.
export type CloudRestoreContext = { lastBackupIso: string | null };

// Set when the bytes came from this account's own sync head and are meant to
// REPLACE the project already on this device (docs/cloud-sync-plan.md, "Replace
// mode is real new work"). This is the only context that authorizes overwriting
// an existing project, and the commit re-verifies its prerequisites rather than
// trusting them: a parked artwork review can sit open while the user keeps
// working.
export type SyncPullContext = {
  targetProjectId: string;
  // The rev of the downloaded head — becomes lastAcceptedRev at commit. Revs
  // are the whole lineage mechanism; without recording it the pulled copy would
  // read as diverged the moment it lands.
  rev: string;
  // The target's fingerprint when the pull was decided. The commit re-checks it
  // and aborts on drift, so an edit made while the review dialog was open is
  // never silently discarded.
  expectedLocalFingerprint: string;
};

// Set when the bytes came from a sync head for a project this device does NOT
// have yet (the cloud browser's device-handoff row). Identity-preserving, but
// nothing is replaced — the commit only seeds sync bookkeeping so the new
// device is linked from its first open.
export type SyncLinkContext = {
  projectId: string;
  rev: string;
};

// A parked import: the pure plan the dialog reviews, plus the provenance the
// commit still needs once the user resolves it. The plan alone is not enough —
// a cloud restore's bookkeeping (and its telemetry), or a pull's replace
// prerequisites, have to survive the park, which can end in a commit or a
// dismissal minutes later.
export type PendingPackageImport = {
  plan: ImportPlan;
  cloudRestore?: CloudRestoreContext;
  syncPull?: SyncPullContext;
  syncLink?: SyncLinkContext;
};

// The provenance half of an import, carried from the pipeline through any park
// to the commit. At most one sync context is ever set: a pull replaces a
// project that is here, a link imports one that is not.
type ImportProvenance = {
  cloudRestore?: CloudRestoreContext;
  syncPull?: SyncPullContext;
  syncLink?: SyncLinkContext;
};

export type PackageSliceActions = {
  importProjectJson: (text: string) => Promise<void>;
  // Builds a self-contained .sightlines package (docs/plan.md §6) for the
  // current project. Pure derivation lives in the domain layer; this action
  // wires it to the repositories and surfaces failures on the error banner,
  // returning the zip bytes + filename for the thin UI to download (no DOM here).
  exportProjectPackage: (
    mode: PackageExportMode
  ) => Promise<{ filename: string; zip: Uint8Array; warnings: string[] } | null>;
  // Same package build, for a project manager row that isn't necessarily the
  // open document — loads it via the repository instead of reading get().project.
  exportProjectPackageById: (
    id: string,
    mode: PackageExportMode
  ) => Promise<{ filename: string; zip: Uint8Array; warnings: string[] } | null>;
  // Builds the checklist spreadsheet (docs/export-spec.md §3.4) for the current
  // project. Same shape as exportProjectPackage: pure derivation in the domain
  // layer, repositories wired here, failures on the error banner, and the bytes
  // handed back for the thin UI to download (no DOM here).
  exportChecklistSpreadsheet: (
    options: ChecklistExportOptions
  ) => Promise<BuiltChecklistExport | null>;
  // The PDF sibling (docs/export-spec.md §3.5). Same contract and same return
  // shape as the spreadsheet action, so the UI's delivery path is one branch;
  // the builder is dynamically imported because it pulls pdf-lib, which
  // scripts/assert-chunk-graph.mjs keeps out of the entry closure.
  exportChecklistPdf: (
    options: ChecklistPdfExportOptions
  ) => Promise<BuiltChecklistExport | null>;
  // Runs the untrusted-file pipeline (docs/plan.md §13) over .sightlines
  // bytes. If §6 artwork conflicts need a decision, the import parks in
  // pendingPackageImport for the review dialog; otherwise it commits directly.
  importSightlinesPackage: (bytes: ArrayBuffer) => Promise<void>;
  // Same validation and merge pipeline, but always saves a fresh project id so
  // a Dropbox snapshot can never become the sender's identity on this device.
  importSharedSightlinesPackage: (bytes: ArrayBuffer) => Promise<boolean>;
  // A backup downloaded from the user's own connected cloud provider. Identity
  // is preserved by default — a project absent from this device should come
  // back as itself — and `asCopy` forces a fresh id when one that looks like it
  // is already here. Resolves true once the pipeline has accepted the package,
  // which includes parking in the artwork conflict dialog.
  importCloudBackupPackage: (
    bytes: ArrayBuffer,
    options?: { asCopy?: boolean; lastBackupIso?: string | null }
  ) => Promise<boolean>;
  // A package downloaded from this account's own sync head. `replace` supersedes
  // the OPEN project with the same id (recovery snapshot + drift re-check at
  // commit); `link` imports a project this device doesn't have yet. Both
  // preserve identity and record the head's rev, which is what keeps the two
  // devices one project. Resolves true once the pipeline has accepted the
  // package — including when it parked in the artwork conflict dialog.
  importSyncHeadPackage: (
    bytes: ArrayBuffer,
    context: { replace: SyncPullContext } | { link: SyncLinkContext }
  ) => Promise<boolean>;
  resolvePackageImportConflicts: (
    resolutions: Record<string, ConflictResolution>
  ) => Promise<void>;
  dismissPackageImport: () => void;
};

export type PackageSliceInternals = {
  persist: (project: Project) => Promise<boolean>;
  // Returns the document actually opened, which may differ from the one handed
  // in: setDocument runs the shared-opening load repair. Anything persisted
  // after a swap must be that return value.
  setDocument: (project: Project, extras?: Partial<AppState>) => Project;
  deps: AppStoreDeps;
};

export function createPackageSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: PackageSliceInternals
): { actions: PackageSliceActions } {
  const { persist, setDocument, deps } = internals;

  // Shared by exportProjectPackage (the open document) and
  // exportProjectPackageById (any saved project, via the repository) — the
  // only difference between the two call sites is which Project they hand
  // in. No DOM here; the thin UI turns the returned zip into a download.
  async function buildPackageZip(
    project: Project,
    libraryArtworks: Artwork[],
    mode: PackageExportMode
  ): Promise<{ filename: string; zip: Uint8Array; warnings: string[] } | null> {
    try {
      // Pure build lives in the domain service (no store side effects); this
      // wrapper keeps the export-error-banner behavior the UI relies on.
      const { filename, zip, warnings } = await buildProjectPackage({
        project,
        libraryArtworks,
        mode,
        getAsset: (assetId) => deps.assetRepository.getAsset(assetId),
        getBlob: (key) => deps.assetRepository.getBlob(key)
      });
      set({ error: null });
      return { filename, zip, warnings };
    } catch (error) {
      set({
        error: `Export failed: ${
          error instanceof Error ? error.message : "the package could not be built."
        }`
      });
      return null;
    }
  }

  // Copy into a fresh ArrayBuffer-backed part so Blob's part type is
  // satisfied regardless of what pooled buffer the zip inflated into.
  function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy], { type: mimeType });
  }

  // The persistence half of a package import: only runs after the whole
  // untrusted-file pipeline has succeeded and any conflicts are resolved
  // (docs/plan.md §13 — nothing is written before then). Shared by the
  // no-conflict fast path and the dialog resolution path.
  // The replace path's prerequisites, in the order docs/cloud-sync-plan.md
  // fixes them. Validation (1) and artwork conflicts (2) are behind us by the
  // time a commit runs; this is (3) the recovery snapshot of the copy about to
  // be overwritten and (4) the re-check that nothing moved while a review dialog
  // was open. Either failing ABORTS the whole commit — nothing has been written
  // yet, so the existing copy is left exactly as it was.
  async function prepareSyncReplace(syncPull: SyncPullContext): Promise<void> {
    // v1 scope: a pull only ever replaces the OPEN project. Replacing a project
    // in the background would mean a document on screen silently diverging from
    // its stored record, so refuse instead of widening the blast radius.
    const open = get().project;
    if (!open || open.id !== syncPull.targetProjectId) {
      throw new Error(
        "the project this Dropbox version belongs to is no longer open on this device."
      );
    }

    // Snapshot the CURRENT STORED target, not the open document: the stored
    // record is what the replace is about to overwrite. A load or snapshot
    // failure aborts — replacing with no recovery copy behind it is the one
    // outcome this path exists to prevent.
    const stored = await deps.projectRepository.load(syncPull.targetProjectId);
    await deps.projectSnapshotRepository.add({
      projectId: stored.id,
      createdAt: new Date().toISOString(),
      projectTitle: stored.title,
      fingerprint: selectBackupFingerprint(stored, get().libraryArtworks),
      project: stored
    });

    // Drift check last, so it reads the freshest state: an edit that landed
    // while the artwork review sat open would otherwise be thrown away by a
    // decision made against a version of the project that no longer exists.
    // The caller re-runs the sync check, which re-assesses honestly.
    const currentFingerprint = selectBackupFingerprint(open, get().libraryArtworks);
    if (currentFingerprint !== syncPull.expectedLocalFingerprint) {
      throw new Error(
        "this project changed on this device while the review was open; nothing was replaced."
      );
    }
  }

  // Record that the opened project descends from a specific head revision. Both
  // sync contexts land here: a pull replaced what was on this device, a link put
  // a project here for the first time, and either way the rev is the ancestry
  // the next check compares against.
  async function seedSyncMeta(
    opened: Project,
    libraryArtworks: Artwork[],
    rev: string
  ): Promise<void> {
    const accountId = deps.cloudBackupProvider?.accountId() ?? null;
    // Sync metadata is bound to the account it came from. With no account id
    // there is nothing honest to bind to, so the project simply reads as
    // unlinked — the import itself still stands.
    if (!accountId) return;

    // The (opened, libraryArtworks) pair is exactly what the state machine will
    // fingerprint next cycle, so "unchanged since the pull" is true by
    // construction rather than by a re-derivation that could disagree.
    const fingerprintAtRev = selectBackupFingerprint(opened, libraryArtworks);
    const nowIso = new Date().toISOString();
    let existing;
    try {
      existing = await deps.syncMetaRepository.get(opened.id);
    } catch {
      existing = undefined;
    }
    await deps.syncMetaRepository.put({
      projectId: opened.id,
      provider: "dropbox",
      accountId,
      remotePath: syncHeadPath(opened.id),
      lastAcceptedRev: rev,
      fingerprintAtRev,
      lastPullAtIso: nowIso,
      lastPushAtIso: existing?.lastPushAtIso ?? null,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      // Whatever "Not now" paused, this pull resolved.
      paused: false
    });
  }

  async function commitPackageImport(
    plan: ImportPlan,
    resolutions: Record<string, ConflictResolution>,
    provenance: ImportProvenance = {}
  ) {
    const { cloudRestore, syncPull, syncLink } = provenance;
    // Prerequisites BEFORE anything is finalized or written. finalize is pure,
    // but ordering the abort ahead of it keeps "nothing happened" literal.
    if (syncPull) await prepareSyncReplace(syncPull);

    const commit = finalizePackageImport(plan, resolutions);

    // Which end of the write sequence the project record belongs at depends on
    // what a half-finished commit would cost, and the two imports have opposite
    // answers:
    //
    //  - An ORDINARY import writes a NEW project. Persisting it first keeps a
    //    failed project save from writing library data or opening a document
    //    that will disappear on reload; assets/artworks that land afterwards
    //    belong to a project that really exists.
    //  - A REPLACE (a sync pull) overwrites a project the user already has.
    //    Persisting first would mean a mid-loop asset failure leaves the stored
    //    project already replaced with its images missing — the plan doc's
    //    "if any prerequisite fails, the existing copy is preserved untouched"
    //    inverted. So the replacing record is written LAST, as the single
    //    commit point. The tradeoff is accepted deliberately: assets and
    //    artworks here are additive and newly id'd, so a failure before the
    //    commit point orphans some unreferenced blobs — harmless junk — while
    //    the project the user is looking at is exactly as it was.
    const replacing = syncPull !== undefined;

    if (!replacing && !(await persist(commit.project))) {
      throw new Error(get().error ?? "The imported project could not be saved.");
    }

    for (const prepared of commit.assetsToSave) {
      await deps.assetRepository.saveAsset(prepared.asset, {
        original: bytesToBlob(prepared.blobs.original.bytes, prepared.blobs.original.mimeType),
        display: bytesToBlob(prepared.blobs.display.bytes, prepared.blobs.display.mimeType),
        thumbnail: bytesToBlob(prepared.blobs.thumbnail.bytes, prepared.blobs.thumbnail.mimeType)
      });
    }
    for (const artwork of commit.artworksToSave) {
      await deps.artworkLibraryRepository.save(artwork);
    }

    const libraryArtworks = await deps.artworkLibraryRepository.list();

    // The replace's commit point, after every read that could still fail. Past
    // this line the replacement HAS happened, which is what lets the sync slice
    // say "this project was not replaced" whenever the import reports failure —
    // nothing below throws.
    if (replacing && !(await persist(commit.project))) {
      throw new Error(get().error ?? "The imported project could not be saved.");
    }

    const opened = setDocument(commit.project, { viewMode: "plan", libraryArtworks });
    // This path persists BEFORE it opens (the write above has to precede the
    // asset/artwork writes), so a load repair lands after the record is
    // already down. A second write is the only way the stored project matches
    // the one on screen. No recovery snapshot HERE: an ordinary import writes
    // its own newly finalized project, so there is no earlier document of the
    // user's at risk — the one path that does overwrite (a sync pull) took its
    // snapshot in prepareSyncReplace before anything was written.
    //
    // A false return here must NOT throw or unwind: the document is already
    // open and the assets/artworks are already on disk, so the import really
    // did happen — only the repaired record's write-back failed. persist()
    // has already flipped saveState to "error" and queued a saveError with
    // its own retry closure (the badge + retry toast own announcing that).
    // repairSaved just gates the toast below so it doesn't call that a
    // success.
    const repairSaved = opened === commit.project || (await persist(opened));

    // A successful import — even a degraded one — is not an error, so it
    // no longer rides the red `error` banner (see docs/status.md). Both
    // outcomes get a one-shot toast instead; degradations also surface via
    // the standing missing-image placeholder state on the affected
    // checklist rows, so the toast doesn't need to be permanent.
    if (commit.warnings.length > 0) {
      // Content warnings (missing/invalid images) are true regardless of
      // whether the trailing repair write-back landed, so they still get
      // reported even on a degraded save — this toast never claims the
      // record made it to disk, just that the import ran with issues.
      toast.warning(
        `Imported “${commit.project.title}” with ${commit.warnings.length} warning${
          commit.warnings.length === 1 ? "" : "s"
        }: ${commit.warnings.join(" ")}`
      );
    } else if (repairSaved) {
      toast.success(`Imported “${commit.project.title}”`);
    }
    // else: nothing else to report, and saying "Imported" here would read as
    // success next to the red save badge repairSaved=false just left behind.
    // Stay quiet and let saveState/saveError carry the failure.

    // The import pipeline itself completed (document open, assets/artworks
    // persisted) whether or not the trailing repair write landed — the same
    // principle pdf_export_completed uses, firing once the file is actually
    // delivered rather than re-litigating unrelated later save state. Whether
    // the record made it to disk is the save badge's story, not this
    // counter's, so this always fires.
    telemetry.track("package_import_completed", {});

    if (cloudRestore) {
      seedCloudRestoreMeta(plan, opened, libraryArtworks, cloudRestore);
    }

    // Sync bookkeeping is the last thing written, and only after the document is
    // really open: a rev recorded for a commit that failed would claim this
    // device holds content it does not.
    const syncRev = syncPull?.rev ?? syncLink?.rev ?? null;
    if (syncRev === null) return;
    try {
      await seedSyncMeta(opened, libraryArtworks, syncRev);
      if (!cloudRestore) {
        // The pulled content is already in Dropbox, so an auto-backup minutes
        // later would burn one of the five retention slots on a duplicate of what
        // was just downloaded. Same reasoning as a cloud restore's seed; only the
        // source file differs.
        writeCloudBackupMeta(opened.id, {
          lastCloudBackupAt: new Date().toISOString(),
          backedUpFingerprint: selectBackupFingerprint(opened, libraryArtworks)
        });
      }
      // Fold the new meta into observable state here rather than at the call site:
      // a pull that parked in the artwork review commits minutes later, long after
      // the sync slice stopped waiting on it.
      await get().refreshProjectSyncState();
    } catch {
      // The import itself is DONE — the document is open, the record is down —
      // so this must not unwind into the caller's "Import failed" path, which
      // would tell the user nothing changed while their project sits replaced
      // on screen. Report the true, narrower problem instead: this device
      // cannot prove which revision its copy descends from, so the next check
      // reads as a conflict rather than as licence to overwrite Dropbox — the
      // safe direction, and the same message the sync slice uses when its own
      // metadata write fails.
      set({ syncStatus: "error", syncError: BOOKKEEPING_MESSAGE });
    }
  }

  // Cloud-restore bookkeeping, unchanged by sync: kept as its own function only
  // so the commit's tail reads as one decision per provenance.
  function seedCloudRestoreMeta(
    plan: ImportPlan,
    opened: Project,
    libraryArtworks: Artwork[],
    cloudRestore: CloudRestoreContext
  ): void {
    // A restore only counts here, at the commit — the parked-in-conflicts path
    // can still be dismissed, and counting that as an opened project inflates
    // the number with restores the user cancelled. Both restore shapes
    // (identity-preserving and save-a-copy) count, because both really did put
    // a cloud project on this device.
    telemetry.track("cloud_project_opened", {});

    // Seed this device's cloud-backup bookkeeping so the scheduler doesn't
    // immediately re-upload what it just downloaded: the restored content
    // already exists as the newest backup in that project's Dropbox folder, so
    // an upload minutes later would burn one of the five retention slots on a
    // duplicate. The next real edit changes the fingerprint and flips the dirty
    // check honestly.
    //
    // Only when identity was preserved. A save-a-copy restore is a NEW project
    // with its own, still-empty backup folder — its first backup is correct
    // behavior, and claiming it is already backed up would leave a project with
    // no cloud copy at all. The (opened, libraryArtworks) pair below is exactly
    // what the scheduler will fingerprint, so the two agree by construction.
    if (plan.projectRenamed) return;
    writeCloudBackupMeta(opened.id, {
      lastCloudBackupAt: cloudRestore.lastBackupIso ?? new Date().toISOString(),
      backedUpFingerprint: selectBackupFingerprint(opened, libraryArtworks)
    });
  }

  async function runPackageImport(
    bytes: ArrayBuffer,
    options: { forceProjectCopy?: boolean } & ImportProvenance = {}
  ): Promise<boolean> {
    const provenance: ImportProvenance = {
      ...(options.cloudRestore ? { cloudRestore: options.cloudRestore } : {}),
      ...(options.syncPull ? { syncPull: options.syncPull } : {}),
      ...(options.syncLink ? { syncLink: options.syncLink } : {})
    };
    set({ intakeState: "processing" });
    try {
      // 1-2. Zip safety + staged manifest pipeline (extract enforces the
      // caps pre-inflation; readPackageManifest migrates embedded docs).
      const { manifest, files } = await openSightlinesPackage(new Uint8Array(bytes));

      // 3. Asset intake validation: re-hash, MIME allowlist, decode guards.
      const validated = await validatePackageAssets(manifest, files);

      // Existing-library snapshot the pure planner merges against.
      const libraryArtworks = get().libraryArtworks;
      const assetShaById = new Map<string, string>();
      for (const artwork of libraryArtworks) {
        if (!artwork.assetId || assetShaById.has(artwork.assetId)) continue;
        try {
          const asset = await deps.assetRepository.getAsset(artwork.assetId);
          if (asset.sha256) assetShaById.set(asset.id, asset.sha256);
        } catch (error) {
          // Missing assets skip dedupe; operational read failures fail closed.
          if (!(error instanceof AssetNotFoundError)) throw error;
        }
      }
      // Collision detection must fail closed. The project-manager list is
      // intentionally tolerant, but treating a failed read as an empty
      // repository here could overwrite an existing project.
      const summaries = await deps.projectRepository.list();

      // 4-5. §6 merge rules + project identity, as one pure plan.
      const plan = planPackageImport(
        manifest,
        validated,
        {
          artworks: libraryArtworks,
          assetShaById,
          projectIds: summaries.map((summary) => summary.id)
        },
        {
          forceProjectCopy: options.forceProjectCopy,
          // The replace authorization, and the id-mismatch guard with it: the
          // planner throws if these bytes are not the project being replaced.
          ...(options.syncPull
            ? { replaceProjectId: options.syncPull.targetProjectId }
            : {})
        }
      );

      if (plan.conflicts.length > 0) {
        // Park for ONE review step in the conflict dialog — nothing has
        // been persisted yet, so dismissing discards the import cleanly.
        // The restore/sync provenance parks with the plan so the commit that
        // may follow can still tell where these bytes came from, and a pull
        // re-checks its replace prerequisites there rather than here.
        set({ pendingPackageImport: { plan, ...provenance } });
        return true;
      }

      await commitPackageImport(plan, {}, provenance);
      return true;
    } catch (error) {
      const message = `Import failed: ${
        error instanceof Error ? error.message : "the package could not be read."
      }`;
      set({ error: message });
      toast.error(message);
      return false;
    } finally {
      set({ intakeState: "idle" });
    }
  }

  const actions: PackageSliceActions = {
    async importProjectJson(text) {
      let project: Project;

      // migrateProjectJson owns the whole parse → validate-shape →
      // migrate → validate pipeline (docs/plan.md §2) and throws a
      // specific, human-readable reason for every way an externally
      // authored file can be bad — oversized, not JSON, not a Sightlines
      // project, a newer schema version than this app knows, or a
      // Sightlines project whose data fails validation. The current
      // project is never touched until that pipeline has fully succeeded.
      let repairedCount = 0;
      try {
        ({ project, repairedCount } = migrateProjectJsonWithReport(text));
      } catch (error) {
        const message = `Import failed: ${
          error instanceof Error ? error.message : "the file could not be read."
        }`;
        set({ error: message });
        toast.error(message);
        return;
      }

      const opened = setDocument(project, { viewMode: "plan" });
      // A local document repairs silently, but an imported file that changed on
      // the way in should say so. Separate from the linked-openings count
      // setDocument reports: this one severed invalid pairs pre-parse, that one
      // joined two faces back into one opening.
      if (repairedCount > 0) {
        toast.warning(
          repairedCount === 1
            ? "One invalid shared opening was disconnected while opening this project."
            : `${repairedCount} invalid shared openings were disconnected while opening this project.`
        );
      }
      // The load repair may have changed the document; persist what was opened.
      await persist(opened);
    },

    async exportProjectPackage(mode) {
      const { project, libraryArtworks } = get();
      if (!project) return null;

      return buildPackageZip(project, libraryArtworks, mode);
    },

    async exportProjectPackageById(id, mode) {
      const liveProject = get().project;
      if (liveProject?.id === id) {
        return buildPackageZip(liveProject, get().libraryArtworks, mode);
      }
      let project: Project;
      try {
        project = await deps.projectRepository.load(id);
      } catch (error) {
        set({
          error: `Export failed: ${
            error instanceof Error ? error.message : "that project could not be loaded."
          }`
        });
        return null;
      }

      return buildPackageZip(project, get().libraryArtworks, mode);
    },

    async exportChecklistSpreadsheet(options) {
      const { project, libraryArtworks } = get();
      if (!project) return null;

      try {
        // Missing assets and deleted library records degrade to warnings inside
        // the builder, so anything that reaches this catch is structural (the
        // spreadsheet writer or the zipper), not missing content.
        const result = await buildChecklistExport({
          project,
          libraryArtworks,
          options,
          getAsset: (assetId) => deps.assetRepository.getAsset(assetId),
          getBlob: (key) => deps.assetRepository.getBlob(key)
        });
        set({ error: null });
        return result;
      } catch (error) {
        set({
          error: `Export failed: ${
            error instanceof Error ? error.message : "the checklist could not be built."
          }`
        });
        return null;
      }
    },

    async exportChecklistPdf(options) {
      const { project, libraryArtworks } = get();
      if (!project) return null;

      try {
        // Loaded on demand, in parallel: the writer chunk (pdf-lib + fontkit)
        // and the bundled Geist bytes, exactly as handleExportPdf does for the
        // document export. Missing fonts fail open to standard Helvetica.
        const [{ buildChecklistPdf }, { loadPdfFontBytes }] = await Promise.all([
          import("../export/checklistPdf/buildChecklistPdf"),
          import("../export/pdfFonts")
        ]);
        const result = await buildChecklistPdf({
          project,
          libraryArtworks,
          options,
          getAsset: (assetId) => deps.assetRepository.getAsset(assetId),
          getBlob: (key) => deps.assetRepository.getBlob(key),
          fontBytes: await loadPdfFontBytes()
        });
        set({ error: null });
        return result;
      } catch (error) {
        set({
          error: `Export failed: ${
            error instanceof Error ? error.message : "the checklist could not be built."
          }`
        });
        return null;
      }
    },

    async importSightlinesPackage(bytes) {
      await runPackageImport(bytes);
    },

    async importSharedSightlinesPackage(bytes) {
      return runPackageImport(bytes, { forceProjectCopy: true });
    },

    async importCloudBackupPackage(bytes, options = {}) {
      return runPackageImport(bytes, {
        forceProjectCopy: options.asCopy === true,
        cloudRestore: { lastBackupIso: options.lastBackupIso ?? null }
      });
    },

    async importSyncHeadPackage(bytes, context) {
      return runPackageImport(
        bytes,
        "replace" in context ? { syncPull: context.replace } : { syncLink: context.link }
      );
    },

    async resolvePackageImportConflicts(resolutions) {
      const pending = get().pendingPackageImport;
      if (!pending) return;
      set({ pendingPackageImport: null });
      try {
        await commitPackageImport(pending.plan, resolutions, {
          ...(pending.cloudRestore ? { cloudRestore: pending.cloudRestore } : {}),
          ...(pending.syncPull ? { syncPull: pending.syncPull } : {}),
          ...(pending.syncLink ? { syncLink: pending.syncLink } : {})
        });
      } catch (error) {
        const message = `Import failed: ${
          error instanceof Error ? error.message : "the package could not be saved."
        }`;
        set({ error: message });
        toast.error(message);
      }
    },

    dismissPackageImport() {
      // Dropping the whole parked record discards the plan AND its provenance:
      // a cancelled restore leaves no trace, and in particular never counts as
      // an opened cloud project.
      set({ pendingPackageImport: null });
    }
  };

  return { actions };
}
