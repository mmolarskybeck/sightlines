import type { Artwork, ArtworkWallObject, ShelfWallObject, WallObject } from "../project";
import { SHELF_TOP_SNAP_TOLERANCE_MM, shelfTopYMm } from "../geometry/shelfGlyphs";
import { withArtworkFootprintFromMap } from "../framing";

// Which works are STANDING ON a shelf — its riders.
//
// USER DECISION: riders are DERIVED from geometry at move time, on every path,
// and never stored. There is no membership list, no group id (WallObjectBase.
// groupId is dead data), and nothing to keep in sync: a work that is sitting on
// the shelf when the gesture starts travels with it, and a work that has been
// dragged off it simply stops travelling with it. That makes this module the
// ENTIRE definition of the relationship, and it is why the tolerance below is
// deliberately tight (SHELF_TOP_SNAP_TOLERANCE_MM — the same 2mm the shelf-top
// snap target captures at, so a work the curator snapped onto a shelf is
// exactly a work the shelf then carries).
//
// Pure: no store, no project — a wall-object list in, ids/records out, so every
// one of the six move paths can reach the same answer.

// A rider is an ARTWORK: a case, a wall text, a door or another shelf sitting
// at the same height is furniture that happens to be near a slab, not a work
// standing on it, and moving the shelf must not drag it along.
function isRiderCandidate(object: WallObject): object is ArtworkWallObject {
  return object.kind === "artwork";
}

// Horizontal overlap is STRICT: a work whose edge merely touches the shelf's
// end (rider right edge exactly at the shelf's left edge) is beside the shelf,
// not on it. Half a millimetre of genuine overlap is enough, which matches how
// the snap target is offered — it is tested against the moving work's x-span.
function xSpansOverlap(
  a: { xMm: number; widthMm: number },
  b: { xMm: number; widthMm: number }
): boolean {
  return (
    a.xMm + a.widthMm / 2 > b.xMm - b.widthMm / 2 &&
    a.xMm - a.widthMm / 2 < b.xMm + b.widthMm / 2
  );
}

// The works standing on `shelf`: same wall, x-spans overlapping, and bottom
// edge within SHELF_TOP_SNAP_TOLERANCE_MM of the shelf's top face — all three
// measured on the FRAMED OUTER FOOTPRINT (withArtworkFootprintFromMap), never
// the stored image box. The framed outer bottom is the foot: it is what the
// elevation move-drag, the checklist drop and the placement barriers all seat
// on the slab, so testing the stored bottom here would mean a matted or framed
// work that was visibly standing on a shelf was never carried by it. The
// records returned are the ORIGINAL stored objects — only the test widens.
//
// `artworksById` is optional so the pure/unframed callers (and old tests) still
// read correctly: a missing map, a missing record, a frame-inclusive work or a
// frameless display type all resolve to the stored box, unchanged.
export function getShelfRiders(
  shelf: ShelfWallObject,
  wallObjects: readonly WallObject[],
  artworksById?: ReadonlyMap<string, Artwork>
): ArtworkWallObject[] {
  const topYMm = shelfTopYMm(shelf);
  return wallObjects.filter((object): object is ArtworkWallObject => {
    if (!isRiderCandidate(object)) return false;
    if (object.wallId !== shelf.wallId) return false;
    const footprint = withArtworkFootprintFromMap(object, artworksById);
    if (!xSpansOverlap(footprint, shelf)) return false;
    const bottomYMm = footprint.yMm - footprint.heightMm / 2;
    return Math.abs(bottomYMm - topYMm) <= SHELF_TOP_SNAP_TOLERANCE_MM;
  });
}

// `objectIds` plus the riders of every shelf among them — the one expansion
// every move path runs before it builds its moving set, so a pointer drag, a
// keyboard nudge, a plan drag and an inspector edit all carry exactly the same
// works.
//
// Order-preserving (the input ids first, in order, then each shelf's riders in
// wall-object order), deduplicated, and IDEMPOTENT: expanding an already-
// expanded set adds nothing, because a rider is not a shelf and contributes no
// riders of its own. Ids that match no object are passed through untouched —
// this function narrows nothing, it only adds.
export function expandWithShelfRiders(
  objectIds: readonly string[],
  wallObjects: readonly WallObject[],
  artworksById?: ReadonlyMap<string, Artwork>
): string[] {
  const selected = new Set(objectIds);
  const expanded = [...selected];
  for (const object of wallObjects) {
    if (object.kind !== "shelf" || !selected.has(object.id)) continue;
    for (const rider of getShelfRiders(object, wallObjects, artworksById)) {
      if (selected.has(rider.id)) continue;
      selected.add(rider.id);
      expanded.push(rider.id);
    }
  }
  return expanded;
}

// The shelves a moving object could stand on: same wall, x-span overlapping
// the moving object AT ITS CURRENT X, and never the moving object itself. The
// pre-filter getArtworkSnapTargets expects for its `shelves` argument, kept
// here so the overlap rule that decides "this work is on that shelf" is the
// SAME predicate whether it is offering a snap target or deciding what a shelf
// carries when it moves.
export function getShelfSnapCandidates(
  moving: { id?: string; wallId: string; xMm: number; widthMm: number },
  wallObjects: readonly WallObject[]
): ShelfWallObject[] {
  return wallObjects.filter(
    (object): object is ShelfWallObject =>
      object.kind === "shelf" &&
      object.id !== moving.id &&
      object.wallId === moving.wallId &&
      xSpansOverlap(moving, object)
  );
}
