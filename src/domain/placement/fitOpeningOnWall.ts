import { clamp } from "../geometry/scalar";
import type { WallObjectBase } from "../project";
import { getOpenSpaceBounds } from "./arrangeOnWall";

// Lengths within this are treated as identical. A door exactly as wide as its
// wall is a legitimate, requestable result (a full-span passage reserves no
// jamb), so 12' must never read as overflowing a 12' wall because the two
// values differ in the last float bit. Well under any unit's display precision.
export const FIT_EPSILON_MM = 0.5;

export type OpeningFitConstraint =
  | "none"
  | "wall"
  | "neighbor"
  | "paired-wall"
  | "paired-neighbor";

export type OpeningFit = {
  requestedWidthMm: number;
  widthMm: number;
  xMm: number;
  // Independent, because one request can be BOTH: a width too wide for the
  // span is trimmed AND the opening slides to sit inside it.
  widthClamped: boolean;
  positionAdjusted: boolean;
  movedByMm: number;
  constraint: OpeningFitConstraint;
  // A paired opening whose two faces share no mutually available run at all.
  // Nothing is committed in that case: half a shared opening cannot move
  // without the other half, so the request is reported rather than applied.
  noMutualSpan?: boolean;
};

// Resolve a requested width against the legal span an opening may occupy,
// moving it as little as possible.
//
//   width = min(requested, spanLength)
//   x     = clamp(currentX, spanStart + width/2, spanEnd - width/2)
//
// That single clamp expresses the whole rule. On a 12' wall with a door at 3':
//   - request 11' -> width 11', range [5'6", 6'6"] -> x = 5'6" (slid, NOT centred)
//   - request 14' -> width 12', range collapses to one point -> x = 6'
//   - request 3'  -> already fits -> x unchanged
//
// Requested widths are preserved whenever they fit anywhere in the span, and
// reduced only when they cannot fit at all. Nothing here can produce geometry
// outside the span, so callers never need to reject the result.
//
// NOTE for a future drag-resize handle: do NOT reuse this. Dragging an edge
// states a more specific intent than typing a number — the opposite edge stays
// anchored and the dragged edge stops at the boundary, rather than the whole
// opening sliding to preserve the requested width.
export function fitOpeningOnWall(args: {
  requestedWidthMm: number;
  currentXMm: number;
  spanStartMm: number;
  spanEndMm: number;
  constraintSource: OpeningFitConstraint;
}): OpeningFit {
  const { requestedWidthMm, currentXMm, spanStartMm, spanEndMm, constraintSource } = args;
  const spanLengthMm = Math.max(0, spanEndMm - spanStartMm);

  const widthClamped = requestedWidthMm > spanLengthMm + FIT_EPSILON_MM;
  const widthMm = widthClamped ? spanLengthMm : requestedWidthMm;

  const halfWidthMm = widthMm / 2;
  const minXMm = spanStartMm + halfWidthMm;
  const maxXMm = spanEndMm - halfWidthMm;
  // maxXMm < minXMm only under float noise once the width is clamped to the
  // span; the span midpoint is the single legal centre in that case.
  const xMm =
    maxXMm < minXMm ? (spanStartMm + spanEndMm) / 2 : clamp(currentXMm, minXMm, maxXMm);

  const movedByMm = Math.abs(xMm - currentXMm);
  const positionAdjusted = movedByMm > FIT_EPSILON_MM;

  return {
    requestedWidthMm,
    widthMm,
    xMm,
    widthClamped,
    positionAdjusted,
    movedByMm,
    constraint: widthClamped || positionAdjusted ? constraintSource : "none"
  };
}

// The legal span for `opening` on its wall: the free run bounded by the nearest
// same-wall neighbours whose vertical band it overlaps, falling back to the
// wall's own ends.
//
// Position-local by construction, which is the behaviour we want — "Fit wall"
// widens an opening in place and never searches the wall to teleport it into
// some larger gap elsewhere.
//
// Artwork is deliberately NOT a boundary: opening x artwork overlap is
// `blockable` (overridable) under overlapPolicy.ts, so a door may widen past a
// hung work and surface the normal overridable warning. Only the unoverridable
// opening x opening case constrains the span — the same filter
// findFreeOpeningCenterXMm's callers already use.
//
// Because detectBoundary returns a neighbour's exact edge and
// doWallObjectsOverlap is strict (edge-touching is legal), an opening fitted
// flush against a boundary is collision-free by construction.
export function getOpeningLegalSpan(
  opening: WallObjectBase,
  sameWallObjects: WallObjectBase[],
  wallLengthMm: number
): { spanStartMm: number; spanEndMm: number; boundedByNeighbor: boolean } {
  const others = sameWallObjects.filter(
    (object) => object.id !== opening.id && !isArtwork(object)
  );

  const { startMm, endMm } = getOpenSpaceBounds([opening], others, wallLengthMm);

  // getOpenSpaceBounds assumes the member does not already overlap a neighbour.
  // Legacy documents predating the overlap policy can violate that, and the
  // boundaries then cross over into an inverted (negative-length) span. Fall
  // back to the wall itself rather than "fitting" the opening down to nothing —
  // the commit gate still reports the overlap.
  if (endMm - startMm < FIT_EPSILON_MM) {
    return { spanStartMm: 0, spanEndMm: wallLengthMm, boundedByNeighbor: false };
  }

  return {
    spanStartMm: startMm,
    spanEndMm: endMm,
    boundedByNeighbor: startMm > FIT_EPSILON_MM || endMm < wallLengthMm - FIT_EPSILON_MM
  };
}

function isArtwork(object: WallObjectBase): boolean {
  return (object as { kind?: string }).kind === "artwork";
}
