import type { Project } from "../../domain/project";
import type { AppState, ViewMode } from "../store";

// Selection is transient view state: never persisted or undoable.
//   none           — nothing selected
//   objects        — 1+ placement ids (wallObjects/floorObjects entries);
//                    NEVER library artwork ids. [] is normalized to none.
//   libraryArtwork — a checklist pick that has no placement yet (inspector-only)
//   room           — plan view's room focus (resize/move affordances)
// The sidebar's wall context is NOT part of this union — it persists across
// object selection (see wallContextId at the use site).
export type Selection =
  | { kind: "none" }
  | { kind: "objects"; ids: string[] }
  | { kind: "libraryArtwork"; artworkId: string }
  | { kind: "room"; roomId: string }
  | { kind: "measurement"; measurementId: string }
  // Partitions are selected by centerline id, never face id.
  | { kind: "freestandingWall"; wallId: string };

export const NO_SELECTION: Selection = { kind: "none" };

const EMPTY_IDS: string[] = [];

export function objectIdsOf(selection: Selection): string[] {
  return selection.kind === "objects" ? selection.ids : EMPTY_IDS;
}

export function roomIdOf(selection: Selection): string | null {
  return selection.kind === "room" ? selection.roomId : null;
}

export function freestandingWallIdOf(selection: Selection): string | null {
  return selection.kind === "freestandingWall" ? selection.wallId : null;
}

function findPlacement(project: Project, id: string) {
  return (
    project.wallObjects.find((wallObject) => wallObject.id === id) ??
    project.floorObjects.find((floorObject) => floorObject.id === id)
  );
}

// Resolve the inspector artwork; multi-select and dangling ids return null.
export function getSelectedArtworkId(project: Project | null, selection: Selection): string | null {
  if (selection.kind === "libraryArtwork") return selection.artworkId;
  if (!project || selection.kind !== "objects" || selection.ids.length !== 1) return null;
  const placement = findPlacement(project, selection.ids[0]);
  return placement?.kind === "artwork" ? placement.artworkId : null;
}

// Resolve a single selected opening or blocked zone for the inspector.
export function getSelectedOpeningId(project: Project | null, selection: Selection): string | null {
  if (!project || selection.kind !== "objects" || selection.ids.length !== 1) return null;
  const placement = findPlacement(project, selection.ids[0]);
  return placement && placement.kind !== "artwork" ? selection.ids[0] : null;
}

// Centralizes selection writes and normalizes an empty object selection to none.
export function selectionWrite(
  // Callers pass the post-edit project.
  _project: Project | null,
  selection: Selection,
  wallContextId: string | null
): { selection: Selection; wallContextId: string | null } {
  const normalized: Selection =
    selection.kind === "objects" && selection.ids.length === 0 ? NO_SELECTION : selection;
  return { selection: normalized, wallContextId };
}

export type SelectionSliceActions = {
  setViewMode: (viewMode: ViewMode) => void;
  selectWall: (wallId: string) => void;
  selectArtwork: (artworkId: string) => void;
  selectOpening: (wallObjectId: string) => void;
  selectRoom: (roomId: string) => void;
  selectFreestandingWall: (wallId: string) => void;
  selectMeasurement: (measurementId: string) => void;
  viewFreestandingFace: (faceWallId: string) => void;
  selectObject: (id: string, opts?: { additive?: boolean }) => void;
  setObjectSelection: (ids: string[]) => void;
  clearObjectSelection: () => void;
};

export type SelectionSliceInternals = {
  autoAcceptArrangeSession: () => void;
};

export function createSelectionSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: SelectionSliceInternals
): { actions: SelectionSliceActions } {
  const { autoAcceptArrangeSession } = internals;

  const actions: SelectionSliceActions = {
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
      // Prefer the first wall placement, then floor placement; unplaced picks stay library-only.
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
      // Dead opening ids are inert rather than clearing selection.
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

    // Selecting a partition (by its CENTERLINE id) drives the partition
    // inspector's move/rotate/resize. Wall context persists so the Side A/B
    // buttons (viewFreestandingFace) can hand a face to the elevation.
    selectFreestandingWall(wallId) {
      autoAcceptArrangeSession();
      const project = get().project;
      if (!project) return;
      const exists = project.floor.rooms.some((placement) =>
        placement.room.freestandingWalls.some((wall) => wall.id === wallId)
      );
      if (!exists) return;
      set(
        selectionWrite(project, { kind: "freestandingWall", wallId }, get().wallContextId)
      );
    },

    selectMeasurement(measurementId) {
      autoAcceptArrangeSession();
      const project = get().project;
      if (!project?.referenceMeasurements?.some((item) => item.id === measurementId)) return;
      set(
        selectionWrite(
          project,
          { kind: "measurement", measurementId },
          get().wallContextId
        )
      );
    },

    // "View side A / side B": point the sidebar/elevation at a partition face
    // (spec §6.5). Keeps the partition selected so its inspector stays up, and
    // jumps to elevation so the chosen face is what's shown.
    viewFreestandingFace(faceWallId) {
      autoAcceptArrangeSession();
      const project = get().project;
      if (!project) return;
      set({
        ...selectionWrite(project, get().selection, faceWallId),
        viewMode: "elevation"
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
    }
  };

  return { actions };
}
