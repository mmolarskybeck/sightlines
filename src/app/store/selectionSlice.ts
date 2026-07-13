import type { Project } from "../../domain/project";

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
