import { create } from "zustand";
import { z } from "zod";
import { createBrowserImageProcessor } from "../domain/assets/browserImageProcessor";
import { titleFromFilename, validateImageFile, type ImageProcessor } from "../domain/assets/imageIntake";
import { createNextRectangleRoom } from "../domain/geometry/createRoom";
import { resizeWallPreservingAngles, type ResizeAnchor } from "../domain/geometry/editRoom";
import type { WallWithGeometry } from "../domain/geometry/walls";
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
import {
  arrangeOnWall,
  insetForGap,
  solveEqualArrangement
} from "../domain/placement/arrangeOnWall";
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
import { getFirstWall, getProjectWalls } from "./projectWalls";
export { getProjectWalls, getSelectedWall } from "./projectWalls";
import {
  ARRANGE_SLICE_INITIAL,
  createArrangeSlice,
  type ArrangeSliceActions,
  type ArrangeSliceState
} from "./store/arrangeSlice";
export type { ArrangeSession } from "./store/arrangeSlice";
import {
  NO_SELECTION,
  objectIdsOf,
  selectionWrite,
  type Selection
} from "./store/selectionSlice";
export {
  NO_SELECTION,
  objectIdsOf,
  roomIdOf,
  getSelectedArtworkId,
  getSelectedOpeningId
} from "./store/selectionSlice";
export type { Selection } from "./store/selectionSlice";

export type ViewMode = "plan" | "elevation" | "data" | "3d";

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

// One placement per artwork per project — trying layout variants is what
// project duplication is for (spec 2026-07-07). Enforced only on NEW
// placements; legacy projects that already contain duplicates keep them.
const ALREADY_PLACED_MESSAGE =
  "This artwork is already placed. To try another arrangement, duplicate the project and experiment there.";

type GeometryEditInfo = {
  anchorVertexId: string;
  changedWallIds: string[];
};

type UpdateArtworkChanges = Partial<
  Pick<Artwork, "title" | "artist" | "date" | "accessionNumber" | "locationOrLender" | "dimensions">
>;

