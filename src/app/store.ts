import { create } from "zustand";
import { z } from "zod";
import { createBrowserImageProcessor } from "../domain/assets/browserImageProcessor";
import { titleFromFilename, validateImageFile, type ImageProcessor } from "../domain/assets/imageIntake";
import { createNextRectangleRoom } from "../domain/geometry/createRoom";
import { resizeWallPreservingAngles, type ResizeAnchor } from "../domain/geometry/editRoom";
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
import {
  arrangeOnWall,
  arrangeOnWallInZone,
  getOpenSpaceBounds,
  insetForGap,
  slideGroupToEdgeInset,
  solveEqualArrangement,
  spaceGroupAboutCenter
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

export type ViewMode = "plan" | "elevation" | "data" | "3d";

// A transient, NON-undoable arrange interaction (precedent: selectedObjectIds
// is view state, not on the undo stack). While a session is live, panel edits,
// group drags and arrow nudges write to previewById only — the committed
// project is untouched until the session settles. Accepting flushes previewById
// into ONE "Arrange on wall" undo entry; cancelling just drops the slice.
// originalById is the committed layout at begin, used for cancel/no-op
// detection. Exported so the elevation view / inspector (later work packages)
// can read previewById to render the live preview.
export type ArrangeSession = {
  wallId: string;
  memberIds: string[];
  originalById: Record<string, { xMm: number; yMm: number }>;
  previewById: Record<string, { xMm: number; yMm: number }>;
  mode: "equal" | "inset" | "gap";
  // Which wall edge the "From wall edges" (inset) mode measures from. "both"
  // keeps the group centred (the original symmetric solve); "left"/"right"
  // slide the group as a rigid unit so the named outer edge sits a given
  // distance from that wall edge, preserving interior spacing. Only meaningful
  // while mode === "inset", but carried on the session so switching mode and
  // back remembers it. See lastInsetAnchor for the idle default.
  insetAnchor: "left" | "both" | "right";
  // Which span the "Space evenly" mode distributes across: the whole wall, or
  // just the "open space" beside the group (bounded by the nearest unselected
  // neighbours — see openZoneBoundsMm). Only meaningful while mode === "equal",
  // but carried on the session so switching mode and back remembers it. See
  // lastEvenZone for the idle default.
  evenZone: "wall" | "open";
  // The open-space span, computed ONCE at session begin from the members'
  // ORIGINAL positions and the unselected wall objects on this wall, so the
  // zone stays fixed while previews move the members around inside it. Ignored
  // when evenZone === "wall".
  openZoneBoundsMm: { startMm: number; endMm: number };
};

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
  // Multi-select for group operations (move/arrange/delete). These are
  // PLACEMENT ids — wallObjects/floorObjects entries — never artwork library
  // ids, and never anything else on the undo stack (docs/plan.md §7 scopes
  // undo to the document; what's currently selected is view state, same as
  // selectedWallId). See legacySelectionSlots for how this array keeps the
  // pre-existing single-select inspectors (selectedArtworkId/selectedOpeningId)
  // in sync.
  selectedObjectIds: string[];
  // Which room shows its selection-scoped resize/move affordances in plan
  // view — view state, not undoable, not persisted, same as selectedWallId.
  // Mutually exclusive with every other selection slot: selecting a room
  // clears them all (selectRoom), and selecting any of them clears the room
  // (see selectWall/selectArtwork/selectOpening/selectObject/
  // setObjectSelection) — unlike selectedWallId, which persists as sidebar
  // context across artwork/opening selection.
  selectedRoomId: string | null;
  // Transient arrange interaction, null unless a session is in flight. Settles
  // (accept/cancel) on any selection/view change, undo/redo, or foreign edit —
  // see the settle table around settleArrangeSession.
  arrangeSession: ArrangeSession | null;
  // The spacing mode the arrange panel should default to when there's no live
  // session and the layout doesn't already read as evenly spaced — plain view
  // state (not undoable, not persisted), remembered across selections so the
  // panel opens in the mode the curator last worked in. Updated whenever a
  // session begins or changes mode.
  lastArrangeMode: "equal" | "inset" | "gap";
  // The wall edge the "From wall edges" mode should measure from when there's
  // no live session — plain view state (not undoable, not persisted), mirroring
  // lastArrangeMode. Updated whenever a session's anchor is set or changed.
  lastInsetAnchor: "left" | "both" | "right";
  // The "Space within" zone the "Space evenly" mode should default to. null
  // until the curator first picks one — the smart default (open when the group
  // is boxed in by neighbours, else whole wall) applies while it's null. Plain
  // view state (not undoable, not persisted), mirroring lastInsetAnchor.
  lastEvenZone: "wall" | "open" | null;
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
  // Ephemeral arrange session (live preview → single commit). See ArrangeSession.
  beginArrangeSession: (mode: ArrangeSession["mode"]) => void;
  // Sets which wall edge the inset mode measures from, WITHOUT moving anything
  // (mirrors how switching mode never jumps the works). Updates the live
  // session's anchor when one is open, and always the remembered default.
  setArrangeAnchor: (anchor: ArrangeSession["insetAnchor"]) => void;
  // Sets which span the "Space evenly" mode distributes across (whole wall vs.
  // the open space beside the group). Unlike the anchor row, choosing a zone is
  // an ACTION: it re-applies the equal solve live when a session is open in
  // equal mode, and begins one (in equal mode) when none is open — clicking a
  // zone spaces evenly the same way clicking "Space evenly" does. Always
  // remembers the choice in lastEvenZone.
  setArrangeEvenZone: (zone: ArrangeSession["evenZone"]) => void;
  updateArrangeSession: (
    params:
      | { insetMm: number; anchor?: ArrangeSession["insetAnchor"] }
      | { gapMm: number }
      | { equal: true }
  ) => void;
  setArrangeSessionPreview: (moves: { id: string; xMm: number; yMm: number }[]) => void;
  commitArrangeSession: (allowOverlap?: boolean) => void;
  cancelArrangeSession: () => void;
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

    type EditExtras = Partial<
      Pick<
        AppState,
        | "placementWarnings"
        | "lastGeometryEdit"
        | "selectedWallId"
        | "selectedArtworkId"
        | "selectedOpeningId"
        | "selectedObjectIds"
        | "selectedRoomId"
        | "arrangeSession"
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
        selectedWallId: getFirstWall(project)?.id ?? null,
        selectedArtworkId: null,
        selectedOpeningId: null,
        selectedObjectIds: [],
        selectedRoomId: null,
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

    // Internal, SYNCHRONOUS settle for a pending arrange session — the single
    // place accept/cancel semantics live (see the table in
    // docs/plan wild-floating-babbage.md).
    //
    // LOAD-BEARING ordering: the accept path completes all of its state changes
    // synchronously (pushEditEntry's `set()` runs before any await; persist is
    // fired as `void persist(...)`, not awaited). Callers such as selectObject
    // rely on this: they call the auto-accept as their first line and then
    // proceed to change selection in the same synchronous tick, trusting the
    // arrangement is already committed by the time they run.
    //
    // Returns "committed" (one undo entry pushed), "cleared" (session dropped
    // with no edit — cancel or a no-op accept), or "blocked" (collision gate
    // rejected the commit; session left intact with the error surfaced).
    function settleArrangeSession(
      outcome: "accept" | "cancel",
      allowOverlap = false
    ): "committed" | "cleared" | "blocked" {
      const session = get().arrangeSession;
      if (!session) return "cleared";

      if (outcome === "cancel") {
        set({ arrangeSession: null });
        return "cleared";
      }

      // No-op guard: if every preview position is within 0.01mm of where it
      // started, there's nothing to commit — drop the session without an
      // undo entry.
      const isNoOp = session.memberIds.every((id) => {
        const original = session.originalById[id];
        const preview = session.previewById[id];
        if (!original || !preview) return true;
        return (
          Math.abs(original.xMm - preview.xMm) < 0.01 &&
          Math.abs(original.yMm - preview.yMm) < 0.01
        );
      });
      if (isNoOp) {
        set({ arrangeSession: null });
        return "cleared";
      }

      const moves = session.memberIds
        .filter((id) => session.previewById[id])
        .map((id) => ({
          id,
          xMm: session.previewById[id].xMm,
          yMm: session.previewById[id].yMm
        }));

      const result = commitWallObjectMoves(moves, "Arrange on wall", allowOverlap, {
        arrangeSession: null
      });

      if (result.status === "committed") {
        // Fire-and-forget so the state change above is fully synchronous.
        void persist(result.project);
        return "committed";
      }
      if (result.status === "blocked") {
        // Session left intact (commit didn't clear it); error already surfaced.
        return "blocked";
      }
      // Commit found nothing to move (preview matched committed positions) —
      // clear the session without an undo entry.
      set({ arrangeSession: null });
      return "cleared";
    }

    // Auto-accept used by selection/view changes: a pending arrangement can't
    // outlive the selection it belongs to, so a collision-blocked commit here
    // is cancelled (keeping the surfaced error) rather than left open the way an
    // explicit commitArrangeSession would.
    function autoAcceptArrangeSession() {
      if (!get().arrangeSession) return;
      if (settleArrangeSession("accept") === "blocked") {
        set({ arrangeSession: null });
      }
    }

    return {
      project: null,
      selectedWallId: null,
      selectedArtworkId: null,
      selectedOpeningId: null,
      selectedObjectIds: [],
      selectedRoomId: null,
      arrangeSession: null,
      lastArrangeMode: "inset",
      lastInsetAnchor: "both",
      lastEvenZone: null,
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
        // Wall focus replaces artwork/opening focus in the inspector — the
        // three selections are mutually exclusive, not independent. It also
        // drops any multi-select — a wall click is a fresh focus gesture, not
        // an addition to a group of placements. Also drops room focus (a
        // selected room's handles are a different, exclusive canvas mode).
        set({
          selectedWallId: wallId,
          selectedArtworkId: null,
          selectedOpeningId: null,
          selectedObjectIds: [],
          selectedRoomId: null
        });
      },

      selectArtwork(artworkId) {
        autoAcceptArrangeSession();
        set({
          selectedArtworkId: artworkId,
          selectedOpeningId: null,
          selectedObjectIds: [],
          selectedRoomId: null
        });
      },

      selectOpening(wallObjectId) {
        autoAcceptArrangeSession();
        set({
          selectedOpeningId: wallObjectId,
          selectedArtworkId: null,
          selectedObjectIds: [],
          selectedRoomId: null
        });
      },

      // Room focus for plan view's selection-scoped handles/wash — mutually
      // exclusive with every other selection slot (see selectedRoomId), so
      // this is the one action, besides clearObjectSelection, that also
      // drops the wall focus other selects leave untouched.
      selectRoom(roomId) {
        autoAcceptArrangeSession();
        set({
          selectedRoomId: roomId,
          selectedWallId: null,
          selectedArtworkId: null,
          selectedOpeningId: null,
          selectedObjectIds: []
        });
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

        const current = get().selectedObjectIds;
        const next = opts.additive
          ? current.includes(id)
            ? current.filter((existingId) => existingId !== id)
            : [...current, id]
          : [id];

        set({
          selectedObjectIds: next,
          selectedRoomId: null,
          ...legacySelectionSlots(project, next)
        });
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

        set({
          selectedObjectIds: next,
          selectedRoomId: null,
          ...legacySelectionSlots(project, next)
        });
      },

      clearObjectSelection() {
        autoAcceptArrangeSession();
        const state = get();
        if (
          state.selectedObjectIds.length === 0 &&
          state.selectedArtworkId === null &&
          state.selectedOpeningId === null &&
          state.selectedRoomId === null
        ) {
          return;
        }
        set({
          selectedObjectIds: [],
          selectedArtworkId: null,
          selectedOpeningId: null,
          selectedRoomId: null
        });
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
        const nextSelectedRoomId =
          get().selectedRoomId === roomId ? null : get().selectedRoomId;

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
            selectedRoomId: nextSelectedRoomId,
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
        const selectedWallId = get().selectedWallId;
        if (!selectedWallId) return;

        await get().resizeWall(selectedWallId, lengthMm);
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

        const selectedIds = get().selectedObjectIds;
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

      beginArrangeSession(mode) {
        const project = get().project;
        if (!project) return;

        // Guards identical to arrangeSelectedOnWall (2+ wall members, no floor
        // members, all on one wall) — but a silent no-op on failure, since the
        // panel only offers a begin when the selection already qualifies.
        const selectedIds = get().selectedObjectIds;
        const hasFloorMember = selectedIds.some((id) =>
          project.floorObjects.some((floorObject) => floorObject.id === id)
        );
        if (hasFloorMember) return;

        // Members are ARTWORKS only — a selected opening is architecture, never
        // arranged (see arrangeSelectedOnWall). It doesn't move on arrange and
        // doesn't count toward the 2-member minimum, but it also doesn't block
        // eligibility.
        const members = project.wallObjects.filter(
          (wallObject) => wallObject.kind === "artwork" && selectedIds.includes(wallObject.id)
        );
        if (members.length < 2) return;

        const wallIds = new Set(members.map((member) => member.wallId));
        if (wallIds.size > 1) return;

        const memberIds = members.map((member) => member.id);

        // Idempotent: re-begin on the same member set just switches mode, so
        // previewById built up so far survives (a mode switch never re-seeds
        // from committed positions mid-session).
        const existing = get().arrangeSession;
        if (existing && sameIdSet(existing.memberIds, memberIds)) {
          // Preserves the existing session's zone fields (evenZone/
          // openZoneBoundsMm) via the spread — a mode switch never re-computes
          // the zone mid-session.
          set({ arrangeSession: { ...existing, mode }, lastArrangeMode: mode });
          return;
        }

        const wall = getProjectWalls(project).find(
          (candidate) => candidate.id === members[0].wallId
        );
        if (!wall) return;

        // The open-space span, fixed for the life of the session: bounded by the
        // nearest UNSELECTED wall objects beside the group, from the members'
        // committed positions (the same "others" filter the dimension lines use
        // — every same-wall object that isn't part of this selection).
        const others = project.wallObjects.filter(
          (wallObject) =>
            wallObject.wallId === wall.id && !selectedIds.includes(wallObject.id)
        );
        const openZoneBoundsMm = getOpenSpaceBounds(members, others, wall.lengthMm);
        // Smart default: honour a remembered choice, else open the zone when the
        // group is boxed in by neighbours (span narrower than the whole wall),
        // otherwise the whole wall.
        const isBounded =
          openZoneBoundsMm.startMm > 0 || openZoneBoundsMm.endMm < wall.lengthMm;
        const evenZone = get().lastEvenZone ?? (isBounded ? "open" : "wall");

        const originalById: Record<string, { xMm: number; yMm: number }> = {};
        const previewById: Record<string, { xMm: number; yMm: number }> = {};
        for (const member of members) {
          originalById[member.id] = { xMm: member.xMm, yMm: member.yMm };
          previewById[member.id] = { xMm: member.xMm, yMm: member.yMm };
        }

        set({
          arrangeSession: {
            wallId: members[0].wallId,
            memberIds,
            originalById,
            previewById,
            mode,
            // A fresh session opens on the remembered anchor; switching mode
            // and back keeps whatever the session already carried.
            insetAnchor: get().lastInsetAnchor,
            evenZone,
            openZoneBoundsMm
          },
          lastArrangeMode: mode
        });
      },

      setArrangeAnchor(anchor) {
        // Pure preference change — never moves a work. The inset field only
        // re-slides the group once its VALUE is edited (updateArrangeSession),
        // exactly as a mode switch waits for a value before moving anything.
        const session = get().arrangeSession;
        if (session) {
          set({
            arrangeSession: { ...session, insetAnchor: anchor },
            lastInsetAnchor: anchor
          });
        } else {
          set({ lastInsetAnchor: anchor });
        }
      },

      setArrangeEvenZone(zone) {
        // The picked zone is always remembered, even when the selection can't
        // be arranged (mirrors setArrangeAnchor remembering lastInsetAnchor).
        set({ lastEvenZone: zone });

        const session = get().arrangeSession;
        if (session) {
          set({ arrangeSession: { ...session, evenZone: zone } });
          // In equal mode, switching the zone re-spaces the works live (x only,
          // y untouched) — updateArrangeSession reads the freshly-set zone.
          if (session.mode === "equal") {
            get().updateArrangeSession({ equal: true });
          }
          return;
        }

        // No session: clicking a zone acts like clicking "Space evenly" — begin
        // an equal session (smart default now reads the zone just remembered, so
        // the session opens on it) and apply the solve. If the selection is
        // ineligible, beginArrangeSession is a no-op and only lastEvenZone
        // stuck; nothing else happens.
        get().beginArrangeSession("equal");
        if (!get().arrangeSession) return;
        get().updateArrangeSession({ equal: true });
      },

      updateArrangeSession(params) {
        const session = get().arrangeSession;
        const project = get().project;
        if (!session || !project) return;

        const wall = getProjectWalls(project).find(
          (candidate) => candidate.id === session.wallId
        );
        if (!wall) return;

        // Run the arrange math against PREVIEW positions (committed objects
        // overridden with previewById), so successive edits compose. No
        // collision gate during preview — overlaps surface only at commit.
        const previewMembers = project.wallObjects
          .filter((wallObject) => session.memberIds.includes(wallObject.id))
          .map((wallObject) => {
            const preview = session.previewById[wallObject.id];
            return preview ? { ...wallObject, xMm: preview.xMm, yMm: preview.yMm } : wallObject;
          });

        // An inset edit resolves against the anchor the field was measured
        // from — "both" re-solves the symmetric centred arrangement, while
        // "left"/"right" slide the group rigidly so the named outer edge lands
        // at the typed distance, interior spacing untouched. The anchor rides
        // in with the value (the field knows which edge it's showing) and
        // falls back to whatever the session already carried.
        const insetAnchor: ArrangeSession["insetAnchor"] =
          "insetMm" in params ? (params.anchor ?? session.insetAnchor) : session.insetAnchor;

        let moves: { id: string; xMm: number }[];
        if ("insetMm" in params) {
          moves =
            insetAnchor === "both"
              ? arrangeOnWall(previewMembers, wall.lengthMm, { insetMm: params.insetMm })
              : slideGroupToEdgeInset(
                  previewMembers,
                  wall.lengthMm,
                  insetAnchor,
                  params.insetMm
                );
        } else if ("gapMm" in params) {
          // "Between works" keeps the group's current center fixed and only
          // changes the interior spacing — it must NOT re-center the subset on
          // the wall (that would teleport an off-center pair toward the middle).
          moves = spaceGroupAboutCenter(previewMembers, params.gapMm);
        } else {
          // "Space evenly" distributes within the chosen zone: the whole wall,
          // or the fixed open-space span beside the group. A whole-wall zone of
          // [0, wallLengthMm] is exactly the original centred solve.
          const bounds =
            session.evenZone === "open"
              ? session.openZoneBoundsMm
              : { startMm: 0, endMm: wall.lengthMm };
          moves = arrangeOnWallInZone(previewMembers, bounds.startMm, bounds.endMm);
        }
        if (moves.length === 0) return;

        // x only — arranging is a horizontal move; y stays as previewed.
        const previewById = { ...session.previewById };
        for (const move of moves) {
          const current = previewById[move.id];
          previewById[move.id] = { xMm: move.xMm, yMm: current ? current.yMm : 0 };
        }

        const mode: ArrangeSession["mode"] =
          "insetMm" in params ? "inset" : "gapMm" in params ? "gap" : "equal";

        set({
          arrangeSession: { ...session, previewById, mode, insetAnchor },
          lastArrangeMode: mode,
          lastInsetAnchor: insetAnchor
        });
      },

      setArrangeSessionPreview(moves) {
        const session = get().arrangeSession;
        if (!session) return;

        const memberSet = new Set(session.memberIds);
        const previewById = { ...session.previewById };
        for (const move of moves) {
          if (!memberSet.has(move.id)) continue;
          previewById[move.id] = { xMm: move.xMm, yMm: move.yMm };
        }

        set({ arrangeSession: { ...session, previewById } });
      },

      commitArrangeSession(allowOverlap = false) {
        // A collision block keeps the session open (error surfaced) so the
        // curator can adjust — settleArrangeSession returns "blocked" and does
        // not clear the slice.
        settleArrangeSession("accept", allowOverlap);
      },

      cancelArrangeSession() {
        settleArrangeSession("cancel");
      },

      async removeSelectedPlacements() {
        const project = get().project;
        const selectedIds = get().selectedObjectIds;
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
          { selectedObjectIds: [], selectedArtworkId: null, selectedOpeningId: null }
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

// Order-insensitive equality of two id lists — used to detect that a
// beginArrangeSession call names the same members as the live session (a
// mode switch), so the running preview isn't discarded.
function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

// The only place placement ids (selectedObjectIds) and library ids
// (selectedArtworkId) meet. With exactly one placement selected, resolve it
// against the live project and mirror it into the legacy single-select
// slots the existing artwork/opening inspectors read — selectedArtworkId
// holds a *library* artworkId (App.tsx's inspector resolves it further),
// while selectedObjectIds holds *placement* ids throughout. Any other count
// (0, or 2+ for a group) clears both — there's no single object left for
// them to describe.
function legacySelectionSlots(
  project: Project,
  ids: string[]
): { selectedArtworkId: string | null; selectedOpeningId: string | null } {
  if (ids.length !== 1) {
    return { selectedArtworkId: null, selectedOpeningId: null };
  }

  const [id] = ids;
  const placement =
    project.wallObjects.find((wallObject) => wallObject.id === id) ??
    project.floorObjects.find((floorObject) => floorObject.id === id);
  if (!placement) {
    return { selectedArtworkId: null, selectedOpeningId: null };
  }

  return placement.kind === "artwork"
    ? { selectedArtworkId: placement.artworkId, selectedOpeningId: null }
    : { selectedArtworkId: null, selectedOpeningId: id };
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
