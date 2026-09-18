import type {
  ArtworkFloorObject,
  Artwork,
  FloorObject,
  SupportFloorObject
} from "../project";
import {
  getFloorObjectPlanRect,
  planRectIntersectsRect,
  type PlanRect
} from "../geometry/planObjects";
import { isMonitorArtwork } from "../geometry/monitorGlyphs";

// Which works are STANDING ON a floor support — its riders. The floor twin of
// shelfRiders.ts, and deliberately its mirror image, down to the function
// names: a pedestal carries works exactly the way a shelf does.
//
// USER DECISION (floor-supports spec §3, the same one shelves settled): riders
// are DERIVED from geometry at every read and never stored. There is no
// membership list, no group id (FloorObjectBase has none to abuse, and
// WallObjectBase.groupId stays dead data), and nothing to keep in sync — a work
// standing on the pedestal when a gesture starts travels with it, and a work
// dragged off simply stops travelling with it. That makes this module the
// ENTIRE definition of the relationship, which is why the tolerance below is
// deliberately tight.
//
// Pure: no store, no project — a floor-object list in, ids/records out, so
// every move path can reach the same answer.

// How near a work's `baseHeightMm` has to sit to a support's top face to count
// as standing on it. 1mm: the seat writes the support's exact heightMm, so the
// only slack this has to absorb is a float rounding, and widening it would
// silently pick up works merely suspended near a pedestal.
export const SUPPORT_SEAT_TOLERANCE_MM = 1;

// A rider is an ARTWORK: a blocked zone, a display case or a second pedestal
// standing at the same height is furniture that happens to be near a box, not a
// work standing on it, and moving the support must not drag it along. Monitors
// DO count — a CRT on its 800mm pedestal is the motivating case.
function isRiderCandidate(object: FloorObject): object is ArtworkFloorObject {
  return object.kind === "artwork";
}

