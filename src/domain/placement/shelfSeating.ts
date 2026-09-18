import type { WallObject } from "../project";
import { shelfTopYMm } from "../geometry/shelfGlyphs";
import { getShelfSnapCandidates } from "./shelfRiders";

// Standing a work ON a shelf, for the surfaces that are not the elevation.
//
// The elevation already seats a work through the snap pipeline: the shelf-top
// target in artworkSnapTargets.ts offers a y and resolveSnap picks it. Plan and
// 3D have no such pipeline for the vertical axis — plan has no y at all, and
// the 3D drop/drag deliberately does not snap — so the "is this work standing
// on that slab" arithmetic lives here, once, and both of them call it.
//
// It is the SAME relationship shelfRiders.ts defines (same wall, x-spans
// overlapping, bottom edge on the top face), approached from the other side:
// riders.ts asks "what is already on this shelf", this asks "what y would put
// this work on one". Candidate selection therefore goes through
// getShelfSnapCandidates so the overlap predicate can never drift.
//
// Pure: wall objects in, a y and a shelf id out. No store, no project.

// How near a dragged work's bottom edge has to come to a shelf's top face for
// a 3D gesture to seat it. FAR wider than SHELF_TOP_SNAP_TOLERANCE_MM (2mm,
// the tolerance that decides what a shelf CARRIES) because this is a capture
// radius, not a membership test: 3D is the rough-placement surface, the pointer
// resolves to a world hit with no snapping behind it, and a curator dropping a
// work "onto that shelf" is aiming at the slab, not at a millimetre.
export const SHELF_SEAT_CAPTURE_3D_MM = 200;

// The moving work as the seating arithmetic needs to see it: its wall, its
// x-span (for the overlap test), and its height (the bottom edge is
// yMm - heightMm/2, and the seated centre is the top face plus heightMm/2).
export type SeatingMover = {
  id?: string;
  wallId: string;
  xMm: number;
  widthMm: number;
  heightMm: number;
};

// The centre y that stands `heightMm` of work on this slab's top face.
function seatedCenterYMm(shelf: { yMm: number; heightMm: number }, heightMm: number): number {
  return shelfTopYMm(shelf) + heightMm / 2;
}

// The shelf a work being moved in a surface WITH a vertical axis (3D) should
// seat on, and the centre y that seats it — or null when no overlapping shelf's
// top face is within captureMm of the work's current bottom edge.
//
// Nearest wins, measured bottom-edge-to-top-face, so two stacked shelves under
// the same work resolve to the one the work is actually closest to rather than
// to whichever happens to be first in the wall-object list.
export function seatOnShelfTop(
  moving: SeatingMover & { yMm: number },
  wallObjects: readonly WallObject[],
  captureMm: number
): { yMm: number; shelfId: string } | null {
  const bottomYMm = moving.yMm - moving.heightMm / 2;
  let best: { yMm: number; shelfId: string; distanceMm: number } | null = null;
  for (const shelf of getShelfSnapCandidates(moving, wallObjects)) {
    const distanceMm = Math.abs(shelfTopYMm(shelf) - bottomYMm);
    if (distanceMm > captureMm) continue;
    if (best && best.distanceMm <= distanceMm) continue;
    best = {
      yMm: seatedCenterYMm(shelf, moving.heightMm),
      shelfId: shelf.id,
      distanceMm
    };
  }
  return best ? { yMm: best.yMm, shelfId: best.shelfId } : null;
}

// The plan twin: same answer with NO vertical test, because plan has no
// vertical axis to test against. A work dropped over a shelf's footprint in
// plan is a work the curator put on that shelf — there is no "near enough" to
// ask about, only "over it or not".
//
// Widest x-overlap wins rather than list order: dropping over the middle of a
// long slab that a short one clips the end of should read as the long one.
export function seatOnAnyOverlappingShelf(
  moving: SeatingMover,
  wallObjects: readonly WallObject[]
): { yMm: number; shelfId: string } | null {
  let best: { yMm: number; shelfId: string; overlapMm: number } | null = null;
  for (const shelf of getShelfSnapCandidates(moving, wallObjects)) {
    const overlapMm =
      Math.min(moving.xMm + moving.widthMm / 2, shelf.xMm + shelf.widthMm / 2) -
      Math.max(moving.xMm - moving.widthMm / 2, shelf.xMm - shelf.widthMm / 2);
    if (best && best.overlapMm >= overlapMm) continue;
    best = {
      yMm: seatedCenterYMm(shelf, moving.heightMm),
      shelfId: shelf.id,
      overlapMm
    };
  }
  return best ? { yMm: best.yMm, shelfId: best.shelfId } : null;
}
