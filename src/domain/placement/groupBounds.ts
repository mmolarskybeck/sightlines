import type { WallObjectBase } from "../project";

// Group-selection geometry in wall-local coordinates (center-based xMm/yMm,
// the WallObjectBase convention). Pure helpers shared by the elevation
// view's group drag (the union box becomes the "virtual single object" fed
// to resolveArtworkSnap) and marquee selection.

// Union bounding box of the members, expressed the same way a single wall
// object is (center + size), so it can stand in for one in snapping code.
// A single member degenerates to its own rect. Callers guard against an
// empty member list — an empty selection has no box.
export function getGroupBounds(members: WallObjectBase[]): {
  centerXMm: number;
  centerYMm: number;
  widthMm: number;
  heightMm: number;
} {
  const minXMm = Math.min(...members.map((m) => m.xMm - m.widthMm / 2));
  const maxXMm = Math.max(...members.map((m) => m.xMm + m.widthMm / 2));
  const minYMm = Math.min(...members.map((m) => m.yMm - m.heightMm / 2));
  const maxYMm = Math.max(...members.map((m) => m.yMm + m.heightMm / 2));

  return {
    centerXMm: (minXMm + maxXMm) / 2,
    centerYMm: (minYMm + maxYMm) / 2,
    widthMm: maxXMm - minXMm,
    heightMm: maxYMm - minYMm
  };
}

// Ids of the members whose rects intersect the given rect — inclusive on
// edge-touch (a marquee that just grazes an edge still selects; exclusive
// bounds would make hairline selections feel arbitrary). Preserves the
// members' input order.
export function getIdsIntersectingRect(
  members: WallObjectBase[],
  rect: { minXMm: number; maxXMm: number; minYMm: number; maxYMm: number }
): string[] {
  return members
    .filter(
      (m) =>
        m.xMm - m.widthMm / 2 <= rect.maxXMm &&
        m.xMm + m.widthMm / 2 >= rect.minXMm &&
        m.yMm - m.heightMm / 2 <= rect.maxYMm &&
        m.yMm + m.heightMm / 2 >= rect.minYMm
    )
    .map((m) => m.id);
}
