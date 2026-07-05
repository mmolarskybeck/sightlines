import { create } from "zustand";
import { z } from "zod";
import { createBrowserImageProcessor } from "../domain/assets/browserImageProcessor";
import { titleFromFilename, validateImageFile, type ImageProcessor } from "../domain/assets/imageIntake";
import { createNextRectangleRoom } from "../domain/geometry/createRoom";
import { resizeWallPreservingAngles } from "../domain/geometry/editRoom";
import { getWallsWithGeometry, type WallWithGeometry } from "../domain/geometry/walls";
import { getFloorWalls } from "../domain/geometry/planObjects";
import type { PlanPlacement } from "../domain/snapping/planSnapTargets";
import { createBlankProject } from "../domain/newProject";
import {
  createOpeningPlacement,
  getDefaultOpeningCenterYMm,
  getDefaultOpeningSizeMm,
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
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type ArtworkFloorObject,
  type Asset,
  type BlockedZoneFloorObject,
  type DisplayUnit,
  type FloorObject,
  type FloorObjectBase,
  type OpeningWallObject,
  type Project,
  type ProjectSummary,
  type Wall,
  type WallObject
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
  renameRoom: (roomId: string, name: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
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
  placeOpeningFromPlan: (kind: OpeningKind, placement: PlanPlacement) => Promise<void>;
  placeArtworkOnFloor: (artworkId: string, xMm: number, yMm: number) => Promise<void>;
  commitPlanMove: (
    objectId: string,
    placement: PlanPlacement,
    allowOverlap?: boolean
  ) => Promise<void>;
  updateFloorObject: (
    objectId: string,
    changes: Partial<Pick<FloorObjectBase, "xMm" | "yMm" | "widthMm" | "depthMm">>
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

      async renameRoom(roomId, name) {
        const project = get().project;
        const trimmed = name.trim();
        const roomPlacement = project?.floor.rooms.find(
          (placement) => placement.roomId === roomId
        );
        if (!project || !roomPlacement || trimmed.length === 0) return;
        if (trimmed === roomPlacement.room.name) return;

        await applyEdit("Rename room", (current) => ({
          ...current,
          floor: {
            rooms: current.floor.rooms.map((placement) =>
              placement.roomId === roomId
                ? { ...placement, room: { ...placement.room, name: trimmed } }
                : placement
            )
          }
        }));
      },

      async deleteRoom(roomId) {
        const project = get().project;
        const roomPlacement = project?.floor.rooms.find(
          (placement) => placement.roomId === roomId
        );
        if (!project || !roomPlacement) return;

        const deletedWallIds = new Set(
          roomPlacement.room.walls.map((wall) => wall.id)
        );
        const nextRooms = project.floor.rooms.filter(
          (placement) => placement.roomId !== roomId
        );
        const selectedWallId = get().selectedWallId;
        const selectedOpeningId = get().selectedOpeningId;
        const nextSelectedWallId = selectedWallId && deletedWallIds.has(selectedWallId)
          ? (nextRooms[0]?.room.walls[0]?.id ?? null)
          : selectedWallId;
        const nextSelectedOpeningId = selectedOpeningId && project.wallObjects.some(
          (wallObject) =>
            wallObject.id === selectedOpeningId && deletedWallIds.has(wallObject.wallId)
        )
          ? null
          : selectedOpeningId;

        await applyEdit(
          `Delete ${roomPlacement.room.name}`,
          (current) => ({
            ...current,
            floor: { rooms: nextRooms },
            wallObjects: current.wallObjects.filter(
              (wallObject) => !deletedWallIds.has(wallObject.wallId)
            )
          }),
          {
            selectedWallId: nextSelectedWallId,
            selectedOpeningId: nextSelectedOpeningId,
            viewMode: "plan"
          }
        );
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
        const isPlaced =
          project.wallObjects.some(
            (wallObject) => wallObject.kind === "artwork" && wallObject.artworkId === artworkId
          ) ||
          project.floorObjects.some(
            (floorObject) => floorObject.kind === "artwork" && floorObject.artworkId === artworkId
          );
        if (!isChecklisted && !isPlaced) return;

        // Removing from a checklist unlinks it from this project only — the
        // library record is untouched (docs/plan.md §4.1). Also drops any
        // placement referencing this artwork — on a wall or on the floor — a
        // checklist entry with a dangling placement would be an invalid state
        // to leave behind.
        await applyEdit("Remove from checklist", (current) => ({
          ...current,
          checklistArtworkIds: current.checklistArtworkIds.filter((id) => id !== artworkId),
          wallObjects: current.wallObjects.filter(
            (wallObject) => !(wallObject.kind === "artwork" && wallObject.artworkId === artworkId)
          ),
          floorObjects: current.floorObjects.filter(
            (floorObject) => !(floorObject.kind === "artwork" && floorObject.artworkId === artworkId)
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
          // Selecting the placed artwork must also clear any opening
          // selection — the two are mutually exclusive everywhere else
          // (selectArtwork/selectOpening/addOpening all clear the other).
          { placementWarnings, selectedArtworkId: artworkId, selectedOpeningId: null }
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
        const isWallObject = project.wallObjects.some(
          (wallObject) => wallObject.id === wallObjectId
        );
        const isFloorObject = project.floorObjects.some(
          (floorObject) => floorObject.id === wallObjectId
        );
        if (!isWallObject && !isFloorObject) return;

        // Removes the placement only — checklist membership is a separate
        // concept (docs/plan.md §4.1) and is untouched here. Generic over
        // object kind, so this same action deletes an opening or a
        // floor-placed object too (ids are unique across both arrays) —
        // there's no checklist-membership concept to preserve for those.
        await applyEdit("Remove from wall", (current) => ({
          ...current,
          wallObjects: current.wallObjects.filter((wallObject) => wallObject.id !== wallObjectId),
          floorObjects: current.floorObjects.filter((floorObject) => floorObject.id !== wallObjectId)
        }));
      },

      async addOpening(wallId, kind) {
        const project = get().project;
        if (!project) return;

        const wall = getProjectWalls(project).find((candidate) => candidate.id === wallId);
        if (!wall) return;

        // Centered on the wall by default — the curator adjusts from there,
        // same "place first, refine after" spirit as artwork placement.
        // buildOpeningOnWall is shared with placeOpeningFromPlan, whose only
        // difference is the chosen xMm (the plan drop point vs. wall center).
        const placement = buildOpeningOnWall(project, wall, kind, wall.lengthMm / 2);
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
      },

      async placeOpeningFromPlan(kind, placement) {
        const project = get().project;
        if (!project) return;

        if (placement.anchor === "floor") {
          // Only blocked zones can float. Doors and windows are excluded from
          // floor placement by the domain (FloorObject has no door/window
          // kind) and callers gate this on canFloat, so a door/window landing
          // here is an invariant break, not a user path — fail loudly.
          if (kind !== "blocked-zone") {
            throw new Error(
              `Cannot place a ${kind} on the floor — only blocked zones can be floor-placed.`
            );
          }

          const { widthMm, heightMm } = getDefaultOpeningSizeMm(kind);
          const floorObject: BlockedZoneFloorObject = {
            id: crypto.randomUUID(),
            kind: "blocked-zone",
            xMm: placement.xMm,
            yMm: placement.yMm,
            widthMm,
            depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM,
            rotationDeg: 0,
            heightMm,
            // Remembered hang-height for a later floor→wall conversion: the
            // same centerline default the object would take on a wall.
            wallYMm: getDefaultOpeningCenterYMm(kind, heightMm, project.defaultCenterlineHeightMm)
          };

          await applyEdit(
            `Add ${openingNoun(kind)}`,
            (current) => ({ ...current, floorObjects: [...current.floorObjects, floorObject] }),
            { selectedOpeningId: floorObject.id, selectedArtworkId: null }
          );
          return;
        }

        // Wall placement: identical to addOpening, but at the plan-chosen xMm
        // rather than the wall center.
        const wall = getProjectWalls(project).find((candidate) => candidate.id === placement.wallId);
        if (!wall) return;

        const opening = buildOpeningOnWall(project, wall, kind, placement.xMm);
        const nextWallObjects = [...project.wallObjects, opening];

        await applyEdit(
          `Add ${openingNoun(kind)}`,
          (current) => ({ ...current, wallObjects: nextWallObjects }),
          {
            placementWarnings: validateWallObjectPlacements(
              { ...project, wallObjects: nextWallObjects },
              [opening.id]
            ),
            selectedOpeningId: opening.id,
            selectedArtworkId: null
          }
        );
      },

      async placeArtworkOnFloor(artworkId, xMm, yMm) {
        const project = get().project;
        if (!project) return;

        const artwork = get().libraryArtworks.find((candidate) => candidate.id === artworkId);
        if (!artwork) return;

        const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions);
        const floorObject: ArtworkFloorObject = {
          id: crypto.randomUUID(),
          kind: "artwork",
          artworkId,
          xMm,
          yMm,
          widthMm,
          // A floor-standing sculpture's real depth if known, else the editable
          // default footprint depth.
          depthMm: artwork.dimensions.depthMm ?? DEFAULT_FLOOR_OBJECT_DEPTH_MM,
          rotationDeg: 0,
          heightMm,
          // Remembered hang-height center for a later floor→wall conversion.
          wallYMm: project.defaultCenterlineHeightMm
        };

        // Floor objects get no bounds/collision validation in v1 (no wall
        // bounds; 2-D footprint collision is a v2 candidate).
        await applyEdit(
          "Place artwork",
          (current) => ({ ...current, floorObjects: [...current.floorObjects, floorObject] }),
          { selectedArtworkId: artworkId, selectedOpeningId: null }
        );
      },

      async commitPlanMove(objectId, placement, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const wallObject = project.wallObjects.find((object) => object.id === objectId);
        const floorObject = project.floorObjects.find((object) => object.id === objectId);
        if (!wallObject && !floorObject) return;

        // --- Source: wall object -------------------------------------------
        if (wallObject) {
          if (placement.anchor === "wall") {
            // Same wall (x only) or re-anchor to another wall: either way the
            // hang height (yMm) and size are carried over unchanged — the
            // requirement is that an artwork keeps its height across a wall
            // change. No-op if nothing moved.
            if (wallObject.wallId === placement.wallId && wallObject.xMm === placement.xMm) {
              return;
            }

            const nextWallObjects = project.wallObjects.map((object) =>
              object.id === objectId
                ? { ...object, wallId: placement.wallId, xMm: placement.xMm }
                : object
            );
            const placementWarnings = validateWallObjectPlacements(
              { ...project, wallObjects: nextWallObjects },
              [objectId]
            );

            if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
              set({ error: OVERLAP_BLOCKED_MESSAGE });
              return;
            }

            await applyEdit(
              `Move ${moveObjectNoun(wallObject.kind)}`,
              (current) => ({ ...current, wallObjects: nextWallObjects }),
              { placementWarnings }
            );
            return;
          }

          // wall → floor conversion. Doors/windows must never leave a wall.
          if (wallObject.kind !== "artwork" && wallObject.kind !== "blocked-zone") {
            throw new Error(
              `A ${wallObject.kind} cannot be moved onto the floor — it must stay on a wall.`
            );
          }

          // Preserve the wall's floor-space angle so the freed object keeps
          // its orientation at the moment of release (0 if the wall vanished).
          const sourceWall = getFloorWalls(project.floor).find(
            (candidate) => candidate.id === wallObject.wallId
          );
          const rotationDeg = sourceWall ? (sourceWall.angleRad * 180) / Math.PI : 0;

          const base = {
            id: objectId,
            xMm: placement.xMm,
            yMm: placement.yMm,
            widthMm: wallObject.widthMm,
            rotationDeg,
            heightMm: wallObject.heightMm,
            // Remember the hang height so a later floor→wall conversion can
            // restore it.
            wallYMm: wallObject.yMm
          };

          let newFloorObject: FloorObject;
          if (wallObject.kind === "artwork") {
            const artwork = get().libraryArtworks.find(
              (candidate) => candidate.id === wallObject.artworkId
            );
            newFloorObject = {
              ...base,
              kind: "artwork",
              artworkId: wallObject.artworkId,
              depthMm:
                wallObject.displayDimensionsOverride?.depthMm ??
                artwork?.dimensions.depthMm ??
                DEFAULT_FLOOR_OBJECT_DEPTH_MM,
              ...(wallObject.displayDimensionsOverride
                ? { displayDimensionsOverride: wallObject.displayDimensionsOverride }
                : {})
            };
          } else {
            newFloorObject = {
              ...base,
              kind: "blocked-zone",
              depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
            };
          }

          // Selection survives for free: the id is preserved, and the
          // selection slots store the id (openings) / artworkId (artworks),
          // neither of which changes here.
          await applyEdit(
            `Move ${moveObjectNoun(wallObject.kind)}`,
            (current) => ({
              ...current,
              wallObjects: current.wallObjects.filter((object) => object.id !== objectId),
              floorObjects: [...current.floorObjects, newFloorObject]
            })
          );
          return;
        }

        // --- Source: floor object ------------------------------------------
        if (!floorObject) return; // unreachable — narrows the type below.

        if (placement.anchor === "floor") {
          if (floorObject.xMm === placement.xMm && floorObject.yMm === placement.yMm) {
            return;
          }

          const nextFloorObjects = project.floorObjects.map((object) =>
            object.id === objectId
              ? { ...object, xMm: placement.xMm, yMm: placement.yMm }
              : object
          );

          await applyEdit(`Move ${moveObjectNoun(floorObject.kind)}`, (current) => ({
            ...current,
            floorObjects: nextFloorObjects
          }));
          return;
        }

        // floor → wall conversion: restore the remembered hang height and
        // elevation height, reconstruct the kind-specific wall fields.
        const base = {
          id: objectId,
          wallId: placement.wallId,
          xMm: placement.xMm,
          yMm: floorObject.wallYMm,
          widthMm: floorObject.widthMm,
          heightMm: floorObject.heightMm
        };

        let newWallObject: WallObject;
        if (floorObject.kind === "artwork") {
          newWallObject = {
            ...base,
            kind: "artwork",
            artworkId: floorObject.artworkId,
            ...(floorObject.displayDimensionsOverride
              ? { displayDimensionsOverride: floorObject.displayDimensionsOverride }
              : {})
          };
        } else {
          newWallObject = { ...base, kind: "blocked-zone", blocksPlacement: true };
        }

        const nextWallObjects = [...project.wallObjects, newWallObject];
        const placementWarnings = validateWallObjectPlacements(
          { ...project, wallObjects: nextWallObjects },
          [objectId]
        );

        if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
          set({ error: OVERLAP_BLOCKED_MESSAGE });
          return;
        }

        await applyEdit(
          `Move ${moveObjectNoun(floorObject.kind)}`,
          (current) => ({
            ...current,
            floorObjects: current.floorObjects.filter((object) => object.id !== objectId),
            wallObjects: nextWallObjects
          }),
          { placementWarnings }
        );
      },

      async updateFloorObject(objectId, changes) {
        const project = get().project;
        if (!project) return;

        const target = project.floorObjects.find((object) => object.id === objectId);
        if (!target) return;

        const keys = ["xMm", "yMm", "widthMm", "depthMm"] as const;
        const hasChange = keys.some(
          (key) => changes[key] !== undefined && changes[key] !== target[key]
        );
        if (!hasChange) return;

        const nextFloorObjects = project.floorObjects.map((object) =>
          object.id === objectId ? { ...object, ...changes } : object
        );

        // Floor objects carry no wall bounds, so there's nothing to validate
        // here in v1 (see placeArtworkOnFloor).
        await applyEdit(`Edit ${moveObjectNoun(target.kind)}`, (current) => ({
          ...current,
          floorObjects: nextFloorObjects
        }));
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

// Lowercase noun for any placeable object (wall or floor), so a plan move's
// label reads "Move artwork" / "Move door" / "Move blocked zone" the same way
// whether the object is wall-anchored or floor-placed.
function moveObjectNoun(kind: WallObject["kind"]): string {
  return kind === "artwork" ? "artwork" : openingNoun(kind);
}

// Shared by addOpening (centers on the wall) and placeOpeningFromPlan (places
// at the plan-chosen xMm): builds the opening record with the wall's
// centerline default for y. The only thing that differs between the two
// callers is xMm, so the record construction lives in one place.
function buildOpeningOnWall(
  project: Project,
  wall: WallWithGeometry,
  kind: OpeningKind,
  xMm: number
): OpeningWallObject {
  const centerlineYMm = wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
  return createOpeningPlacement(kind, wall.id, xMm, centerlineYMm);
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
