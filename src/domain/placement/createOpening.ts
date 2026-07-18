import type { OpeningWallObject, WallObjectBase, WallTextWallObject } from "../project";
import { newId } from "../id";

export type OpeningKind = OpeningWallObject["kind"];

// Everything the Insert cluster can arm: openings plus wall text. Artworks are
// placed from the checklist, not the Insert cluster, so they are excluded. The
// armed-tool plumbing (PlanMode, toolbar shortcuts, ghost previews) is keyed on
// this widened kind; only the object-CREATION step branches wall-text away from
// the opening builders (openings pair/mirror and block placement; wall text
// does neither).
export type InsertToolKind = OpeningKind | WallTextWallObject["kind"];

// Curatorial defaults, not architectural code minimums — close enough for a
// first placement that a curator will immediately adjust numerically anyway
// (docs/plan.md §2: tactile and numeric paths always agree).
export const DOOR_WIDTH_MM = 915; // ~36in, a standard single door leaf + frame.
export const DOOR_HEIGHT_MM = 2030; // ~80in, standard door height.
export const WINDOW_WIDTH_MM = 1200;
export const WINDOW_HEIGHT_MM = 1200;
export const BLOCKED_ZONE_WIDTH_MM = 1000;
export const BLOCKED_ZONE_HEIGHT_MM = 1000;

// Title-case label for UI surfaces (inspector headings, placement-warning
// subjects) — never a raw `kind` string, per the same rule that resolves
// warnings to an artwork's title instead of its wallObjectId.
export function getOpeningKindLabel(kind: OpeningKind): string {
  switch (kind) {
    case "door":
      return "Door";
    case "window":
      return "Window";
    case "blocked-zone":
      return "Blocked zone";
  }
}

export function getDefaultOpeningSizeMm(kind: OpeningKind): {
  widthMm: number;
  heightMm: number;
} {
  switch (kind) {
    case "door":
      return { widthMm: DOOR_WIDTH_MM, heightMm: DOOR_HEIGHT_MM };
    case "window":
      return { widthMm: WINDOW_WIDTH_MM, heightMm: WINDOW_HEIGHT_MM };
    case "blocked-zone":
      return { widthMm: BLOCKED_ZONE_WIDTH_MM, heightMm: BLOCKED_ZONE_HEIGHT_MM };
  }
}

// Center-anchored y (docs/plan.md §2): a door's default reaches the floor
// (its bottom edge at y=0, so its center sits at half its own height), while
// a window or blocked zone centers on the wall's centerline like an artwork
// placement would.
export function getDefaultOpeningCenterYMm(
  kind: OpeningKind,
  heightMm: number,
  centerlineYMm: number
): number {
  return kind === "door" ? heightMm / 2 : centerlineYMm;
}

// No clamping to wall bounds here, mirroring createArtworkPlacement — an
// out-of-bounds default (e.g. a door added to a wall shorter than the
// default door width) is a state validatePlacement flags, not one this
// constructor silently fixes.
export function createOpeningPlacement(
  kind: OpeningKind,
  wallId: string,
  xMm: number,
  centerlineYMm: number
): OpeningWallObject {
  const { widthMm, heightMm } = getDefaultOpeningSizeMm(kind);

  // The object is structurally valid for either union member (connectsToObjectId
  // is optional and absent at creation); the runtime `kind` variable is what the
  // discriminated union can't statically narrow, so cast once here.
  return {
    id: newId(),
    kind,
    blocksPlacement: true,
    wallId,
    xMm,
    yMm: getDefaultOpeningCenterYMm(kind, heightMm, centerlineYMm),
    widthMm,
    heightMm
  } as OpeningWallObject;
}

// Finds an x-center for a new opening that does not overlap any existing
// opening on the same wall — the guard that keeps the creation paths (addOpening,
// placeOpeningFromPlan) from committing an opening×opening overlap, which the
// new overlap policy forbids outright (overlapPolicy.ts) and so could never be
// fixed after the fact by toggling "Allow overlap".
//
// Only openings whose vertical extent strictly overlaps the new opening's can
// possibly collide (a floor-standing door and a high window at the same x sit
// clear of each other), so we filter to those first, then search 1-D along x.
// "Strict" overlap matches doWallObjectsOverlap: edge-touching is legal, so a
// flush-against-neighbor position counts as free.
//
// If `preferredXMm` is already free we return it unchanged — even out of wall
// bounds, mirroring createOpeningPlacement, which deliberately doesn't clamp an
// out-of-bounds default (that's validatePlacement's job to flag, not this
// constructor's to silently move). Only when the preferred spot is occupied do
// we search, and that search is confined to the in-bounds range [width/2,
// wallLength − width/2] (the same clamp convention as planSnapTargets). Returns
// the free center nearest `preferredXMm`, or null when nothing fits.
export function findFreeOpeningCenterXMm(args: {
  preferredXMm: number;
  sizeMm: { widthMm: number; heightMm: number };
  centerYMm: number;
  wallLengthMm: number;
  sameWallOpenings: WallObjectBase[];
}): number | null {
  const { preferredXMm, sizeMm, centerYMm, wallLengthMm, sameWallOpenings } = args;
  const halfWidth = sizeMm.widthMm / 2;
  const halfHeight = sizeMm.heightMm / 2;

  // Only y-overlapping neighbors can collide in x. Strict (<) so a neighbor
  // whose edge merely touches the new opening's y-extent is treated as clear.
  const blockers = sameWallOpenings.filter(
    (opening) => Math.abs(opening.yMm - centerYMm) < halfHeight + opening.heightMm / 2
  );

  // A center x collides with a blocker when their x-intervals strictly overlap,
  // i.e. the gap between centers is less than the sum of half-widths.
  const collidesAt = (x: number): boolean =>
    blockers.some(
      (blocker) => Math.abs(x - blocker.xMm) < halfWidth + blocker.widthMm / 2
    );

  if (!collidesAt(preferredXMm)) return preferredXMm;

  // The in-bounds search range: keep the object's full width on the wall. If
  // the wall is shorter than the object, there's no valid slot at all.
  const minXMm = halfWidth;
  const maxXMm = wallLengthMm - halfWidth;
  if (maxXMm < minXMm) return null;

  // Free slots begin/end flush against a blocker's edge (edge-touch is legal),
  // so the optimal free center nearest `preferredXMm` sits at one of these
  // flush edges or at a wall bound. Gather those candidates, keep the ones that
  // are in-bounds and collision-free, and pick the nearest to `preferredXMm`.
  const candidates = [minXMm, maxXMm];
  for (const blocker of blockers) {
    const edge = halfWidth + blocker.widthMm / 2;
    candidates.push(blocker.xMm - edge, blocker.xMm + edge);
  }

  const free = candidates
    .filter((x) => x >= minXMm && x <= maxXMm && !collidesAt(x))
    .sort((a, b) => Math.abs(a - preferredXMm) - Math.abs(b - preferredXMm));

  return free[0] ?? null;
}
