import { titleFromFilename } from "../../domain/assets/imageIntake";
import { buildImageAsset, processImageFile } from "../../domain/assets/intakeImageFile";
import { newId } from "../../domain/id";
import type { PlacementForm } from "../../domain/placement/artworkForm";
import { parseArtwork } from "../../domain/schema/artworkSchema";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  type Artwork,
  type FloorObject,
  type Project,
  type WallObject
} from "../../domain/project";
import type { ArtworkImportDraft } from "../../domain/spreadsheetImport/types";
import type {
  AppState,
  AppStoreDeps,
  ArtworkImportDestination,
  EditEntry,
  EditExtras
} from "../store";
import { NO_SELECTION, selectionWrite } from "./selectionSlice";
import { telemetry } from "../telemetry/telemetry";

export type ArtworkIntakeSliceState = {
  pendingDuplicateUploads: {
    file: File;
    existingArtworkTitle: string;
    destination: ArtworkImportDestination;
  }[];
};

export type ArtworkIntakeSliceActions = {
  addArtworksFromFiles: (
    files: File[],
    opts?: { skipDuplicateCheck?: boolean; destination?: ArtworkImportDestination }
  ) => Promise<void>;
  importArtworkDrafts: (
    drafts: ArtworkImportDraft[],
    opts?: { destination?: ArtworkImportDestination }
  ) => Promise<void>;
  addExistingArtworksToChecklist: (artworkIds: string[]) => Promise<void>;
  confirmDuplicateUploads: () => Promise<void>;
  dismissDuplicateUploads: () => void;
  removeArtworkFromChecklist: (artworkId: string) => Promise<void>;
  // Batch removeArtworkFromChecklist: one undo entry for the whole set.
  removeArtworksFromChecklist: (artworkIds: string[]) => Promise<void>;
  // Library copies of each work (shared image asset, no accession number).
  // Copies of checklisted works join the checklist right after their source in
  // one undo entry; undo drops that membership and leaves the records. Returns
  // the new ids.
  duplicateArtworks: (artworkIds: string[]) => Promise<string[]>;
  // A new image-less work, sized and typed up front, appended to the open
  // checklist and selected. Returns its id, or null when nothing was created.
  createBlankArtwork: (input: {
    title?: string;
    artist?: string;
    widthMm: number;
    heightMm: number;
    placementForm: PlacementForm;
  }) => Promise<string | null>;
  // Processes `file` into a NEW asset (no hash reuse) and points the work at
  // it as one undoable edit. The previous asset is never deleted.
  setArtworkImage: (artworkId: string, file: File) => Promise<void>;
  // Unlinks the work's image (undoable). The asset itself is never deleted.
  removeArtworkImage: (artworkId: string) => Promise<void>;
  deleteLibraryArtworks: (artworkIds: string[]) => Promise<void>;
};

export type ArtworkIntakeSliceInternals = {
  applyEdit: (
    label: string,
    buildNextProject: (project: Project) => Project,
    extras?: EditExtras
  ) => Promise<void>;
  persist: (project: Project) => Promise<boolean>;
  // Tell the other tabs the device-level artwork library changed, so they can
  // re-list theirs. Covers deletes too — the message means "the library moved",
  // not "a record was written".
  announceArtworksSaved: () => void;
  deps: AppStoreDeps;
};

export const ARTWORK_INTAKE_SLICE_INITIAL: ArtworkIntakeSliceState = {
  pendingDuplicateUploads: []
};