export type AppState = ArrangeSliceState &
  ArrangeSliceActions & {
  project: Project | null;
  // The store's ONLY selection state: one discriminated union value (see
  // selectionSlice.ts). Written only via selectionWrite. Consumers derive
  // everything they need from it through the pure helpers (objectIdsOf,
  // roomIdOf, getSelectedArtworkId, getSelectedOpeningId).
  selection: Selection;
  // Persistent sidebar wall context. Survives object selection; dropped only by
  // room selection and full clears. NOT part of the selection union.
  wallContextId: string | null;
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
  selectRoom: (roomId: string) => void;
  selectObject: (id: string, opts?: { additive?: boolean }) => void;
  setObjectSelection: (ids: string[]) => void;
  clearObjectSelection: () => void;
  renameProject: (title: string) => Promise<void>;
  renameRoom: (roomId: string, name: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
  setUnit: (unit: DisplayUnit) => Promise<void>;
  addRectangleRoom: () => Promise<void>;
  resizeRoomHeight: (roomId: string, heightMm: number) => Promise<void>;
  resizeWall: (wallId: string, lengthMm: number, anchor?: ResizeAnchor) => Promise<void>;
  resizeSelectedWall: (lengthMm: number) => Promise<void>;
  moveRoom: (roomId: string, offsetXMm: number, offsetYMm: number) => Promise<void>;
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
  moveWallObjectsGroup: (
    moves: { id: string; xMm: number; yMm: number }[],
    allowOverlap?: boolean
  ) => Promise<void>;
  movePlanObjectsGroup: (
    moves: { id: string; xMm: number; yMm?: number }[],
    allowOverlap?: boolean
  ) => Promise<void>;
  arrangeSelectedOnWall: (
    params: { insetMm: number } | { gapMm: number } | { equal: true },
    allowOverlap?: boolean
  ) => Promise<void>;
  removeSelectedPlacements: () => Promise<void>;
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

    // Selection rides along as the whole {selection, wallContextId} bundle
    // (spread from selectionWrite), never as loose fields — so an edit that
    // changes selection can't set the union without its wall context.
    type EditExtras = Partial<
      Pick<
        AppState,
        | "placementWarnings"
        | "lastGeometryEdit"
        | "arrangeSession"
        | "viewMode"
        | "selection"
        | "wallContextId"
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
        // Any committed edit settles a pending arrange session by default — a
        // foreign edit (or the session's own commit, which re-passes this via
        // extras) can't leave a stale session pointing at pre-edit positions.
        arrangeSession: null,
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
        ...selectionWrite(project, NO_SELECTION, getFirstWall(project)?.id ?? null),
        arrangeSession: null,
        placementWarnings: [],
        lastGeometryEdit: null,
        undoStack: [],
        redoStack: [],
        error: null,
        ...extras
      });
    }

    // Shared commit path for a batch of wall-object x/y moves: all-or-nothing
    // collision gate (a single overlap blocks the whole batch), then one undo
    // entry. Extracted from moveWallObjectsGroup so the arrange session can
    // commit its preview through the exact same validation. Deliberately does
    // NOT persist — it returns the after-project so the caller decides whether
    // to `await persist` (group drag) or fire `void persist` (session settle,
    // which must finish its synchronous state changes before the caller
    // continues). The pushEditEntry `set()` here runs synchronously.
    function commitWallObjectMoves(
      moves: { id: string; xMm: number; yMm: number }[],
      label: string | ((movedCount: number) => string),
      allowOverlap: boolean,
      extras: EditExtras = {}
    ):
      | { status: "committed"; project: Project }
      | { status: "no-op" }
      | { status: "blocked" } {
      const project = get().project;
      if (!project) return { status: "no-op" };

      // A stale id (a member removed since the group was selected, e.g. by an
      // undo) is filtered out rather than treated as an error — the rest of
      // the group still moves.
      const applicable = moves.filter((move) =>
        project.wallObjects.some((wallObject) => wallObject.id === move.id)
      );
      if (applicable.length === 0) return { status: "no-op" };

      const moveById = new Map(applicable.map((move) => [move.id, move]));
      const movedIds: string[] = [];
      const nextWallObjects = project.wallObjects.map((wallObject) => {
        const move = moveById.get(wallObject.id);
        if (!move || (wallObject.xMm === move.xMm && wallObject.yMm === move.yMm)) {
          return wallObject;
        }
        movedIds.push(wallObject.id);
        return { ...wallObject, xMm: move.xMm, yMm: move.yMm };
      });
      if (movedIds.length === 0) return { status: "no-op" };

      // One batch is one commit: either every member's move lands together, or
      // a single collision anywhere blocks the whole thing.
      const placementWarnings = validateWallObjectPlacements(
        { ...project, wallObjects: nextWallObjects },
        movedIds
      );

      if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
        set({ error: OVERLAP_BLOCKED_MESSAGE });
        return { status: "blocked" };
      }

      const after = {
        ...project,
        wallObjects: nextWallObjects,
        updatedAt: new Date().toISOString()
      };
      const resolvedLabel = typeof label === "function" ? label(movedIds.length) : label;
      pushEditEntry(
        { label: resolvedLabel, project: { before: project, after } },
        { placementWarnings, ...extras }
      );
      return { status: "committed", project: after };
    }

    const arrange = createArrangeSlice(set, get, { commitWallObjectMoves, persist });
    const { settleArrangeSession, autoAcceptArrangeSession } = arrange;

    return {
      project: null,
      selection: NO_SELECTION,
      wallContextId: null,
      ...ARRANGE_SLICE_INITIAL,
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
        autoAcceptArrangeSession();
        set({ viewMode });
      },

      selectWall(wallId) {
        autoAcceptArrangeSession();
        // Wall focus clears the selection but keeps the wall as sidebar
        // context — a wall click is a fresh focus gesture, not an addition to
        // a group of placements, and it drops room focus (a selected room's
        // handles are a different, exclusive canvas mode).
        set(selectionWrite(get().project, NO_SELECTION, wallId));
      },

      selectArtwork(artworkId) {
        autoAcceptArrangeSession();
        const project = get().project;
        // Wart fix: a checklist click on a PLACED artwork selects its (first)
        // placement — wallObjects before floorObjects, the same resolution the
        // Delete handler uses — so Fit-selected, arrange, delete and highlight
        // all read one selection. An unplaced pick is inspector-only.
        const placement =
          project?.wallObjects.find(
            (object) => object.kind === "artwork" && object.artworkId === artworkId
          ) ??
          project?.floorObjects.find(
            (object) => object.kind === "artwork" && object.artworkId === artworkId
          );
        const selection: Selection = placement
          ? { kind: "objects", ids: [placement.id] }
          : { kind: "libraryArtwork", artworkId };
        set(selectionWrite(project, selection, get().wallContextId));
      },

      selectOpening(wallObjectId) {
        autoAcceptArrangeSession();
        const project = get().project;
        if (!project) return;
        // Openings are placements now — an opening selection is an objects
        // selection. Validate the id against the live project (same tolerance
        // as selectObject); a dead id is an inert no-op, not a clear.
        const exists =
          project.wallObjects.some((object) => object.id === wallObjectId) ||
          project.floorObjects.some((object) => object.id === wallObjectId);
        if (!exists) return;
        set(
          selectionWrite(project, { kind: "objects", ids: [wallObjectId] }, get().wallContextId)
        );
      },

      // Room focus for plan view's selection-scoped handles/wash — mutually
      // exclusive with every other selection (see the union's "room" kind), so
      // this is the one action, besides clearObjectSelection, that also drops
      // the wall context other selects leave untouched.
      selectRoom(roomId) {
        autoAcceptArrangeSession();
        set(selectionWrite(get().project, { kind: "room", roomId }, null));
      },

      // Placement multi-select: id must be a live wallObject/floorObject id,
      // else the click is a no-op rather than selecting nothing (docs/
      // plan.md's plan/elevation views only ever call this with an id they
      // just rendered, but a stale id from a race should be inert, not
      // clear the selection out from under the user).
      selectObject(id, opts = {}) {
        // Auto-accept FIRST, before the selection changes: a plain click on a
        // group member commits the pending arrangement and then collapses the
        // selection — intended UX (see the settle table).
        autoAcceptArrangeSession();

        const project = get().project;
        if (!project) return;

        const exists =
          project.wallObjects.some((object) => object.id === id) ||
          project.floorObjects.some((object) => object.id === id);
        if (!exists) return;

        const current = objectIdsOf(get().selection);
        const next = opts.additive
          ? current.includes(id)
            ? current.filter((existingId) => existingId !== id)
            : [...current, id]
          : [id];

        set(selectionWrite(project, { kind: "objects", ids: next }, get().wallContextId));
      },

      // Bulk replace (e.g. a marquee-drag selection from the plan view).
      // Silently drops any id that isn't a live placement, the same
      // tolerance selectObject has for a single stale id.
      setObjectSelection(ids) {
        autoAcceptArrangeSession();

        const project = get().project;
        if (!project) return;

        const next = ids.filter(
          (id) =>
            project.wallObjects.some((object) => object.id === id) ||
            project.floorObjects.some((object) => object.id === id)
        );

        set(selectionWrite(project, { kind: "objects", ids: next }, get().wallContextId));
      },

      clearObjectSelection() {
        autoAcceptArrangeSession();
        // Already-empty selection is a no-op — but wall context (which persists
        // across clears) is left exactly as it was.
        if (get().selection.kind === "none") return;
        set(selectionWrite(get().project, NO_SELECTION, get().wallContextId));
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
        // Wall context falls back to a surviving wall when the deleted room
        // owned it; otherwise it persists untouched.
        const wallContextId = get().wallContextId;
        const nextWallContextId = wallContextId && deletedWallIds.has(wallContextId)
          ? (nextRooms[0]?.room.walls[0]?.id ?? null)
          : wallContextId;

        // Faithful port of the pre-union pruning, no more: the legacy code
        // nulled selectedOpeningId when that opening sat on a deleted wall
        // (under the union: a single-opening objects-selection clears to
        // none), and dropped room focus if this was the focused room. It
        // never touched selectedObjectIds — dangling artwork/multi-select
        // ids stay dangling here too (consumers tolerate them; undo can
        // create them as well). Broader stale-id pruning is a follow-up
        // pending explicit sanction.
        const current = get().selection;
        const isDyingOpeningSelection =
          current.kind === "objects" &&
          current.ids.length === 1 &&
          project.wallObjects.some(
            (wallObject) =>
              wallObject.id === current.ids[0] &&
              wallObject.kind !== "artwork" &&
              deletedWallIds.has(wallObject.wallId)
          );
        const nextSelection: Selection =
          (current.kind === "room" && current.roomId === roomId) || isDyingOpeningSelection
            ? NO_SELECTION
            : current;

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
            ...selectionWrite(project, nextSelection, nextWallContextId),
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
            // Move the sidebar context to the new room's first wall; the
            // current selection (if any) is left as-is.
            ...selectionWrite(
              project,
              get().selection,
              roomPlacement.room.walls[0]?.id ?? null
            ),
            viewMode: "plan"
          }
        );
      },

      async resizeRoomHeight(roomId, heightMm) {
        const project = get().project;
        if (!project) return;
        if (!Number.isFinite(heightMm) || heightMm <= 0) {
          throw new Error("Room height must be greater than zero.");
        }

        const roomPlacement = project.floor.rooms.find(
          (placement) => placement.roomId === roomId
        );
        if (!roomPlacement) return;
        if (
          roomPlacement.room.heightMm === heightMm &&
          roomPlacement.room.walls.every((wall) => wall.heightMm === heightMm)
        ) {
          return;
        }

        const changedWallIds = roomPlacement.room.walls.map((wall) => wall.id);
        const nextProject: Project = {
          ...project,
          floor: {
            rooms: project.floor.rooms.map((placement) =>
              placement.roomId === roomId
                ? {
                    ...placement,
                    room: {
                      ...placement.room,
                      heightMm,
                      walls: placement.room.walls.map((wall) => ({
                        ...wall,
                        heightMm
                      }))
                    }
                  }
                : placement
            )
          }
        };
        const placementWarnings = validateChangedWallPlacements(
          nextProject,
          changedWallIds
        );

        await applyEdit("Resize room height", () => nextProject, {
          placementWarnings
        });
      },

      async resizeWall(wallId, lengthMm, anchor = "start") {
        const project = get().project;
        if (!project) return;

        const result = resizeWallPreservingAngles(project, wallId, lengthMm, anchor);
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
        const wallContextId = get().wallContextId;
        if (!wallContextId) return;

        await get().resizeWall(wallContextId, lengthMm);
      },

      async moveRoom(roomId, offsetXMm, offsetYMm) {
        const project = get().project;
        if (!project) return;

        const placement = project.floor.rooms.find(
          (candidate) => candidate.roomId === roomId
        );
        if (!placement) {
          throw new Error(`Room not found: ${roomId}`);
        }

        // Dropping a room back where it started shouldn't cost an undo entry —
        // same no-op guard the placement moves (moveArtworkPlacement) use.
        if (placement.offsetXMm === offsetXMm && placement.offsetYMm === offsetYMm) {
          return;
        }

        await applyEdit("Move room", (current) => ({
          ...current,
          floor: {
            rooms: current.floor.rooms.map((candidate) =>
              candidate.roomId === roomId
                ? { ...candidate, offsetXMm, offsetYMm }
                : candidate
            )
          }
        }));
      },

      async undo() {
        const entry = get().undoStack.at(-1);
        if (!entry) return;

        set({
          ...(entry.project ? { project: entry.project.before } : {}),
          undoStack: get().undoStack.slice(0, -1),
          redoStack: [...get().redoStack, entry],
          placementWarnings: [],
          lastGeometryEdit: null,
          arrangeSession: null
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
          lastGeometryEdit: null,
          arrangeSession: null
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

        const alreadyPlaced =
          project.wallObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId) ||
          project.floorObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId);
        if (alreadyPlaced) {
          set({ error: ALREADY_PLACED_MESSAGE });
          return;
        }

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
          // Placing selects the new placement (wart-fix umbrella: previously it
          // set only the inspector slot and left any multi-select intact).
          {
            placementWarnings,
            ...selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [placement.id] },
              get().wallContextId
            )
          }
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
            // Selecting a placement is an objects selection now (openings fold
            // into the union) — the freshly-added opening becomes the selection.
            ...selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [placement.id] },
              get().wallContextId
            )
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
            {
              ...selectionWrite(
                { ...project, floorObjects: [...project.floorObjects, floorObject] },
                { kind: "objects", ids: [floorObject.id] },
                get().wallContextId
              )
            }
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
            ...selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [opening.id] },
              get().wallContextId
            )
          }
        );
      },

      async placeArtworkOnFloor(artworkId, xMm, yMm) {
        const project = get().project;
        if (!project) return;

        const artwork = get().libraryArtworks.find((candidate) => candidate.id === artworkId);
        if (!artwork) return;

        const alreadyPlaced =
          project.wallObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId) ||
          project.floorObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId);
        if (alreadyPlaced) {
          set({ error: ALREADY_PLACED_MESSAGE });
          return;
        }

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
          // Placing selects the new floor placement (wart-fix umbrella).
          {
            ...selectionWrite(
              { ...project, floorObjects: [...project.floorObjects, floorObject] },
              { kind: "objects", ids: [floorObject.id] },
              get().wallContextId
            )
          }
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
      },

      // A direct group drag with no active session: one "Move N objects" undo
      // entry via the shared commit path. (When a session is active the drag
      // routes into setArrangeSessionPreview instead — see App.tsx.)
      async moveWallObjectsGroup(moves, allowOverlap = false) {
        const result = commitWallObjectMoves(
          moves,
          (count) => `Move ${count} objects`,
          allowOverlap
        );
        if (result.status === "committed") await persist(result.project);
      },

      async movePlanObjectsGroup(moves, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const wallMoveById = new Map(
          moves
            .filter((move) => project.wallObjects.some((wallObject) => wallObject.id === move.id))
            .map((move) => [move.id, move])
        );
        const floorMoveById = new Map(
          moves
            .filter((move) =>
              project.floorObjects.some((floorObject) => floorObject.id === move.id)
            )
            .map((move) => [move.id, move])
        );
        if (wallMoveById.size === 0 && floorMoveById.size === 0) return;

        const movedWallIds: string[] = [];
        const nextWallObjects = project.wallObjects.map((wallObject) => {
          const move = wallMoveById.get(wallObject.id);
          // Wall-anchored members slide along their wall only — the plan
          // view has no notion of hang height, so yMm (if present on the
          // move) is ignored for these, same as commitPlanMove's same-wall
          // branch.
          if (!move || wallObject.xMm === move.xMm) return wallObject;
          movedWallIds.push(wallObject.id);
          return { ...wallObject, xMm: move.xMm };
        });

        const movedFloorIds: string[] = [];
        const nextFloorObjects = project.floorObjects.map((floorObject) => {
          const move = floorMoveById.get(floorObject.id);
          if (!move) return floorObject;
          const yMm = move.yMm ?? floorObject.yMm;
          if (floorObject.xMm === move.xMm && floorObject.yMm === yMm) return floorObject;
          movedFloorIds.push(floorObject.id);
          return { ...floorObject, xMm: move.xMm, yMm };
        });

        if (movedWallIds.length === 0 && movedFloorIds.length === 0) return;

        // Floor objects get no bounds/collision validation in v1 (see
        // placeArtworkOnFloor) — only the wall-anchored members are checked.
        const placementWarnings = validateWallObjectPlacements(
          { ...project, wallObjects: nextWallObjects },
          movedWallIds
        );

        if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
          set({ error: OVERLAP_BLOCKED_MESSAGE });
          return;
        }

        await applyEdit(
          `Move ${movedWallIds.length + movedFloorIds.length} objects`,
          (current) => ({
            ...current,
            wallObjects: nextWallObjects,
            floorObjects: nextFloorObjects
          }),
          { placementWarnings }
        );
      },

      // Direct, one-shot arrange (still used by tests). The inspector panel now
      // drives arrangement through the ephemeral session actions below
      // (beginArrangeSession/updateArrangeSession/commit...) so panel edits are
      // a live preview that commits as a single undo entry; this action remains
      // the immediate-commit path.
      async arrangeSelectedOnWall(params, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        // Friendly, single message for every way the selection can't be
        // arranged. The inspector's disabled-state copy is richer — App.tsx
        // derives a cause-specific arrangeDisabledReason (floor members / too
        // few works / multiple walls) — but this immediate-commit path keeps
        // one generic line: it only fires when an action races a selection
        // change, not while a user is reading the panel.
        const cannotArrangeMessage =
          "Select at least two works on the same wall to arrange them.";

        const selectedIds = objectIdsOf(get().selection);
        const hasFloorMember = selectedIds.some((id) =>
          project.floorObjects.some((floorObject) => floorObject.id === id)
        );
        if (hasFloorMember) {
          set({ error: cannotArrangeMessage });
          return;
        }

        // Arranging operates on ARTWORKS only — openings (doors/windows/blocked
        // zones) are architecture, not part of the hang. A selected opening is
        // simply not a member: it neither moves on arrange nor counts toward the
        // 2-member minimum.
        const members = project.wallObjects.filter(
          (wallObject) => wallObject.kind === "artwork" && selectedIds.includes(wallObject.id)
        );
        if (members.length < 2) {
          set({ error: cannotArrangeMessage });
          return;
        }

        const wallIds = new Set(members.map((member) => member.wallId));
        if (wallIds.size > 1) {
          set({ error: cannotArrangeMessage });
          return;
        }

        const wall = getProjectWalls(project).find(
          (candidate) => candidate.id === members[0].wallId
        );
        if (!wall) return;

        const insetMm =
          "insetMm" in params
            ? params.insetMm
            : "gapMm" in params
              ? insetForGap(members, wall.lengthMm, params.gapMm)
              : solveEqualArrangement(members, wall.lengthMm).insetMm;

        const moves = arrangeOnWall(members, wall.lengthMm, { insetMm });
        if (moves.length === 0) return;

        const moveById = new Map(moves.map((move) => [move.id, move]));
        const movedIds: string[] = [];
        const nextWallObjects = project.wallObjects.map((wallObject) => {
          const move = moveById.get(wallObject.id);
          if (!move || wallObject.xMm === move.xMm) return wallObject;
          movedIds.push(wallObject.id);
          return { ...wallObject, xMm: move.xMm };
        });
        if (movedIds.length === 0) return;

        const placementWarnings = validateWallObjectPlacements(
          { ...project, wallObjects: nextWallObjects },
          movedIds
        );

        if (!allowOverlap && placementWarnings.some((warning) => warning.type === "collision")) {
          set({ error: OVERLAP_BLOCKED_MESSAGE });
          return;
        }

        await applyEdit(
          "Arrange on wall",
          (current) => ({ ...current, wallObjects: nextWallObjects }),
          { placementWarnings }
        );
      },

      ...arrange.actions,

      async removeSelectedPlacements() {
        const project = get().project;
        const selectedIds = objectIdsOf(get().selection);
        if (!project || selectedIds.length === 0) return;

        const idSet = new Set(selectedIds);
        const removedCount =
          project.wallObjects.filter((wallObject) => idSet.has(wallObject.id)).length +
          project.floorObjects.filter((floorObject) => idSet.has(floorObject.id)).length;
        if (removedCount === 0) return;

        await applyEdit(
          `Remove ${removedCount} objects`,
          (current) => ({
            ...current,
            wallObjects: current.wallObjects.filter((wallObject) => !idSet.has(wallObject.id)),
            floorObjects: current.floorObjects.filter(
              (floorObject) => !idSet.has(floorObject.id)
            )
          }),
          selectionWrite(project, NO_SELECTION, get().wallContextId)
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
