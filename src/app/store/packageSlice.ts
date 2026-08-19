import { toast } from "sonner";
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
import type { PackageExportMode } from "../../domain/schema/packageSchema";
import { migrateProjectJsonWithReport } from "../../domain/schema/projectSchema";
import type { AppState, AppStoreDeps } from "../store";
import { telemetry } from "../telemetry/telemetry";

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
    options?: { asCopy?: boolean }
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
  async function commitPackageImport(
    plan: ImportPlan,
    resolutions: Record<string, ConflictResolution>
  ) {
    const commit = finalizePackageImport(plan, resolutions);

    // Persist the project first and let failures reject. This keeps a failed
    // project save from writing library data or opening a document that will
    // disappear on reload. Later repository failures remain visible to the
    // caller and leave a recoverable project with potentially missing images.
    if (!(await persist(commit.project))) {
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
    const opened = setDocument(commit.project, { viewMode: "plan", libraryArtworks });
    // This path persists BEFORE it opens (the write above has to precede the
    // asset/artwork writes), so a load repair lands after the record is
    // already down. A second write is the only way the stored project matches
    // the one on screen. No recovery snapshot: an import writes its own newly
    // finalized project, so there is no earlier document of the user's at risk.
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
  }

  async function runPackageImport(
    bytes: ArrayBuffer,
    options: { forceProjectCopy?: boolean } = {}
  ): Promise<boolean> {
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
        options
      );

      if (plan.conflicts.length > 0) {
        // Park for ONE review step in the conflict dialog — nothing has
        // been persisted yet, so dismissing discards the import cleanly.
        set({ pendingPackageImport: plan });
        return true;
      }

      await commitPackageImport(plan, {});
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

    async importSightlinesPackage(bytes) {
      await runPackageImport(bytes);
    },

    async importSharedSightlinesPackage(bytes) {
      return runPackageImport(bytes, { forceProjectCopy: true });
    },

    async importCloudBackupPackage(bytes, options = {}) {
      return runPackageImport(bytes, { forceProjectCopy: options.asCopy === true });
    },

    async resolvePackageImportConflicts(resolutions) {
      const plan = get().pendingPackageImport;
      if (!plan) return;
      set({ pendingPackageImport: null });
      try {
        await commitPackageImport(plan, resolutions);
      } catch (error) {
        const message = `Import failed: ${
          error instanceof Error ? error.message : "the package could not be saved."
        }`;
        set({ error: message });
        toast.error(message);
      }
    },

    dismissPackageImport() {
      set({ pendingPackageImport: null });
    }
  };

  return { actions };
}
