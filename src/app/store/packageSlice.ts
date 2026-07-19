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
import { migrateProjectJson } from "../../domain/schema/projectSchema";
import type { AppState, AppStoreDeps } from "../store";

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
  resolvePackageImportConflicts: (
    resolutions: Record<string, ConflictResolution>
  ) => Promise<void>;
  dismissPackageImport: () => void;
};

export type PackageSliceInternals = {
  persist: (project: Project) => Promise<boolean>;
  setDocument: (project: Project, extras?: Partial<AppState>) => void;
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
    setDocument(commit.project, { viewMode: "plan", libraryArtworks });

    // A successful import — even a degraded one — is not an error, so it
    // no longer rides the red `error` banner (see docs/status.md). Both
    // outcomes get a one-shot toast instead; degradations also surface via
    // the standing missing-image placeholder state on the affected
    // checklist rows, so the toast doesn't need to be permanent.
    if (commit.warnings.length > 0) {
      toast.warning(
        `Imported “${commit.project.title}” with ${commit.warnings.length} warning${
          commit.warnings.length === 1 ? "" : "s"
        }: ${commit.warnings.join(" ")}`
      );
    } else {
      toast.success(`Imported “${commit.project.title}”`);
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
      try {
        project = migrateProjectJson(text);
      } catch (error) {
        const message = `Import failed: ${
          error instanceof Error ? error.message : "the file could not be read."
        }`;
        set({ error: message });
        toast.error(message);
        return;
      }

      setDocument(project, { viewMode: "plan" });
      await persist(project);
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
        const plan = planPackageImport(manifest, validated, {
          artworks: libraryArtworks,
          assetShaById,
          projectIds: summaries.map((summary) => summary.id)
        });

        if (plan.conflicts.length > 0) {
          // Park for ONE review step in the conflict dialog — nothing has
          // been persisted yet, so dismissing discards the import cleanly.
          set({ pendingPackageImport: plan });
          return;
        }

        await commitPackageImport(plan, {});
      } catch (error) {
        const message = `Import failed: ${
          error instanceof Error ? error.message : "the package could not be read."
        }`;
        set({ error: message });
        toast.error(message);
      } finally {
        set({ intakeState: "idle" });
      }
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
