import { create } from "zustand";
import { z } from "zod";
import { createBrowserImageProcessor } from "../domain/assets/browserImageProcessor";
import { titleFromFilename, validateImageFile, type ImageProcessor } from "../domain/assets/imageIntake";
import { createNextRectangleRoom } from "../domain/geometry/createRoom";
import { resizeWallPreservingAngles } from "../domain/geometry/editRoom";
import { getWallsWithGeometry } from "../domain/geometry/walls";
import { createBlankProject } from "../domain/newProject";
import {
  createOpeningPlacement,
  getOpeningKindLabel,
  type OpeningKind
} from "../domain/placement/createOpening";
import { createArtworkPlacement, getEffectivePlacementSizeMm } from "../domain/placement/placeArtwork";
import type { PlacementWarning } from "../domain/placement/validatePlacement";
import {
  validateChangedWallPlacements,
  validateWallObjectPlacements
} from "../domain/placement/validatePlacement";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  CURRENT_ASSET_SCHEMA_VERSION,
  type Artwork,
  type Asset,
  type DisplayUnit,
  type Project,
  type ProjectSummary,
  type Wall
} from "../domain/project";
import type { ArtworkLibraryRepository } from "../domain/repositories/artworkLibraryRepository";
import { assetBlobKey, type AssetRepository } from "../domain/repositories/assetRepository";
import { IndexedDbArtworkLibraryRepository } from "../domain/repositories/indexedDbArtworkLibraryRepository";
import { IndexedDbAssetRepository } from "../domain/repositories/indexedDbAssetRepository";
import { IndexedDbProjectRepository } from "../domain/repositories/indexedDbProjectRepository";
import type { ProjectRepository } from "../domain/repositories/projectRepository";
import { createSampleProject } from "../domain/sample/sampleProject";
import { parseArtwork } from "../domain/schema/artworkSchema";
import { migrateProjectJson } from "../domain/schema/projectSchema";

type ViewMode = "plan" | "elevation" | "data";

// An entry may carry either half, or both. A pure geometry/metadata edit
// (resize a wall, rename the project) only ever needs `project`. A checklist
// artwork edit (updateArtwork) only needs `artwork` — unless the edit also
// resizes a placement on a wall, in which case both halves ride together so
// undo reverts the artwork record and the placement it drove in one step
// (docs/plan.md §7: "a single command stack lives at the project level").
type EditEntry = {
  label: string;
  project?: { before: Project; after: Project };
  artwork?: { before: Artwork; after: Artwork };
};

const UNDO_STACK_LIMIT = 100;

// Collisions between an artwork and a door/window/blocked-zone are rejected
// by default (see validatePlacement.ts's "collision" warning type) — the
// caller opts in per-call via allowOverlap, sourced from the workspace's
// "Allow overlap" view option, so a curator who genuinely wants to stack
// pieces over an obstacle for now isn't blocked outright.
const OVERLAP_BLOCKED_MESSAGE =
  'Can’t place it there — it would overlap another object on this wall. Turn on "Allow overlap" in view options to allow it.';

type GeometryEditInfo = {
  anchorVertexId: string;
  changedWallIds: string[];
};

type UpdateArtworkChanges = Partial<
  Pick<Artwork, "title" | "artist" | "date" | "accessionNumber" | "locationOrLender" | "dimensions">
>;

