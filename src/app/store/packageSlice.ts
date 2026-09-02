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
import { CLOUD_SYNC_PROJECT_ALREADY_HERE_MESSAGE } from "../cloud/cloudBackupCopy";
import type { PackageExportMode } from "../../domain/schema/packageSchema";
import { migrateProjectJsonWithReport } from "../../domain/schema/projectSchema";
import type { AppState, AppStoreDeps } from "../store";
import { selectBackupFingerprint } from "./cloudBackupSlice";
import {
  BOOKKEEPING_MESSAGE,
  errorFor,
  remotePathForProject,
  type SyncEpoch
} from "./cloudSyncSlice";
import { writeCloudBackupMeta } from "./cloudBackupMeta";
import { telemetry } from "../telemetry/telemetry";

const INCOMPLETE_SYNC_IMPORT_MESSAGE =
  "The Dropbox project opened, but some of its information could not be saved. Try syncing again.";

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

// The link authorization a sync import's bookkeeping may be written under.
// Captured when the import's sync provenance is established — deliberately
// BEFORE any park, not at the commit — because the race it closes is exactly an
// unlink made while the artwork review sat open: the commit that follows would
// otherwise re-create the metadata record the user just deleted and turn sync
// back on against an explicit instruction.
//
// Link epochs are per project, so the authorization names the project whose
// record this import will write: a link change made about any OTHER project is
// not an instruction about this one.
type SyncSeedAuthorization = { projectId: string; linkEpoch: number };

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
  syncSeedAuth?: SyncSeedAuthorization;
};

// The provenance half of an import, carried from the pipeline through any park
// to the commit. At most one sync context is ever set: a pull replaces a
// project that is here, a link imports one that is not.
type ImportProvenance = {
  cloudRestore?: CloudRestoreContext;
  syncPull?: SyncPullContext;
  syncLink?: SyncLinkContext;
  // Set whenever one of the sync contexts above is.
  syncSeedAuth?: SyncSeedAuthorization;
};

// The open document's save bookkeeping, captured so a write that turns out not
// to belong to it can be undone whole.
type SaveBookkeeping = Pick<AppState, "saveState" | "error" | "saveError">;

// What a link commit has to hand back if it cannot finish: the id its
// create-only insert claimed, and the save bookkeeping that claim painted over.
type LinkCreateClaim = { projectId: string; saveBookkeeping: SaveBookkeeping };

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
  persistIfAbsent: (project: Project) => Promise<"created" | "exists" | "failed">;
  // Returns the document actually opened, which may differ from the one handed
  // in: setDocument runs the shared-opening load repair. Anything persisted
  // after a swap must be that return value.
  setDocument: (project: Project, extras?: Partial<AppState>) => Project;
  deps: AppStoreDeps;
  // Read-only here: an import never links or unlinks anything, it only has to
  // know whether the link it was authorized under is still the user's word.
  syncEpoch: SyncEpoch;
};