export function createArtworkIntakeSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: ArtworkIntakeSliceInternals
): { actions: ArtworkIntakeSliceActions } {
  const { applyEdit, persist, deps, announceArtworksSaved } = internals;

  // The artwork library is device-level, so every tab holds its own copy of the
  // same records. Re-read ours and say so in the same beat, always together.
  async function republishLibrary(): Promise<void> {
    set({ libraryArtworks: await deps.artworkLibraryRepository.list() });
    announceArtworksSaved();
  }

  const actions: ArtworkIntakeSliceActions = {
    async addArtworksFromFiles(files, opts = {}) {
      const project = get().project;
      const destinationProjectId = project?.id;
      const destination = opts.destination ?? "checklist";
      if ((destination === "checklist" && !project) || files.length === 0) return;

      set({ intakeState: "processing", error: null });

      const newArtworkIds: string[] = [];
      const failures: string[] = [];

      // Screen exact hashes against the destination and earlier batch files;
      // hold matches for confirmation. Assets without hashes never match.
      const skipDuplicateCheck = opts.skipDuplicateCheck === true;
      const titleBySha = new Map<string, string>();
      if (!skipDuplicateCheck) {
        const checklistIds = new Set(project?.checklistArtworkIds ?? []);
        for (const libraryArtwork of get().libraryArtworks) {
          if (destination === "checklist" && !checklistIds.has(libraryArtwork.id)) continue;
          if (!libraryArtwork.assetId) continue;
          try {
            const asset = await deps.assetRepository.getAsset(libraryArtwork.assetId);
            if (asset.sha256) titleBySha.set(asset.sha256, libraryArtwork.title ?? "Untitled");
          } catch {
            // A dangling assetId can't match anything — skip it.
          }
        }
      }
      const heldDuplicates: {
        file: File;
        existingArtworkTitle: string;
        destination: ArtworkImportDestination;
      }[] = [];

      try {
        for (const file of files) {
          const processResult = await processImageFile(file, deps.imageProcessor);
          if (!processResult.ok) {
            failures.push(processResult.reason);
            continue;
          }
          const processed = processResult.processed;

          if (!skipDuplicateCheck) {
            const existingTitle = titleBySha.get(processed.sha256);
            if (existingTitle !== undefined) {
              heldDuplicates.push({ file, existingArtworkTitle: existingTitle, destination });
              continue;
            }
            titleBySha.set(processed.sha256, titleFromFilename(file.name)); // batch-internal twins
          }

          const asset = buildImageAsset(file, processed);

          const artwork: Artwork = {
            id: newId(),
            schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
            title: titleFromFilename(file.name),
            dimensions: { status: "unknown" },
            assetId: asset.id,
            metadata: {}
          };

          try {
            await deps.assetRepository.saveAsset(asset, {
              original: processed.original,
              display: processed.display,
              thumbnail: processed.thumbnail
            });
            await deps.artworkLibraryRepository.save(artwork);
            newArtworkIds.push(artwork.id);
          } catch (error) {
            failures.push(
              error instanceof Error ? error.message : `${file.name} could not be saved.`
            );
          }
        }

        // Library/asset writes happen outside applyEdit, on purpose: they
        // are not part of the undoable document. Undoing this batch must
        // only remove checklist membership, never delete the library
        // record it points at — the same artwork may be shared with
        // another project or a future tour stop (docs/plan.md §4.1).
        if (newArtworkIds.length > 0) {
          await republishLibrary();

          if (destination === "checklist") {
            if (get().project?.id !== destinationProjectId) {
              set({
                error:
                  "Images were saved to the library, but were not added because the open project changed."
              });
              return;
            }
            const label =
              newArtworkIds.length === 1 ? "Add artwork" : `Add ${newArtworkIds.length} artworks`;

            await applyEdit(label, (current) => ({
              ...current,
              checklistArtworkIds: [...current.checklistArtworkIds, ...newArtworkIds]
            }));
          }
        }

        if (heldDuplicates.length > 0) {
          set({
            pendingDuplicateUploads: [...get().pendingDuplicateUploads, ...heldDuplicates]
          });
        }

        if (failures.length > 0) {
          set({
            error: `${failures.length} of ${files.length} image${
              files.length === 1 ? "" : "s"
            } could not be added: ${failures.join(" ")}`
          });
        }
        if (newArtworkIds.length > 0) {
          telemetry.track("artwork_import_completed", { source: "images" });
        }
      } catch (error) {
        // Anything unexpected here (not the per-file try/catches above,
        // which already funnel into `failures`) must still surface in the
        // error banner rather than escape as a silent unhandled rejection.
        set({
          error:
            error instanceof Error
              ? `Images could not be added: ${error.message}`
              : "Images could not be added."
        });
      } finally {
        set({ intakeState: "idle" });
      }
    },

    async importArtworkDrafts(drafts, opts = {}) {
      const project = get().project;
      const destinationProjectId = project?.id;
      const destination = opts.destination ?? "checklist";
      const selectedDrafts = drafts.filter((draft) => draft.selected);
      const source = selectedDrafts.some((draft) => draft.imageFile)
        ? ("combined" as const)
        : ("spreadsheet" as const);
      if ((destination === "checklist" && !project) || selectedDrafts.length === 0) return;

      set({ intakeState: "processing", error: null });

      const newArtworkIds: string[] = [];
      const failures: string[] = [];

      try {
        for (const draft of selectedDrafts) {
          let artwork = draft.artwork;

          if (draft.imageFile) {
            const imageFile = draft.imageFile;
            const processResult = await processImageFile(imageFile, deps.imageProcessor);
            if (!processResult.ok) {
              failures.push(processResult.reason);
            } else {
              try {
                const asset = buildImageAsset(imageFile, processResult.processed);
                await deps.assetRepository.saveAsset(asset, {
                  original: processResult.processed.original,
                  display: processResult.processed.display,
                  thumbnail: processResult.processed.thumbnail
                });
                artwork = { ...artwork, assetId: asset.id };
              } catch (error) {
                failures.push(
                  error instanceof Error ? error.message : `${imageFile.name} could not be processed.`
                );
              }
            }
          }

          try {
            await deps.artworkLibraryRepository.save(artwork);
            newArtworkIds.push(artwork.id);
          } catch (error) {
            failures.push(
              error instanceof Error
                ? error.message
                : `${artwork.title ?? "Untitled"} could not be saved.`
            );
          }
        }

        if (newArtworkIds.length > 0) {
          await republishLibrary();

          if (destination === "checklist") {
            if (get().project?.id !== destinationProjectId) {
              set({
                error:
                  "Artworks were imported to the library, but were not added because the open project changed."
              });
              return;
            }
            const label =
              newArtworkIds.length === 1
                ? "Import artwork"
                : `Import ${newArtworkIds.length} artworks`;

            await applyEdit(label, (current) => ({
              ...current,
              checklistArtworkIds: [...current.checklistArtworkIds, ...newArtworkIds]
            }));
          }
          telemetry.track("artwork_import_completed", { source });
        }

        if (failures.length > 0) {
          set({
            error: `${failures.length} import issue${
              failures.length === 1 ? "" : "s"
            }: ${failures.join(" ")}`
          });
        }
      } catch (error) {
        set({
          error:
            error instanceof Error ? `Import failed: ${error.message}` : "Import failed."
        });
      } finally {
        set({ intakeState: "idle" });
      }
    },

    async confirmDuplicateUploads() {
      const held = get().pendingDuplicateUploads;
      if (held.length === 0) return;
      set({ pendingDuplicateUploads: [] });
      for (const destination of ["library", "checklist"] as const) {
        const files = held
          .filter((entry) => entry.destination === destination)
          .map((entry) => entry.file);
        if (files.length > 0) {
          await get().addArtworksFromFiles(files, { skipDuplicateCheck: true, destination });
        }
      }
    },

    dismissDuplicateUploads() {
      set({ pendingDuplicateUploads: [] });
    },

    async addExistingArtworksToChecklist(artworkIds) {
      const project = get().project;
      if (!project || artworkIds.length === 0) return;

      const libraryIds = new Set(get().libraryArtworks.map((artwork) => artwork.id));
      const existingIds = new Set(project.checklistArtworkIds);
      const additions = [...new Set(artworkIds)].filter(
        (artworkId) => libraryIds.has(artworkId) && !existingIds.has(artworkId)
      );
      if (additions.length === 0) return;

      const label =
        additions.length === 1
          ? "Add artwork to checklist"
          : `Add ${additions.length} artworks to checklist`;
      await applyEdit(label, (current) => ({
        ...current,
        checklistArtworkIds: [...current.checklistArtworkIds, ...additions]
      }));
    },

    async removeArtworkFromChecklist(artworkId) {
      await get().removeArtworksFromChecklist([artworkId]);
    },

    async removeArtworksFromChecklist(artworkIds) {
      const project = get().project;
      if (!project) return;

      const isArtworkPlacementOf = (object: WallObject | FloorObject, ids: Set<string>) =>
        object.kind === "artwork" && ids.has(object.artworkId);
      const requested = new Set(artworkIds);
      const checklisted = new Set(project.checklistArtworkIds);
      const placed = new Set(
        [...project.wallObjects, ...project.floorObjects].flatMap((object) =>
          object.kind === "artwork" && requested.has(object.artworkId) ? [object.artworkId] : []
        )
      );
      const removed = new Set(
        [...requested].filter((artworkId) => checklisted.has(artworkId) || placed.has(artworkId))
      );
      if (removed.size === 0) return;

      // Removing from a checklist unlinks it from this project only — the
      // library record is untouched (docs/plan.md §4.1). Also drops any
      // placement referencing a removed artwork — on a wall or on the floor —
      // a checklist entry with a dangling placement would be an invalid state
      // to leave behind.
      const label =
        removed.size === 1 ? "Remove from checklist" : `Remove ${removed.size} works from checklist`;
      await applyEdit(label, (current) => ({
        ...current,
        checklistArtworkIds: current.checklistArtworkIds.filter((id) => !removed.has(id)),
        wallObjects: current.wallObjects.filter(
          (wallObject) => !isArtworkPlacementOf(wallObject, removed)
        ),
        floorObjects: current.floorObjects.filter(
          (floorObject) => !isArtworkPlacementOf(floorObject, removed)
        )
      }));
    },

    async duplicateArtworks(artworkIds) {
      const projectId = get().project?.id;
      const library = get().libraryArtworks;
      const sources = [...new Set(artworkIds)].flatMap((artworkId) => {
        const source = library.find((artwork) => artwork.id === artworkId);
        return source ? [source] : [];
      });
      if (sources.length === 0) return [];

      // Each copy is a new library record written OUTSIDE history, exactly as
      // intake writes one; only checklist membership is undoable. The image
      // asset is SHARED, not copied — deleteLibraryArtworks keeps an asset
      // while any record still points at it.
      const copyBySourceId = new Map<string, string>();
      for (const source of sources) {
        const copy: Artwork = {
          ...structuredClone(source),
          id: newId(),
          title: `${source.title?.trim() || "Untitled"} (copy)`
        };
        delete copy.accessionNumber;
        try {
          await deps.artworkLibraryRepository.save(copy);
          copyBySourceId.set(source.id, copy.id);
        } catch (error) {
          set({
            error: `Could not duplicate ${source.title?.trim() || "that work"} (${
              error instanceof Error ? error.message : "unknown error"
            }).`
          });
        }
      }
      const newIds = [...copyBySourceId.values()];
      if (newIds.length === 0) return [];
      await republishLibrary();

      const current = get().project;
      if (!current) return newIds;
      if (current.id !== projectId) {
        set({
          error:
            "The copies were saved to the library, but were not added because the open project changed."
        });
        return newIds;
      }

      const checklisted = new Set(current.checklistArtworkIds);
      const addedIds = [...copyBySourceId]
        .filter(([sourceId]) => checklisted.has(sourceId))
        .map(([, copyId]) => copyId);
      if (addedIds.length === 0) return newIds;

      const label =
        addedIds.length === 1 ? "Duplicate artwork" : `Duplicate ${addedIds.length} works`;
      await applyEdit(label, (project) => ({
        ...project,
        // Each copy lands directly after its own source.
        checklistArtworkIds: project.checklistArtworkIds.flatMap((id) => {
          const copyId = copyBySourceId.get(id);
          return copyId ? [id, copyId] : [id];
        })
      }));
      if (addedIds.length === 1) get().selectArtwork(addedIds[0]);
      return newIds;
    },

    async createBlankArtwork(input) {
      const project = get().project;
      if (!project) return null;
      const projectId = project.id;

      const artist = input.artist?.trim();
      let artwork: Artwork;
      try {
        artwork = parseArtwork({
          id: newId(),
          schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
          title: input.title?.trim() || "Untitled",
          ...(artist ? { artist } : {}),
          dimensions: { widthMm: input.widthMm, heightMm: input.heightMm, status: "known" },
          placementForm: input.placementForm,
          metadata: {}
        });
      } catch {
        set({ error: "Could not add that work (check its width and height)." });
        return null;
      }

      // The record is written outside history (intake's rule); the undo entry
      // covers only checklist membership.
      try {
        await deps.artworkLibraryRepository.save(artwork);
      } catch (error) {
        set({
          error: `Could not add that work (${
            error instanceof Error ? error.message : "unknown error"
          }).`
        });
        return null;
      }
      await republishLibrary();

      if (get().project?.id !== projectId) {
        set({
          error:
            "The work was saved to the library, but was not added because the open project changed."
        });
        return artwork.id;
      }
      await applyEdit("Add artwork", (current) => ({
        ...current,
        checklistArtworkIds: [...current.checklistArtworkIds, artwork.id]
      }));
      get().selectArtwork(artwork.id);
      return artwork.id;
    },

    async setArtworkImage(artworkId, file) {
      const projectId = get().project?.id;

      const processResult = await processImageFile(file, deps.imageProcessor);
      if (!processResult.ok) {
        set({ error: `Could not use that image (${processResult.reason}).` });
        return;
      }
      // Always a NEW asset, never a hash match against an existing one: the
      // old asset stays exactly as it was so undo can point back at it.
      const asset = buildImageAsset(file, processResult.processed);
      try {
        await deps.assetRepository.saveAsset(asset, {
          original: processResult.processed.original,
          display: processResult.processed.display,
          thumbnail: processResult.processed.thumbnail
        });
      } catch (error) {
        set({
          error: `Could not use that image (${
            error instanceof Error ? error.message : "it could not be saved"
          }).`
        });
        return;
      }

      // Re-read AFTER processing: the work may have been edited, deleted, or
      // the project switched while the image was being processed.
      const latest = get().libraryArtworks.find((artwork) => artwork.id === artworkId);
      if (!latest) {
        set({ error: "That work was deleted before its image finished processing." });
        return;
      }
      if (get().project?.id !== projectId) {
        set({ error: "The image was saved, but not applied because the open project changed." });
        return;
      }
      await get().setArtworkAssetId(
        artworkId,
        asset.id,
        latest.assetId ? "Replace image" : "Add image"
      );
    },

    async removeArtworkImage(artworkId) {
      const latest = get().libraryArtworks.find((artwork) => artwork.id === artworkId);
      if (!latest?.assetId) return;
      await get().setArtworkAssetId(artworkId, undefined, "Remove image");
    },

    async deleteLibraryArtworks(artworkIds) {
      // Deleting from the library is a full cascade: the library record and
      // its blobs are the source of truth, so every project that references
      // a deleted id must be stripped of that reference — no dangling
      // placements or checklist entries survive anywhere (docs/plan.md §4.1
      // inverted: remove from checklist leaves the record; deleting the
      // record removes it from every checklist).
      const requested = new Set(artworkIds);
      const targets = get().libraryArtworks.filter((artwork) => requested.has(artwork.id));
      if (targets.length === 0) return;
      const targetIds = new Set(targets.map((artwork) => artwork.id));
      const retainedAssetIds = new Set(
        get()
          .libraryArtworks.filter((artwork) => !targetIds.has(artwork.id))
          .flatMap((artwork) => (artwork.assetId ? [artwork.assetId] : []))
      );

      // Strip every reference to a deleted artwork from a project, returning
      // a fresh project only when something actually changed (so the cascade
      // skips saving untouched projects).
      const stripReferences = (project: Project): Project | null => {
        const checklistArtworkIds = project.checklistArtworkIds.filter(
          (id) => !targetIds.has(id)
        );
        const wallObjects = project.wallObjects.filter(
          (wallObject) =>
            !(wallObject.kind === "artwork" && targetIds.has(wallObject.artworkId))
        );
        const floorObjects = project.floorObjects.filter(
          (floorObject) =>
            !(floorObject.kind === "artwork" && targetIds.has(floorObject.artworkId))
        );
        const changed =
          checklistArtworkIds.length !== project.checklistArtworkIds.length ||
          wallObjects.length !== project.wallObjects.length ||
          floorObjects.length !== project.floorObjects.length;
        if (!changed) return null;
        return {
          ...project,
          checklistArtworkIds,
          wallObjects,
          floorObjects,
          updatedAt: new Date().toISOString()
        };
      };

      const openProject = get().project;

      // Cascade across every OTHER saved project. The open one is handled in
      // memory below (its persisted copy tracks state via applyEdit, but we
      // must also update the live `project` so the UI stops rendering the
      // removed placements). Per-project load/save failures are swallowed so
      // one bad project can't strand the rest — mirrors
      // listArtworkProjectMemberships' tolerance.
      try {
        const summaries = await deps.projectRepository.list();
        for (const summary of summaries) {
          if (openProject && summary.id === openProject.id) continue;
          try {
            const project = await deps.projectRepository.load(summary.id);
            const cleaned = stripReferences(project);
            if (cleaned) await deps.projectRepository.save(cleaned);
          } catch {
            // Skip a project that vanished or won't save; keep cascading.
          }
        }
      } catch {
        // If the list itself fails, still clean the open project and delete
        // the records below — a partial cascade beats leaving live state
        // pointing at records we're about to erase.
      }

      // HISTORY SAFETY. Undo/redo re-save an entry's artwork halves and
      // reinstall its project halves, so a stack still naming a deleted work
      // would resurrect its record (artwork halves) or its checklist entry and
      // placements (project halves). Drop every entry that carries a deleted
      // work's artwork half, strip deleted works out of every surviving
      // project half, and keep alive every asset a surviving entry can still
      // point a work back at (a replaced image's old asset, say).
      const artworkHalvesOf = (entry: EditEntry) => [
        ...(entry.artwork ? [entry.artwork] : []),
        ...(entry.artworks ?? [])
      ];
      // Halves naming a deleted work are removed individually, so a bulk
      // entry that also edited surviving works keeps those works' undo; an
      // entry is dropped only when nothing undoable is left in it.
      const isDeletedHalf = (half: { before: Artwork; after: Artwork }) =>
        targetIds.has(half.before.id) || targetIds.has(half.after.id);
      const cleanStack = (stack: EditEntry[]): EditEntry[] =>
        stack.flatMap((entry): EditEntry[] => {
          const next: EditEntry = { label: entry.label };
          if (entry.artwork && !isDeletedHalf(entry.artwork)) next.artwork = entry.artwork;
          const halves = entry.artworks?.filter((half) => !isDeletedHalf(half));
          if (halves && halves.length > 0) next.artworks = halves;
          if (entry.project) {
            next.project = {
              before: stripReferences(entry.project.before) ?? entry.project.before,
              after: stripReferences(entry.project.after) ?? entry.project.after
            };
          }
          const hadArtworkHalves = artworkHalvesOf(entry).length > 0;
          const hasArtworkHalves = artworkHalvesOf(next).length > 0;
          if (!next.project && !hasArtworkHalves) return [];
          // An entry that only edited deleted works, alongside a project half,
          // would replay a project change detached from its artwork change.
          if (hadArtworkHalves && !hasArtworkHalves) return [];
          return [next];
        });
      const undoStack = cleanStack(get().undoStack);
      const redoStack = cleanStack(get().redoStack);
      for (const entry of [...undoStack, ...redoStack]) {
        for (const half of artworkHalvesOf(entry)) {
          if (half.before.assetId) retainedAssetIds.add(half.before.assetId);
          if (half.after.assetId) retainedAssetIds.add(half.after.assetId);
        }
      }
      set({ undoStack, redoStack });

      // Permanent record deletion must not create an undoable project edit.
      if (openProject) {
        const cleaned = stripReferences(openProject);
        if (cleaned) {
          // Drop any selection pointing at a removed placement or a deleted
          // library-artwork pick; leave an unaffected selection intact.
          const removedPlacementIds = new Set(
            [...openProject.wallObjects, ...openProject.floorObjects]
              .filter(
                (object) => object.kind === "artwork" && targetIds.has(object.artworkId)
              )
              .map((object) => object.id)
          );
          let selection = get().selection;
          if (selection.kind === "objects") {
            selection = {
              kind: "objects",
              ids: selection.ids.filter((id) => !removedPlacementIds.has(id))
            };
          } else if (
            selection.kind === "libraryArtwork" &&
            targetIds.has(selection.artworkId)
          ) {
            selection = NO_SELECTION;
          }
          set({
            project: cleaned,
            ...selectionWrite(cleaned, selection, get().wallContextId)
          });
          await persist(cleaned);
        }
      }

      // Erase the records and their 1:1 blobs. Individual failures are
      // tolerated but surfaced together at the end.
      let failureMessage: string | null = null;
      for (const artwork of targets) {
        try {
          await deps.artworkLibraryRepository.delete(artwork.id);
          // Package SHA dedupe can intentionally make multiple artworks
          // share one asset. Delete its blobs only after the last artwork
          // reference is removed.
          if (artwork.assetId && !retainedAssetIds.has(artwork.assetId)) {
            await deps.assetRepository.delete(artwork.assetId);
          }
        } catch (error) {
          failureMessage = error instanceof Error ? error.message : "unknown error";
        }
      }

      try {
        await republishLibrary();
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : "unknown error";
      }

      if (failureMessage) {
        set({
          error: `Could not delete ${
            targets.length === 1 ? "that work" : "some works"
          } from the library (${failureMessage}).`
        });
      }
    }
  };

  return { actions };
}