type AppState = {
  project: Project | null;
  selectedWallId: string | null;
  selectedArtworkId: string | null;
  selectedOpeningId: string | null;
  viewMode: ViewMode;
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
  placementWarnings: PlacementWarning[];
  lastGeometryEdit: GeometryEditInfo | null;
  undoStack: EditEntry[];
  redoStack: EditEntry[];
  libraryArtworks: Artwork[];
  intakeState: "idle" | "processing";
  boot: () => Promise<void>;
  setViewMode: (viewMode: ViewMode) => void;
  selectWall: (wallId: string) => void;
  selectArtwork: (artworkId: string) => void;
  selectOpening: (wallObjectId: string) => void;
  renameProject: (title: string) => Promise<void>;
  setUnit: (unit: DisplayUnit) => Promise<void>;
  addRectangleRoom: () => Promise<void>;
  resizeWall: (wallId: string, lengthMm: number) => Promise<void>;
  resizeSelectedWall: (lengthMm: number) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  importProjectJson: (text: string) => Promise<void>;
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  openProject: (id: string) => Promise<void>;
  createProject: (title: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addArtworksFromFiles: (files: File[]) => Promise<void>;
  removeArtworkFromChecklist: (artworkId: string) => Promise<void>;
  updateArtwork: (artworkId: string, changes: UpdateArtworkChanges) => Promise<void>;
  placeArtwork: (
    artworkId: string,
    wallId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  moveArtworkPlacement: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  removePlacement: (wallObjectId: string) => Promise<void>;
  addOpening: (wallId: string, kind: OpeningKind) => Promise<void>;
  moveOpening: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  resizeOpening: (
    wallObjectId: string,
    widthMm: number,
    heightMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
};

export type AppStoreDeps = {
  projectRepository: ProjectRepository;
  artworkLibraryRepository: ArtworkLibraryRepository;
  assetRepository: AssetRepository;
  imageProcessor: ImageProcessor;
};

export function createAppStore(deps: AppStoreDeps) {
  return create<AppState>((set, get) => {
    async function persist(project: Project) {
      set({ saveState: "saving", error: null });

      try {
        await deps.projectRepository.save(project);
        set({ saveState: "saved" });
      } catch (error) {
        set({
          saveState: "error",
          error: error instanceof Error ? error.message : "Could not save project."
        });
      }
    }

    type EditExtras = Partial<
      Pick<
        AppState,
        | "placementWarnings"
        | "lastGeometryEdit"
        | "selectedWallId"
        | "selectedArtworkId"
        | "selectedOpeningId"
        | "viewMode"
      >
    >;

    // Pushes one entry onto the undo stack and applies whichever half(s) it
    // carries to state — project-only, artwork-only, or both (see EditEntry
    // above). Split out from applyEdit so updateArtwork can push a single
    // combined entry when a dimension edit also resizes a placement.
    function pushEditEntry(entry: EditEntry, extras: EditExtras = {}) {
      set({
        ...(entry.project ? { project: entry.project.after } : {}),
        undoStack: [...get().undoStack, entry].slice(-UNDO_STACK_LIMIT),
        redoStack: [],
        placementWarnings: [],
        lastGeometryEdit: null,
        ...extras
      });
    }

    // Every project-only mutation flows through here: stamp updatedAt, push
    // the undo stack, drop the redo stack, persist. Actions stay thin
    // constructors. (An edit that also touches the artwork library —
    // updateArtwork — builds its EditEntry directly and calls pushEditEntry
    // itself, since it needs to persist both halves.)
    async function applyEdit(
      label: string,
      buildNextProject: (project: Project) => Project,
      extras: EditExtras = {}
    ) {
      const before = get().project;
      if (!before) return;

      const after = {
        ...buildNextProject(before),
        updatedAt: new Date().toISOString()
      };

      pushEditEntry({ label, project: { before, after } }, extras);
      await persist(after);
    }

    // Shared by undo/redo to reapply an entry's artwork half: save the given
    // side of the artwork to the library and refresh libraryArtworks from
    // it, the same shape as a forward updateArtwork commit.
    async function saveArtworkHalf(artwork: Artwork) {
      try {
        await deps.artworkLibraryRepository.save(artwork);
        set({ libraryArtworks: await deps.artworkLibraryRepository.list() });
      } catch (error) {
        set({
          saveState: "error",
          error: error instanceof Error ? error.message : "Could not save the artwork library."
        });
      }
    }

    // Replacing the whole document (boot, import, reset) starts a new edit
    // history — undoing across a document swap would resurrect the old one.
    function setDocument(project: Project, extras: Partial<AppState> = {}) {
      set({
        project,
        selectedWallId: getFirstWall(project)?.id ?? null,
        selectedArtworkId: null,
        selectedOpeningId: null,
        placementWarnings: [],
        lastGeometryEdit: null,
        undoStack: [],
        redoStack: [],
        error: null,
        ...extras
      });
    }

    return {
      project: null,
      selectedWallId: null,
      selectedArtworkId: null,
      selectedOpeningId: null,
      viewMode: "plan",
      saveState: "idle",
      error: null,
      placementWarnings: [],
      lastGeometryEdit: null,
      undoStack: [],
      redoStack: [],
      libraryArtworks: [],
      intakeState: "idle",

      async boot() {
        // The library is a secondary document from the project's point of
        // view (docs/plan.md §4.1) — a failure to load it shouldn't take
        // down boot the way a failed project load does. Keep it empty and
        // say so calmly, but only if nothing more important already needs
        // to be surfaced.
        let libraryArtworks: Artwork[] = [];
        let libraryError: string | null = null;
        try {
          libraryArtworks = await deps.artworkLibraryRepository.list();
        } catch (error) {
          libraryError = `Could not load the artwork library (${
            error instanceof Error ? error.message : "unknown error"
          }). Your project is unaffected — try reloading to pick the library back up.`;
        }

        try {
          const summaries = await deps.projectRepository.list();
          const project = summaries[0]
            ? await deps.projectRepository.load(summaries[0].id)
            : createSampleProject();

          if (!summaries[0]) {
            await deps.projectRepository.save(project);
          }

          setDocument(project, { saveState: "saved", libraryArtworks, error: libraryError });
        } catch (error) {
          // Keep the app usable with an in-memory sample, but say plainly that
          // the saved project could not load — never silently substitute.
          // The project load failure is the more important message here, so
          // it wins over any calmer library-load note.
          setDocument(createSampleProject(), {
            saveState: "error",
            libraryArtworks,
            error: `Could not load the saved project (${
              error instanceof Error ? error.message : "unknown error"
            }). Showing an unsaved sample instead — your data is still in browser storage.`
          });
        }
      },

      setViewMode(viewMode) {
        set({ viewMode });
      },

      selectWall(wallId) {
        // Wall focus replaces artwork/opening focus in the inspector — the
        // three selections are mutually exclusive, not independent.
        set({ selectedWallId: wallId, selectedArtworkId: null, selectedOpeningId: null });
      },

      selectArtwork(artworkId) {
        set({ selectedArtworkId: artworkId, selectedOpeningId: null });
      },

      selectOpening(wallObjectId) {
        set({ selectedOpeningId: wallObjectId, selectedArtworkId: null });
      },

      async renameProject(title) {
        const project = get().project;
        const trimmed = title.trim();
        if (!project || trimmed.length === 0 || trimmed === project.title) return;

        await applyEdit("Rename project", (current) => ({
          ...current,
          title: trimmed
        }));
      },

      async setUnit(unit) {
        const project = get().project;
        if (!project || project.unit === unit) return;

        await applyEdit("Change display unit", (current) => ({
          ...current,
          unit
        }));
      },

      async addRectangleRoom() {
        const project = get().project;
        if (!project) return;

        const roomPlacement = createNextRectangleRoom(
          project.floor,
          project.defaultWallHeightMm
        );

        await applyEdit(
          `Add ${roomPlacement.room.name}`,
          (current) => ({
            ...current,
            floor: { rooms: [...current.floor.rooms, roomPlacement] }
          }),
          {
            selectedWallId: roomPlacement.room.walls[0]?.id ?? null,
            viewMode: "plan"
          }
        );
      },

      async resizeWall(wallId, lengthMm) {
        const project = get().project;
        if (!project) return;

        const result = resizeWallPreservingAngles(project, wallId, lengthMm);
        if (result.changedWallIds.length === 0) return;

        const placementWarnings = validateChangedWallPlacements(
          result.project,
          result.changedWallIds
        );

        await applyEdit("Resize wall", () => result.project, {
          placementWarnings,
          lastGeometryEdit: {
            anchorVertexId: result.anchorVertexId,
            changedWallIds: result.changedWallIds
          }
        });
      },

      async resizeSelectedWall(lengthMm) {
        const selectedWallId = get().selectedWallId;
        if (!selectedWallId) return;

        await get().resizeWall(selectedWallId, lengthMm);
      },

      async undo() {
        const entry = get().undoStack.at(-1);
        if (!entry) return;

        set({
          ...(entry.project ? { project: entry.project.before } : {}),
          undoStack: get().undoStack.slice(0, -1),
          redoStack: [...get().redoStack, entry],
          placementWarnings: [],
          lastGeometryEdit: null
        });

        if (entry.project) await persist(entry.project.before);
        if (entry.artwork) await saveArtworkHalf(entry.artwork.before);
      },

      async redo() {
        const entry = get().redoStack.at(-1);
        if (!entry) return;

        set({
          ...(entry.project ? { project: entry.project.after } : {}),
          redoStack: get().redoStack.slice(0, -1),
          undoStack: [...get().undoStack, entry],
          placementWarnings: [],
          lastGeometryEdit: null
        });

        if (entry.project) await persist(entry.project.after);
        if (entry.artwork) await saveArtworkHalf(entry.artwork.after);
      },

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
          set({
            error: `Import failed: ${
              error instanceof Error ? error.message : "the file could not be read."
            }`
          });
          return;
        }

        setDocument(project, { viewMode: "plan" });
        await persist(project);
      },

      async listProjectSummaries() {
        try {
          return await deps.projectRepository.list();
        } catch {
          return [];
        }
      },

      async openProject(id) {
        if (get().project?.id === id) return;

        set({ saveState: "saving", error: null });

        try {
          const project = await deps.projectRepository.load(id);
          setDocument(project, { viewMode: "plan", saveState: "saved" });
        } catch (error) {
          set({
            saveState: "error",
            error: `Could not open that project (${
              error instanceof Error ? error.message : "unknown error"
            }).`
          });
        }
      },

      async createProject(title) {
        const project = createBlankProject(title);
        set({ saveState: "saving", error: null });

        try {
          await deps.projectRepository.save(project);
          setDocument(project, { viewMode: "plan", saveState: "saved" });
        } catch (error) {
          set({
            saveState: "error",
            error: `Could not create the new project (${
              error instanceof Error ? error.message : "unknown error"
            }).`
          });
        }
      },

      async deleteProject(id) {
        const wasOpen = get().project?.id === id;

        try {
          await deps.projectRepository.delete(id);
        } catch (error) {
          set({
            saveState: "error",
            error: `Could not delete that project (${
              error instanceof Error ? error.message : "unknown error"
            }).`
          });
          return;
        }

        if (!wasOpen) return;

        // The open project just disappeared out from under the user —
        // fall back to another saved project, or start a fresh one so the
        // app never sits on a document that no longer exists.
        const summaries = await deps.projectRepository.list();

        if (summaries[0]) {
          await get().openProject(summaries[0].id);
        } else {
          await get().createProject("Untitled Exhibition");
        }
      },

      async addArtworksFromFiles(files) {
        const project = get().project;
        if (!project || files.length === 0) return;

        set({ intakeState: "processing", error: null });

        const newArtworkIds: string[] = [];
        const failures: string[] = [];

        try {
          for (const file of files) {
            const validation = validateImageFile(file);
            if (!validation.ok) {
              failures.push(validation.reason);
              continue;
            }

            let processed;
            try {
              processed = await deps.imageProcessor.process(file);
            } catch (error) {
              failures.push(
                error instanceof Error ? error.message : `${file.name} could not be processed.`
              );
              continue;
            }

            const assetId = crypto.randomUUID();
            const asset: Asset = {
              id: assetId,
              schemaVersion: CURRENT_ASSET_SCHEMA_VERSION,
              mimeType: file.type,
              originalFilename: file.name,
              originalKey: assetBlobKey(assetId, "original"),
              displayKey: assetBlobKey(assetId, "display"),
              thumbnailKey: assetBlobKey(assetId, "thumbnail"),
              widthPx: processed.widthPx,
              heightPx: processed.heightPx,
              byteSize: processed.byteSize,
              sha256: processed.sha256
            };

            const artwork: Artwork = {
              id: crypto.randomUUID(),
              schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
              title: titleFromFilename(file.name),
              dimensions: { status: "unknown" },
              assetId,
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
            set({ libraryArtworks: await deps.artworkLibraryRepository.list() });

            const label =
              newArtworkIds.length === 1 ? "Add artwork" : `Add ${newArtworkIds.length} artworks`;

            await applyEdit(label, (current) => ({
              ...current,
              checklistArtworkIds: [...current.checklistArtworkIds, ...newArtworkIds]
            }));
          }

          if (failures.length > 0) {
            set({
              error: `${failures.length} of ${files.length} image${
                files.length === 1 ? "" : "s"
              } could not be added: ${failures.join(" ")}`
            });
          }
        } finally {
          set({ intakeState: "idle" });
        }
      },

      async removeArtworkFromChecklist(artworkId) {
        const project = get().project;
        if (!project) return;

        const isChecklisted = project.checklistArtworkIds.includes(artworkId);
        const isPlaced = project.wallObjects.some(
          (wallObject) => wallObject.kind === "artwork" && wallObject.artworkId === artworkId
        );
        if (!isChecklisted && !isPlaced) return;

        // Removing from a checklist unlinks it from this project only — the
        // library record is untouched (docs/plan.md §4.1). Also drops any
        // placement referencing this artwork — a checklist entry with a
        // dangling placement would be an invalid state to leave behind.
        await applyEdit("Remove from checklist", (current) => ({
          ...current,
          checklistArtworkIds: current.checklistArtworkIds.filter((id) => id !== artworkId),
          wallObjects: current.wallObjects.filter(
            (wallObject) => !(wallObject.kind === "artwork" && wallObject.artworkId === artworkId)
          )
        }));
      },

      async updateArtwork(artworkId, changes) {
        const before = get().libraryArtworks.find((artwork) => artwork.id === artworkId);
        if (!before) return;

        const next: Artwork = { ...before, ...changes };
        const touchedKeys = Object.keys(changes) as (keyof UpdateArtworkChanges)[];
        const hasChange = touchedKeys.some(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(next[key])
        );
        if (!hasChange) return;

        let parsed: Artwork;
        try {
          parsed = parseArtwork(next);
        } catch (error) {
          // Validate before touching anything persisted — a bad edit (e.g. a
          // negative widthMm) should error calmly and leave the library,
          // project, and undo stack exactly as they were.
          set({
            error: `Could not save that change (${
              error instanceof z.ZodError ? formatZodIssue(error) : "invalid value."
            }).`
          });
          return;
        }

        // A dimension edit should resize any placement of this artwork that
        // doesn't have its own displayDimensionsOverride (docs/plan.md
        // §4.2) — otherwise the wall would silently drift out of sync with
        // the library record it renders. Both halves ride in one EditEntry
        // so undo reverts the artwork and the placement size together.
        const project = get().project;
        let projectEdit: { before: Project; after: Project } | undefined;
        let placementWarnings: PlacementWarning[] = [];

        if (project) {
          const affectedIds: string[] = [];
          const nextWallObjects = project.wallObjects.map((wallObject) => {
            if (
              wallObject.kind !== "artwork" ||
              wallObject.artworkId !== artworkId ||
              wallObject.displayDimensionsOverride
            ) {
              return wallObject;
            }

            const size = getEffectivePlacementSizeMm(parsed.dimensions);
            if (size.widthMm === wallObject.widthMm && size.heightMm === wallObject.heightMm) {
              return wallObject;
            }

            affectedIds.push(wallObject.id);
            return { ...wallObject, widthMm: size.widthMm, heightMm: size.heightMm };
          });

          if (affectedIds.length > 0) {
            const after = {
              ...project,
              wallObjects: nextWallObjects,
              updatedAt: new Date().toISOString()
            };
            projectEdit = { before: project, after };
            placementWarnings = validateWallObjectPlacements(after, affectedIds);
          }
        }

        pushEditEntry(
          {
            label: "Edit artwork",
            artwork: { before, after: parsed },
            ...(projectEdit ? { project: projectEdit } : {})
          },
          { placementWarnings }
        );

        await saveArtworkHalf(parsed);
        if (projectEdit) await persist(projectEdit.after);
      },

      async placeArtwork(artworkId, wallId, xMm, yMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const artwork = get().libraryArtworks.find((candidate) => candidate.id === artworkId);
        if (!artwork) return;
        if (!getProjectWalls(project).some((wall) => wall.id === wallId)) return;

        const placement = createArtworkPlacement(artwork, wallId, xMm, yMm);
        const nextWallObjects = [...project.wallObjects, placement];
        const placementWarnings = validateWallObjectPlacements(
          { ...project, wallObjects: nextWallObjects },
          [placement.id]
        );

        if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
          set({ error: OVERLAP_BLOCKED_MESSAGE });
          return;
        }

        await applyEdit(
          "Place artwork",
          (current) => ({ ...current, wallObjects: nextWallObjects }),
          { placementWarnings, selectedArtworkId: artworkId }
        );
      },

      async moveArtworkPlacement(wallObjectId, xMm, yMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || (target.xMm === xMm && target.yMm === yMm)) return;

        const nextWallObjects = project.wallObjects.map((wallObject) =>
          wallObject.id === wallObjectId ? { ...wallObject, xMm, yMm } : wallObject
        );
        const placementWarnings = validateWallObjectPlacements(
          { ...project, wallObjects: nextWallObjects },
          [wallObjectId]
        );

        if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
          set({ error: OVERLAP_BLOCKED_MESSAGE });
          return;
        }

        // The UI previews the drag locally and calls this exactly once on
        // release (docs/plan.md §7) — one call here is already one undo
        // entry, nothing extra to batch.
        await applyEdit(
          "Move artwork",
          (current) => ({ ...current, wallObjects: nextWallObjects }),
          { placementWarnings }
        );
      },

      async removePlacement(wallObjectId) {
        const project = get().project;
        if (!project) return;
        if (!project.wallObjects.some((wallObject) => wallObject.id === wallObjectId)) return;

        // Removes the placement only — checklist membership is a separate
        // concept (docs/plan.md §4.1) and is untouched here. Generic over
        // wall object kind, so this same action deletes an opening too —
        // there's no checklist-membership concept to preserve for those.
        await applyEdit("Remove from wall", (current) => ({
          ...current,
          wallObjects: current.wallObjects.filter((wallObject) => wallObject.id !== wallObjectId)
        }));
      },

      async addOpening(wallId, kind) {
        const project = get().project;
        if (!project) return;

        const wall = getProjectWalls(project).find((candidate) => candidate.id === wallId);
        if (!wall) return;

        // Centered on the wall by default — the curator adjusts from there,
        // same "place first, refine after" spirit as artwork placement.
        const centerlineYMm = wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
        const placement = createOpeningPlacement(kind, wallId, wall.lengthMm / 2, centerlineYMm);
        const nextWallObjects = [...project.wallObjects, placement];

        await applyEdit(
          `Add ${openingNoun(kind)}`,
          (current) => ({ ...current, wallObjects: nextWallObjects }),
          {
            placementWarnings: validateWallObjectPlacements(
              { ...project, wallObjects: nextWallObjects },
              [placement.id]
            ),
            selectedOpeningId: placement.id,
            selectedArtworkId: null
          }
        );
      },

      async moveOpening(wallObjectId, xMm, yMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || target.kind === "artwork") return;
        if (target.xMm === xMm && target.yMm === yMm) return;

        const nextWallObjects = project.wallObjects.map((wallObject) =>
          wallObject.id === wallObjectId ? { ...wallObject, xMm, yMm } : wallObject
        );
        const placementWarnings = validateWallObjectPlacements(
          { ...project, wallObjects: nextWallObjects },
          [wallObjectId]
        );

        if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
          set({ error: OVERLAP_BLOCKED_MESSAGE });
          return;
        }

        // Same shape as moveArtworkPlacement: the UI previews the drag
        // locally and calls this exactly once on release.
        await applyEdit(
          `Move ${openingNoun(target.kind)}`,
          (current) => ({ ...current, wallObjects: nextWallObjects }),
          { placementWarnings }
        );
      },

      async resizeOpening(wallObjectId, widthMm, heightMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || target.kind === "artwork") return;
        if (target.widthMm === widthMm && target.heightMm === heightMm) return;

        const nextWallObjects = project.wallObjects.map((wallObject) =>
          wallObject.id === wallObjectId ? { ...wallObject, widthMm, heightMm } : wallObject
        );
        const placementWarnings = validateWallObjectPlacements(
          { ...project, wallObjects: nextWallObjects },
          [wallObjectId]
        );

        if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
          set({ error: OVERLAP_BLOCKED_MESSAGE });
          return;
        }

        await applyEdit(
          `Resize ${openingNoun(target.kind)}`,
          (current) => ({ ...current, wallObjects: nextWallObjects }),
          { placementWarnings }
        );
      }
    };
  });
}