// The axis-aligned bounding box of a (possibly rotated) plan rect.
function planRectBounds(rect: PlanRect): {
  minXMm: number;
  maxXMm: number;
  minYMm: number;
  maxYMm: number;
} {
  const angleRad = (rect.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfW = rect.widthMm / 2;
  const halfD = rect.depthMm / 2;
  const extentXMm = Math.abs(halfW * cos) + Math.abs(halfD * sin);
  const extentYMm = Math.abs(halfW * sin) + Math.abs(halfD * cos);
  return {
    minXMm: rect.centerXMm - extentXMm,
    maxXMm: rect.centerXMm + extentXMm,
    minYMm: rect.centerYMm - extentYMm,
    maxYMm: rect.centerYMm + extentYMm
  };
}

// Do two plan footprints overlap? planRectIntersectsRect is exact for one
// rotated rect against one AXIS-ALIGNED rect, so it is run BOTH ways — each
// rect against the other's bounding box. That tests all four candidate
// separating axes of the true OBB/OBB problem and is therefore conservative
// only in the narrow band where both rects are rotated AND separated by an axis
// neither of them owns; no such configuration exists here, because a rider is
// seated by a gesture that already placed it over the support.
function planRectsOverlap(a: PlanRect, b: PlanRect): boolean {
  return planRectIntersectsRect(a, planRectBounds(b)) && planRectIntersectsRect(b, planRectBounds(a));
}

// APPROXIMATION, stated once here because two callers depend on it: "widest
// overlap" is measured as the intersection AREA of the two footprints' AXIS-
// ALIGNED BOUNDING BOXES, not of the true rotated polygons. It is a tiebreak
// between overlapping supports, never a membership test, and for the
// overwhelmingly common unrotated case the two are identical. Exact convex
// polygon clipping here would buy nothing a curator could see.
function overlapAreaMm2(a: PlanRect, b: PlanRect): number {
  const boundsA = planRectBounds(a);
  const boundsB = planRectBounds(b);
  const widthMm = Math.min(boundsA.maxXMm, boundsB.maxXMm) - Math.max(boundsA.minXMm, boundsB.minXMm);
  const depthMm = Math.min(boundsA.maxYMm, boundsB.maxYMm) - Math.max(boundsA.minYMm, boundsB.minYMm);
  if (widthMm <= 0 || depthMm <= 0) return 0;
  return widthMm * depthMm;
}

// The works standing on `support`: floor artworks whose plan footprint overlaps
// the support's and whose bottom edge (`baseHeightMm`) sits on its top face
// within SUPPORT_SEAT_TOLERANCE_MM. The records returned are the ORIGINAL
// stored objects.
//
// `artworksById` is accepted for call-site parity with resolveFloorStandsOn
// below (and with getShelfRiders, whose framed-footprint join it mirrors) so
// every move path can pass the one map it already holds. Nothing here needs it:
// a floor object carries its own footprint, and monitors are riders like any
// other work.
export function getSupportRiders(
  support: SupportFloorObject,
  floorObjects: readonly FloorObject[],
  artworksById?: ReadonlyMap<string, Artwork>
): ArtworkFloorObject[] {
  void artworksById;
  const supportRect = getFloorObjectPlanRect(support);
  return floorObjects.filter((object): object is ArtworkFloorObject => {
    if (!isRiderCandidate(object)) return false;
    if (Math.abs((object.baseHeightMm ?? 0) - support.heightMm) > SUPPORT_SEAT_TOLERANCE_MM) {
      return false;
    }
    return planRectsOverlap(getFloorObjectPlanRect(object), supportRect);
  });
}

// `objectIds` plus the riders of every support among them — the one expansion
// every floor move path runs before it builds its moving set, so a plan drag, a
// keyboard nudge, a 3D drag and an inspector X/Y edit all carry exactly the
// same works.
//
// Order-preserving (the input ids first, in order, then each support's riders
// in floor-object order), deduplicated, and IDEMPOTENT: expanding an already-
// expanded set adds nothing, because a rider is an artwork and contributes no
// riders of its own. Ids that match no object are passed through untouched —
// this function narrows nothing, it only adds.
export function expandWithSupportRiders(
  objectIds: readonly string[],
  floorObjects: readonly FloorObject[],
  artworksById?: ReadonlyMap<string, Artwork>
): string[] {
  const selected = new Set(objectIds);
  const expanded = [...selected];
  for (const object of floorObjects) {
    if (object.kind !== "support" || !selected.has(object.id)) continue;
    for (const rider of getSupportRiders(object, floorObjects, artworksById)) {
      if (selected.has(rider.id)) continue;
      selected.add(rider.id);
      expanded.push(rider.id);
    }
  }
  return expanded;
}

// The moving object as the seating arithmetic needs to see it: where its
// footprint is going, how big it is, and how it is turned. Deliberately NOT a
// FloorObject — the plan drag and the checklist drop both ask this question
// about a position that is not stored anywhere yet.
export type SupportSeatMover = {
  id?: string;
  centerMm: { xMm: number; yMm: number };
  widthMm: number;
  depthMm: number;
  rotationDeg: number;
};

function moverPlanRect(moving: SupportSeatMover): PlanRect {
  return {
    centerXMm: moving.centerMm.xMm,
    centerYMm: moving.centerMm.yMm,
    widthMm: moving.widthMm,
    depthMm: moving.depthMm,
    angleDeg: moving.rotationDeg
  };
}

// The supports a moving object could stand on: footprint overlapping the mover
// AT ITS CANDIDATE POSITION, and never the mover itself. The pre-filter every
// seating and snap-target path shares, kept here so the overlap rule that
// decides "this work is on that pedestal" is the SAME predicate whether it is
// offering a capture target or deciding what a support carries when it moves.
export function getSupportSeatCandidates(
  moving: SupportSeatMover,
  floorObjects: readonly FloorObject[]
): SupportFloorObject[] {
  const movingRect = moverPlanRect(moving);
  return floorObjects.filter(
    (object): object is SupportFloorObject =>
      object.kind === "support" &&
      object.id !== moving.id &&
      planRectsOverlap(movingRect, getFloorObjectPlanRect(object))
  );
}

// The plan twin of seatOnAnyOverlappingShelf: plan (and the 3D drop, which
// resolves to a floor point) has no vertical axis to ask "near enough?" about,
// only "over it or not". A work dropped over a pedestal's footprint is a work
// the curator put on that pedestal.
//
// Widest overlap AREA wins rather than list order (see overlapAreaMm2's
// approximation note): dropping over the middle of a big plinth that a small
// pedestal clips the corner of should read as the plinth.
export function seatOnAnyOverlappingSupport(
  moving: SupportSeatMover,
  floorObjects: readonly FloorObject[]
): { baseHeightMm: number; supportId: string } | null {
  const movingRect = moverPlanRect(moving);
  let best: { baseHeightMm: number; supportId: string; areaMm2: number } | null = null;
  for (const support of getSupportSeatCandidates(moving, floorObjects)) {
    const areaMm2 = overlapAreaMm2(movingRect, getFloorObjectPlanRect(support));
    if (best && best.areaMm2 >= areaMm2) continue;
    best = { baseHeightMm: support.heightMm, supportId: support.id, areaMm2 };
  }
  return best ? { baseHeightMm: best.baseHeightMm, supportId: best.supportId } : null;
}

// What a floor object stands on, derived on every render (floor-supports spec
// §2). The inspector's "Stands on" row is a READING with actions, never a
// select: nothing is stored on either side of the relationship, so there is no
// field to write and no state to keep in sync.
export type FloorStandsOn =
  | { kind: "support"; support: SupportFloorObject }
  | { kind: "suspended"; heightMm: number }
  | { kind: "floor" };

// Suspension and standing on a pedestal are exclusive by construction, not by a
// stored flag: a rider's baseHeightMm IS the support's top face, so the same
// number reads as "on the pedestal" exactly when a pedestal is under it and as
// "suspended" when nothing is. A monitor is never suspended (the existing rule
// the elevation ghost and the inspector already apply), so a stale baseHeightMm
// on a cabinet standing over nothing reports as "floor" and renderers treat its
// base height as 0.
export function resolveFloorStandsOn(
  object: FloorObject,
  floorObjects: readonly FloorObject[],
  artworksById?: ReadonlyMap<string, Artwork>
): FloorStandsOn {
  const baseHeightMm = object.baseHeightMm ?? 0;
  const objectRect = getFloorObjectPlanRect(object);

  let best: { support: SupportFloorObject; areaMm2: number } | null = null;
  for (const candidate of floorObjects) {
    if (candidate.kind !== "support" || candidate.id === object.id) continue;
    if (Math.abs(baseHeightMm - candidate.heightMm) > SUPPORT_SEAT_TOLERANCE_MM) continue;
    const candidateRect = getFloorObjectPlanRect(candidate);
    if (!planRectsOverlap(objectRect, candidateRect)) continue;
    const areaMm2 = overlapAreaMm2(objectRect, candidateRect);
    if (best && best.areaMm2 >= areaMm2) continue;
    best = { support: candidate, areaMm2 };
  }
  if (best) return { kind: "support", support: best.support };

  if (baseHeightMm > 0) {
    const artwork =
      object.kind === "artwork" ? artworksById?.get(object.artworkId) : undefined;
    if (!isMonitorArtwork(artwork)) return { kind: "suspended", heightMm: baseHeightMm };
  }
  return { kind: "floor" };
}

// ─── Overhang clamp ────────────────────────────────────────────────────────

// The smallest overlap, per local axis, that still counts as standing on the
// support when overhang IS allowed. Extreme overhang is a legitimate sculptural
// choice; a work standing entirely BESIDE its pedestal is not overhanging, it is
// two objects — and the seat would be lost on the next read anyway, since
// getSupportRiders needs the footprints to overlap.
export const SUPPORT_MIN_OVERLAP_MM = 1;

// Where a rider's centre is ALLOWED to be while it is being dragged on its
// support (floor-supports spec §4, "Overhang").
//
// A HARD clamp, not a drag barrier: resolveDragBarriers works on axis-aligned
// rects in one shared frame, and the containment this expresses lives in the
// SUPPORT's rotated frame with a rider that may be turned differently again —
// two rotations the barrier grammar has no way to say. The spec's stated
// fallback therefore applies: the clamp holds, and the exits are "Set on floor"
// and a ⌘/Ctrl drag (which bypasses seating and this clamp together).
//
// `overhangAllowed` absent/false keeps the whole footprint on the top face;
// true only keeps SUPPORT_MIN_OVERLAP_MM of overlap on both local axes. Either
// way the clamp is on the CENTRE, and a support smaller than its rider simply
// clamps to the centred position (the max(0, …) floors).
export function clampRiderOntoSupport(
  moving: SupportSeatMover,
  support: SupportFloorObject
): { xMm: number; yMm: number } {
  const supportRad = (support.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(supportRad);
  const sin = Math.sin(supportRad);

  // The mover's half-extents measured ALONG the support's own axes: a rider
  // turned 45° on a square pedestal reaches further than its own half-width.
  const relativeRad = ((moving.rotationDeg - support.rotationDeg) * Math.PI) / 180;
  const relCos = Math.abs(Math.cos(relativeRad));
  const relSin = Math.abs(Math.sin(relativeRad));
  const extentXMm = (moving.widthMm / 2) * relCos + (moving.depthMm / 2) * relSin;
  const extentYMm = (moving.widthMm / 2) * relSin + (moving.depthMm / 2) * relCos;

  const overhangOn = support.overhangAllowed === true;
  const boundXMm = overhangOn
    ? Math.max(0, support.widthMm / 2 + extentXMm - SUPPORT_MIN_OVERLAP_MM)
    : Math.max(0, support.widthMm / 2 - extentXMm);
  const boundYMm = overhangOn
    ? Math.max(0, support.depthMm / 2 + extentYMm - SUPPORT_MIN_OVERLAP_MM)
    : Math.max(0, support.depthMm / 2 - extentYMm);

  const dxMm = moving.centerMm.xMm - support.xMm;
  const dyMm = moving.centerMm.yMm - support.yMm;
  const localXMm = clampMm(dxMm * cos + dyMm * sin, -boundXMm, boundXMm);
  const localYMm = clampMm(-dxMm * sin + dyMm * cos, -boundYMm, boundYMm);

  return {
    xMm: support.xMm + localXMm * cos - localYMm * sin,
    yMm: support.yMm + localXMm * sin + localYMm * cos
  };
}

function clampMm(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