export function createPackageSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: PackageSliceInternals
): { actions: PackageSliceActions } {
  const { persist, persistIfAbsent, setDocument, deps, syncEpoch } = internals;

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
  //
  // CONTRACT, mirroring the sync slice's own saveMeta: the authorization is
  // checked HERE, immediately before the put, not at the call sites. A commit
  // that resolves minutes after its review dialog opened can land after the
  // user has turned sync off for this project, and a put that lands then
  // re-creates the record the unlink just deleted — sync turning itself back on
  // against the newer instruction. Checking inside is what stops a future
  // caller forgetting it.
  //
  // A refusal is not an error and must never be painted as one: the unlink IS
  // the user's decision, and unlinked is the correct end state. The commit's
  // trailing refreshProjectSyncState repaints it honestly.
  //
  // RETURNS whether the record was written, because a caller's own bookkeeping
  // may only claim what this one actually did.
  async function seedSyncMeta(
    opened: Project,
    libraryArtworks: Artwork[],
    rev: string,
    auth: SyncSeedAuthorization | undefined
  ): Promise<boolean> {
    // Fail closed, and only for THIS project: an authorization taken out for a
    // different id says nothing about the record about to be written here.
    function stillAuthorized(): boolean {
      return (
        auth !== undefined &&
        auth.projectId === opened.id &&
        auth.linkEpoch === syncEpoch.linkEpochFor(opened.id)
      );
    }
    if (!stillAuthorized()) return false;

    const active = deps.cloudBackupProvider ?? null;
    const accountId = active?.accountId() ?? null;
    // Sync metadata is bound to the account it came from. With no account id
    // there is nothing honest to bind to, so the project simply reads as
    // unlinked — the import itself still stands.
    if (!active || !accountId) return false;

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
    // The read above is an await, and an unlink that completes inside it would
    // otherwise have its record re-created by the put below.
    if (!stillAuthorized()) return false;
    await deps.syncMetaRepository.put({
      projectId: opened.id,
      provider: "dropbox",
      accountId,
      remotePath: remotePathForProject(active, opened.id),
      lastAcceptedRev: rev,
      fingerprintAtRev,
      lastPullAtIso: nowIso,
      lastPushAtIso: existing?.lastPushAtIso ?? null,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      // Whatever "Not now" paused, this pull resolved.
      paused: false
    });
    return true;
  }

  // Undo the link path's create-only claim on an id. Best effort BY CONTRACT:
  // the caller rethrows the ORIGINAL failure whether or not this delete lands
  // — a failed delete just leaves the orphan the next retry's "already on this
  // device" checks skip past, no worse than never having tried.
  async function unwindLinkCreate(claim: LinkCreateClaim): Promise<void> {
    try {
      await deps.projectRepository.delete(claim.projectId);
    } catch {
      // Swallowed on purpose: see above.
    }
    // persistIfAbsent paints this tab's save bookkeeping — it is the same
    // function the open document's own saves go through — but the record it
    // wrote was never the open document, and no longer exists. The open
    // document was not touched by this import, so its badge (including a save
    // failure it already had) must read exactly as it did before.
    //
    // INVARIANT: the capture may only be put back while the bookkeeping still
    // reads as the claim's own success left it — "saved", with no save failure
    // behind it. Anything else was written by a save of the OPEN document that
    // started or finished during the writes above, and that is both newer than
    // the capture and about a document this import never touched. Rolling it
    // back would drop a failure whose retry closure is the curator's only way
    // out of it — the exact loss this restore exists to prevent, inverted.
    const { saveState, saveError } = get();
    if (saveState !== "saved" || saveError !== null) return;
    set(claim.saveBookkeeping);
  }

  async function commitPackageImport(
    plan: ImportPlan,
    resolutions: Record<string, ConflictResolution>,
    provenance: ImportProvenance = {}
  ) {
    const { cloudRestore, syncPull, syncLink, syncSeedAuth } = provenance;
    // Backstop for the pipeline's link guard: a plan can sit parked in the
    // artwork review for minutes and only the PLAN is replayed here, so the
    // identity is re-checked against the authorization one last time rather
    // than assumed to have been checked upstream. A link that isn't the project
    // it is named for must write nothing at all.
    if (syncLink && plan.project.id !== syncLink.projectId) {
      throw new Error(
        "the synced copy in Dropbox does not match the project it is named for."
      );
    }
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
    //    commit point.
    //
    // What may precede that commit point is therefore only what a failed
    // commit can afford to leave behind. Assets and ADDED artworks qualify:
    // they are newly id'd records nothing yet references, so an abort orphans
    // some unreferenced blobs — harmless junk — while the project the user is
    // looking at is exactly as it was. A "theirs" resolution does NOT qualify:
    // it saves conflict.incoming under the EXISTING id, overwriting a library
    // record other projects may show. Writing that before the commit point
    // would make "this project was not replaced" true of the project and false
    // of the library, with nothing to roll it back to (prepareSyncReplace
    // snapshots the project, not the library). So the overwrites move to the
    // far side of the commit point — see below.
    const replacing = syncPull !== undefined;

    // Exactly the records that already exist on this device: a conflict is
    // raised only for an incoming artwork whose id is already in the library,
    // and finalize keeps that id for "theirs" (a "both" duplicate carries a
    // fresh one, and artworksToAdd are absent by definition). Read from the
    // plan, never re-read from the repository — the split has to describe the
    // same decision the user reviewed.
    const conflictedArtworkIds = new Set(
      plan.conflicts.map((conflict) => conflict.incoming.id)
    );
    const artworkOverwrites = replacing
      ? commit.artworksToSave.filter((artwork) => conflictedArtworkIds.has(artwork.id))
      : [];
    const artworksBeforeCommit = replacing
      ? commit.artworksToSave.filter((artwork) => !conflictedArtworkIds.has(artwork.id))
      : commit.artworksToSave;

    // Set only on the link path, and only once its create-only claim has landed.
    let linkClaim: LinkCreateClaim | null = null;

    if (!replacing) {
      if (syncLink) {
        // The earlier list check gives prompt feedback, but only IndexedDB's
        // create-only add closes the cross-tab race: another tab may create or
        // restore this id while the artwork review is parked. Claim the id
        // atomically before writing any assets or shared artwork records.
        const saveBookkeeping: SaveBookkeeping = {
          saveState: get().saveState,
          error: get().error,
          saveError: get().saveError
        };
        const result = await persistIfAbsent(commit.project);
        if (result === "exists") {
          throw new Error(CLOUD_SYNC_PROJECT_ALREADY_HERE_MESSAGE);
        }
        if (result === "failed") {
          throw new Error(get().error ?? "The imported project could not be saved.");
        }
        linkClaim = { projectId: commit.project.id, saveBookkeeping };
      } else if (!(await persist(commit.project))) {
        throw new Error(get().error ?? "The imported project could not be saved.");
      }
    }

    // Guarded because a link commit is already holding a durable, empty project
    // record by now (see unwindLinkCreate). Only these three steps need the
    // guard: everything below them is either replace-only — which a link import
    // never runs — or past the point where the document is open and the import
    // really did happen.
    let preCommitLibraryArtworks: Artwork[];
    try {
      for (const prepared of commit.assetsToSave) {
        await deps.assetRepository.saveAsset(prepared.asset, {
          original: bytesToBlob(prepared.blobs.original.bytes, prepared.blobs.original.mimeType),
          display: bytesToBlob(prepared.blobs.display.bytes, prepared.blobs.display.mimeType),
          thumbnail: bytesToBlob(prepared.blobs.thumbnail.bytes, prepared.blobs.thumbnail.mimeType)
        });
      }
      for (const artwork of artworksBeforeCommit) {
        await deps.artworkLibraryRepository.save(artwork);
      }

      // Listed BEFORE the commit point on purpose: this read can still fail, and
      // failing here still unwinds cleanly (nothing decisive is written yet).
      // After the commit point it is re-read so the open document sees the
      // overwrites, but that re-read may no longer unwind — hence two variables.
      preCommitLibraryArtworks = await deps.artworkLibraryRepository.list();
    } catch (error) {
      if (linkClaim) await unwindLinkCreate(linkClaim);
      // The original failure, never the cleanup's: it is the one the user has
      // to act on, and the caller turns it into the "Import failed" message.
      throw error;
    }
    let libraryArtworks = preCommitLibraryArtworks;

    // The replace's commit point, after every read that could still fail. Past
    // this line the replacement HAS happened, which is what lets the sync slice
    // say "this project was not replaced" whenever the import reports failure —
    // nothing below throws.
    if (replacing && !(await persist(commit.project))) {
      throw new Error(get().error ?? "The imported project could not be saved.");
    }

    // A Dropbox rev may be acknowledged only if the durable project + shared
    // artwork records reproduce the head exactly. Once the project commit point
    // has passed, degradations no longer unwind the import, but they DO withhold
    // ancestry so the state machine cannot call a mixed local/remote result
    // synced or upload it as though the user had chosen that result.
    let syncHeadAppliedExactly = true;

    if (artworkOverwrites.length > 0) {
      // The "theirs" overwrites, deliberately after the commit point. The
      // project document references the same artwork id either way, so a
      // failure here degrades coherently: the replace stands and the library
      // simply keeps this device's version of that record — a visible,
      // recoverable difference, not a half-replaced project. Nothing unwinds,
      // and no failure is reported as an import failure.
      let keptLocal = 0;
      for (const artwork of artworkOverwrites) {
        try {
          await deps.artworkLibraryRepository.save(artwork);
        } catch {
          keptLocal += 1;
          syncHeadAppliedExactly = false;
        }
      }
      try {
        libraryArtworks = await deps.artworkLibraryRepository.list();
      } catch {
        // A stale list is degraded — the document may show the pre-overwrite
        // records until the next load — but the replace is done, so this must
        // not unwind. Fall back to the list read before the commit point.
        libraryArtworks = preCommitLibraryArtworks;
        syncHeadAppliedExactly = false;
      }
      if (keptLocal > 0) {
        toast.warning(
          keptLocal === 1
            ? "The project was replaced, but one artwork record kept this device’s version: it could not be saved."
            : `The project was replaced, but ${keptLocal} artwork records kept this device’s version: they could not be saved.`
        );
      }
    }

    const opened = setDocument(commit.project, { viewMode: "plan", libraryArtworks });
    // A second write to match the load-repaired record. A false return here
    // must NOT throw or unwind: the import already landed on disk, and
    // persist() has already flipped saveState/queued its own retry — this
    // only gates the toast below from calling a failed write-back a success.
    const repairSaved = opened === commit.project || (await persist(opened));
    if (!repairSaved) syncHeadAppliedExactly = false;

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
    if (!syncHeadAppliedExactly) {
      // Keep the previous accepted rev (or no link, for a first-device import)
      // and do not seed backup metadata. The retry action re-runs the normal
      // rev matrix from the last ancestry this device can actually prove.
      // Painted for `opened`, the document this degradation is ABOUT: for a
      // first-device import there is no metadata record behind the error, so
      // ownership is the only thing that keeps the next refresh from reading
      // "no link" as "nothing to report" and clearing it.
      if (get().project?.id === opened.id) {
        set(errorFor(opened.id, INCOMPLETE_SYNC_IMPORT_MESSAGE));
      }
      return;
    }
    try {
      const seeded = await seedSyncMeta(opened, libraryArtworks, syncRev, syncSeedAuth);
      // Only alongside a link that was really recorded. Stamping "backed up
      // just now" for a project that ended up unlinked claims a file in its
      // backup folder that nothing put there, and blocks the auto-backup that
      // would have created one.
      if (seeded && !cloudRestore) {
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
      // Must NOT unwind into the caller's "Import failed" path: the document
      // already landed. Report BOOKKEEPING_MESSAGE instead, owned by `opened`,
      // and only while it is still on screen (the awaits above may have swapped it).
      if (get().project?.id === opened.id) {
        set(errorFor(opened.id, BOOKKEEPING_MESSAGE));
      }
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
    // The identity the commit will seed bookkeeping for: a pull replaces the
    // project it names, a link imports the project it names, and both refuse
    // outright if the package inside turns out to be anything else. Naming it
    // here is what lets the capture below be about one project's link.
    const syncSeedProjectId =
      options.syncPull?.targetProjectId ?? options.syncLink?.projectId ?? null;
    const provenance: ImportProvenance = {
      ...(options.cloudRestore ? { cloudRestore: options.cloudRestore } : {}),
      ...(options.syncPull ? { syncPull: options.syncPull } : {}),
      ...(options.syncLink ? { syncLink: options.syncLink } : {}),
      // Captured HERE, where the sync provenance is established, rather than at
      // the commit: a commit can run minutes later, on the far side of an
      // artwork review the user left open, and the unlink this guards against
      // is one they can make in exactly that window.
      ...(syncSeedProjectId !== null
        ? {
            syncSeedAuth: {
              projectId: syncSeedProjectId,
              linkEpoch: syncEpoch.linkEpochFor(syncSeedProjectId)
            }
          }
        : {})
    };
    set({ intakeState: "processing" });
    try {
      // 1-2. Zip safety + staged manifest pipeline (extract enforces the
      // caps pre-inflation; readPackageManifest migrates embedded docs).
      const { manifest, files } = await openSightlinesPackage(new Uint8Array(bytes));

      // Link mode's authorization check, the sibling of the replace path's
      // replaceProjectId guard (which the planner enforces): a head file is
      // named for exactly one project, so a head holding a DIFFERENT project is
      // a corrupted or mixed-up file, not a version of anything. Refuse the
      // whole import rather than import the stranger: committing it would seed
      // this device's sync bookkeeping with the head's rev under the imported
      // project's identity and head path — a lineage no later check can
      // untangle, and one that parks bogus conflicts against a path this
      // project was never synced to.
      if (options.syncLink && manifest.project.id !== options.syncLink.projectId) {
        throw new Error(
          "the synced copy in Dropbox does not match the project it is named for."
        );
      }

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

      // Link mode is identity-preserving BY CONTRACT, so the planner's
      // rename-on-collision fallback is not an acceptable outcome here: a
      // renamed import would record the head's rev against a brand-new id while
      // the project the head is actually named for sits untouched beside it.
      // The cloud browser already routes a local match to save-a-copy, but it
      // reads this device before the download (the state can change in between)
      // and the folder rows it shares a path with match on an id PREFIX, so the
      // authoritative refusal belongs here, full id against full id. Same
      // wording as that surface, so one refusal doesn't read as two rules.
      if (options.syncLink && summaries.some((summary) => summary.id === manifest.project.id)) {
        throw new Error(CLOUD_SYNC_PROJECT_ALREADY_HERE_MESSAGE);
      }

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
        const replaced = get().pendingPackageImport;
        set({ pendingPackageImport: { plan, ...provenance } });
        // A record that is gone has the same debt a dismissal settles: the pull
        // that parked it left "pulling" on the status, and nothing is going to
        // resolve that review any more. An import that carries its own sync
        // provenance owns the status instead, and is still in flight.
        if (
          replaced &&
          (replaced.syncPull || replaced.syncLink) &&
          !provenance.syncPull &&
          !provenance.syncLink
        ) {
          await get().refreshProjectSyncState();
        }
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
      // The swap cleared this document's sync state, and an id-preserving
      // re-import of a linked project's own export leaves App's project-keyed
      // refresh with nothing to fire on. Without this the project reads as
      // unlinked — and the scheduler's gates keep it that way until a reload.
      await get().refreshProjectSyncState();
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
          ...(pending.syncLink ? { syncLink: pending.syncLink } : {}),
          ...(pending.syncSeedAuth ? { syncSeedAuth: pending.syncSeedAuth } : {})
        });
      } catch (error) {
        const message = `Import failed: ${
          error instanceof Error ? error.message : "the package could not be saved."
        }`;
        set({ error: message });
        toast.error(message);
        // The other way a parked sync import ends, and the same debt as a
        // dismissal: the operation that painted "pulling" is over. Safe to run
        // here because the commit has already thrown — there is no half-done
        // import left for this refresh to race, and the refresh only reads.
        if (pending.syncPull || pending.syncLink) {
          await get().refreshProjectSyncState();
        }
      }
    },

    dismissPackageImport() {
      const pending = get().pendingPackageImport;
      // Dropping the whole parked record discards the plan AND its provenance:
      // a cancelled restore leaves no trace, and in particular never counts as
      // an opened cloud project. Cleared FIRST, so nothing below can see an
      // import that is still parked.
      set({ pendingPackageImport: null });
      if (!pending?.syncPull && !pending?.syncLink) return;

      // A pull sets "pulling" and deliberately leaves it while the review sits
      // open, because the operation really is still in flight. Once the review
      // is dismissed it is not, and "pulling" reads as in-flight to the gate on
      // the check, the push AND linking — so leaving it there would kill sync
      // for this project until the page is reloaded, off a keystroke as routine
      // as Esc.
      //
      // Re-derived from storage rather than set to a chosen status: a pull
      // target still has its metadata, so it comes back pending or synced —
      // right, because nothing was imported. Run for a dismissed LINK too: that
      // one parks without touching the status (it has no project here to be
      // about), so the refresh only restates what is open, and one rule for
      // both is worth more than a branch that has to stay true. Fire-and-forget
      // because this is a dialog dismissal, synchronous by contract; the
      // refresh only reads, and the parked record is already gone above.
      void get().refreshProjectSyncState();
    }
  };

  return { actions };
}