// Lowercase noun for undo-stack labels ("Add door", "Move blocked zone"),
// matching the "Add artwork"/"Move artwork" label casing already in use —
// getOpeningKindLabel's Title Case is for UI headings/subjects instead.
function openingNoun(kind: OpeningKind): string {
  return getOpeningKindLabel(kind).toLowerCase();
}

function formatZodIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  const path = issue?.path.join(".");
  return `${path ? `${path}: ` : ""}${issue?.message ?? "invalid value."}`;
}

export const useAppStore = createAppStore({
  projectRepository: new IndexedDbProjectRepository(),
  artworkLibraryRepository: new IndexedDbArtworkLibraryRepository(),
  assetRepository: new IndexedDbAssetRepository(),
  imageProcessor: createBrowserImageProcessor()
});

export function exportProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function getProjectWalls(project: Project) {
  return project.floor.rooms.flatMap((placement) =>
    getWallsWithGeometry(placement.room)
  );
}

export function getSelectedWall(project: Project, selectedWallId: string | null) {
  const walls = getProjectWalls(project);
  return walls.find((wall) => wall.id === selectedWallId) ?? walls[0] ?? null;
}

function getFirstWall(project: Project): Wall | null {
  return project.floor.rooms[0]?.room.walls[0] ?? null;
}
