import type { Project } from "../../domain/project";

// What is selected, as one value. Selection is view state (never undoable,
// never persisted — docs/plan.md §7 scopes undo to the document). Invalid
// combinations of the old five slots are unrepresentable here:
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
  | { kind: "room"; roomId: string };

export const NO_SELECTION: Selection = { kind: "none" };

const EMPTY_IDS: string[] = [];

export function objectIdsOf(selection: Selection): string[] {
  return selection.kind === "objects" ? selection.ids : EMPTY_IDS;
}

export function roomIdOf(selection: Selection): string | null {
  return selection.kind === "room" ? selection.roomId : null;
}

function findPlacement(project: Project, id: string) {
  return (
    project.wallObjects.find((wallObject) => wallObject.id === id) ??
    project.floorObjects.find((floorObject) => floorObject.id === id)
  );
}

// The library artwork the inspector should show: an explicit checklist pick,
// or the artwork behind a single selected artwork placement. Multi-select and
// dangling ids resolve to null — there's no single artwork to describe.
export function getSelectedArtworkId(project: Project | null, selection: Selection): string | null {
  if (selection.kind === "libraryArtwork") return selection.artworkId;
  if (!project || selection.kind !== "objects" || selection.ids.length !== 1) return null;
  const placement = findPlacement(project, selection.ids[0]);
  return placement?.kind === "artwork" ? placement.artworkId : null;
}

// The opening/blocked-zone placement the inspector should show — a single
// selected non-artwork placement (doors/windows/blocked zones, wall or floor).
export function getSelectedOpeningId(project: Project | null, selection: Selection): string | null {
  if (!project || selection.kind !== "objects" || selection.ids.length !== 1) return null;
  const placement = findPlacement(project, selection.ids[0]);
  return placement && placement.kind !== "artwork" ? selection.ids[0] : null;
}

// The single place selection state is written. Normalizes an empty objects
// selection to none, then returns the union + wall context as one bundle so an
// edit can't set the selection without its context (and vice versa). The
// project param is retained so this stays the one hook if selection ever needs
// project-aware normalization again — the pure helpers above already take a
// project for exactly that reason.
export function selectionWrite(
  _project: Project | null,
  selection: Selection,
  wallContextId: string | null
): { selection: Selection; wallContextId: string | null } {
  const normalized: Selection =
    selection.kind === "objects" && selection.ids.length === 0 ? NO_SELECTION : selection;
  return { selection: normalized, wallContextId };
}
