// Checklist ordering, shared between the workspace panel and the spreadsheet
// export. `compareChecklistText` is the panel's own comparator moved down here
// verbatim (ChecklistPanel imports it) so the two surfaces can never disagree
// about how a blank artist sorts.
import type { ChecklistExportRow, ChecklistExportSort } from "./types";

// Locale-aware, case/accent-insensitive text order with blanks LAST. Blank
// handling is the load-bearing half: `localeCompare` would sort "" first, which
// buries every un-attributed work at the top of an artist-sorted checklist.
export function compareChecklistText(
  a: string | undefined,
  b: string | undefined
): number {
  const aText = a?.trim();
  const bText = b?.trim();
  if (aText && bText) return aText.localeCompare(bText, undefined, { sensitivity: "base" });
  if (aText) return -1;
  if (bText) return 1;
  return 0;
}

// Placement rank: walls, then floor, then unplaced. Unplaced works always land
// last in a walk-the-show order — you cannot install what has no wall.
function placementRank(row: ChecklistExportRow): number {
  if (!row.placement) return 2;
  return row.placement.kind === "wall" ? 0 : 1;
}

// "Walk the show" order: rooms in floor order → walls in room order →
// left-to-right along each wall → floor objects grouped by room → unplaced.
function compareByPlacement(a: ChecklistExportRow, b: ChecklistExportRow): number {
  const rankDelta = placementRank(a) - placementRank(b);
  if (rankDelta !== 0) return rankDelta;

  const left = a.placement;
  const right = b.placement;
  if (!left || !right) return 0;

  if (left.roomIndex !== right.roomIndex) return left.roomIndex - right.roomIndex;
  // Floor objects share a room but have no wall and no meaningful traversal
  // order within it, so they fall through to project order below.
  if (left.kind === "wall" && right.kind === "wall") {
    if (left.wallIndex !== right.wallIndex) return left.wallIndex - right.wallIndex;
    if (left.alongMm !== right.alongMm) return left.alongMm - right.alongMm;
  }
  return 0;
}

// Every sort ends in project order, so the result is a total order — two works
// with the same title (or no title at all) keep the checklist's own sequence
// rather than whatever the engine's sort happened to do with them.
export function sortChecklistExportRows(
  rows: readonly ChecklistExportRow[],
  sort: ChecklistExportSort
): ChecklistExportRow[] {
  const byProjectOrder = (a: ChecklistExportRow, b: ChecklistExportRow) =>
    a.projectIndex - b.projectIndex;

  return [...rows].sort((a, b) => {
    switch (sort) {
      case "artist":
        return (
          compareChecklistText(a.artwork?.artist, b.artwork?.artist) ||
          compareChecklistText(a.artwork?.title, b.artwork?.title) ||
          byProjectOrder(a, b)
        );
      case "title":
        return compareChecklistText(a.artwork?.title, b.artwork?.title) || byProjectOrder(a, b);
      case "accession":
        return (
          compareChecklistText(a.artwork?.accessionNumber, b.artwork?.accessionNumber) ||
          byProjectOrder(a, b)
        );
      case "placement":
        return compareByPlacement(a, b) || byProjectOrder(a, b);
      case "project":
      default:
        return byProjectOrder(a, b);
    }
  });
}
