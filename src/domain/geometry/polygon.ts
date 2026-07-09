// Pure polygon predicates shared by the polygon-room constructor, the plan
// draw tool, and (later slices) partition room-assignment and camera
// containment. No React, no coordinate transforms — inputs are floor-space
// millimetres and every function is a pure predicate.

export type Point = {
  xMm: number;
  yMm: number;
};

// Coordinates arrive grid-snapped (often non-integer, e.g. 304.8 mm/ft), so
// exact-zero orientation tests would be fragile. A small epsilon treats
// near-collinear as collinear.
const EPS = 1e-6;

// Orientation of the ordered triple (o, a, b): the z of (a - o) × (b - o).
// > 0 counter-clockwise, < 0 clockwise, ~0 collinear.
function cross(o: Point, a: Point, b: Point): number {
  return (a.xMm - o.xMm) * (b.yMm - o.yMm) - (a.yMm - o.yMm) * (b.xMm - o.xMm);
}

// Assuming p is collinear with segment a-b, is it within the segment's bounding
// box (i.e. actually on the segment, endpoints included)?
function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    p.xMm <= Math.max(a.xMm, b.xMm) + EPS &&
    p.xMm >= Math.min(a.xMm, b.xMm) - EPS &&
    p.yMm <= Math.max(a.yMm, b.yMm) + EPS &&
    p.yMm >= Math.min(a.yMm, b.yMm) - EPS
  );
}

// Do segments p1-p2 and p3-p4 intersect? Touching at an endpoint and collinear
// overlap both count as intersection — callers that must permit a legitimately
// shared vertex (adjacent polygon edges) handle that themselves.
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p1, p2, p3);
  const d2 = cross(p1, p2, p4);
  const d3 = cross(p3, p4, p1);
  const d4 = cross(p3, p4, p2);

  const straddles =
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
  if (straddles) return true;

  // Collinear / touching cases: an endpoint lies on the other segment.
  if (Math.abs(d1) <= EPS && onSegment(p1, p2, p3)) return true;
  if (Math.abs(d2) <= EPS && onSegment(p1, p2, p4)) return true;
  if (Math.abs(d3) <= EPS && onSegment(p3, p4, p1)) return true;
  if (Math.abs(d4) <= EPS && onSegment(p3, p4, p2)) return true;

  return false;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.xMm - b.xMm) <= EPS && Math.abs(a.yMm - b.yMm) <= EPS;
}

// Two edges that share exactly one endpoint are simple as long as they only
// touch at that shared vertex. They are NOT simple if they are collinear and
// extend in the SAME direction from the shared vertex (a zero-area spike /
// backtrack, or a duplicated edge) — a normal straight-through vertex is
// collinear but extends in opposite directions and stays simple.
function adjacentEdgesOverlap(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  let shared: Point | null = null;
  let pA: Point | null = null;
  let pB: Point | null = null;
  if (samePoint(a1, b1)) {
    shared = a1;
    pA = a2;
    pB = b2;
  } else if (samePoint(a1, b2)) {
    shared = a1;
    pA = a2;
    pB = b1;
  } else if (samePoint(a2, b1)) {
    shared = a2;
    pA = a1;
    pB = b2;
  } else if (samePoint(a2, b2)) {
    shared = a2;
    pA = a1;
    pB = b1;
  }
  if (!shared || !pA || !pB) return false;

  if (Math.abs(cross(shared, pA, pB)) > EPS) return false; // not collinear → fine
  const dot =
    (pA.xMm - shared.xMm) * (pB.xMm - shared.xMm) +
    (pA.yMm - shared.yMm) * (pB.yMm - shared.yMm);
  return dot > EPS; // same direction from the shared vertex → overlap
}

// Is the closed polygon (implied closing edge from the last vertex back to the
// first) simple — no self-intersections? Adjacent edges sharing a vertex do not
// count; any other pair that touches or crosses does. Fewer than 3 points is
// never a valid polygon.
export function isSimplePolygon(points: Point[]): boolean {
  const n = points.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      const b1 = points[j];
      const b2 = points[(j + 1) % n];

      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        if (adjacentEdgesOverlap(a1, a2, b1, b2)) return false;
      } else if (segmentsIntersect(a1, a2, b1, b2)) {
        return false;
      }
    }
  }

  return true;
}

// Twice the signed area — sign is the winding: > 0 is counter-clockwise in
// math y-up (the signed-area convention `deriveScene3d` and the polygon-room
// constructor both key off of).
export function signedAreaMm2(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return sum / 2;
}

// Ray-casting point-in-polygon. Boundary cases are intentionally left
// unspecified (a point exactly on an edge may read either way); callers that
// need boundary tolerance own it.
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const straddlesY = pi.yMm > point.yMm !== pj.yMm > point.yMm;
    if (
      straddlesY &&
      point.xMm <
        ((pj.xMm - pi.xMm) * (point.yMm - pi.yMm)) / (pj.yMm - pi.yMm) + pi.xMm
    ) {
      inside = !inside;
    }
  }
  return inside;
}
