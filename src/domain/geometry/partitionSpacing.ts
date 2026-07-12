// Partition spacing geometry (plan mode): ray-cast from a partition's
// centerline to the enclosing room perimeter so the app can (a) center a
// partition between the walls it sits between, (b) offer equidistant snap
// targets during a drag, and (c) draw live clearance dimension lines. Pure —
// room-local millimetres in, room-local millimetres out; the caller lifts to
// floor space by the placement offset. No parallelism assumption: the ray is
// solved parametrically against every perimeter segment, so angled partitions
// and polygonal (L-shaped, etc.) rooms work by construction.

import type { FreestandingWall, Room } from "../project";
import type { Point } from "../snapping/resolveSnap";
import { getWallsWithGeometry } from "./walls";
import { midpoint, normalize, subtract, unitLeftNormalOrZero } from "./vector";

// A ray→perimeter intersection: the distance travelled from the origin, the
// point hit (room-local), and the perimeter wall it landed on.
export type RayHit = {
  distanceMm: number;
  pointMm: Point;
  wallId: string;
};

// Direction/parallel tolerance for the parametric solve. Coordinates arrive
// grid-snapped (often non-integer, e.g. 304.8 mm/ft), so an exact-zero
// determinant test would be fragile — a small epsilon treats a near-parallel
// ray/segment as non-intersecting rather than producing a wild t.
const EPS = 1e-6;

// z of a × b for 2D vectors (matches polygon.ts / vector.ts cross semantics).
function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

// Cast a ray from `originMm` along UNIT `dirUnit` and return the NEAREST
// (smallest positive distance) intersection with the room's perimeter walls,
// or null when the ray escapes without crossing one (e.g. the origin lies
// outside the polygon and the ray points away). Each perimeter segment is
// solved parametrically: origin + t·dir = A + u·(B − A), keeping hits with
// t > EPS and u ∈ [0, 1]. A degenerate (zero-length) direction never hits.
export function castRayToPerimeter(
  room: Room,
  originMm: Point,
  dirUnit: Point
): RayHit | null {
  if (Math.abs(dirUnit.xMm) < EPS && Math.abs(dirUnit.yMm) < EPS) return null;

  let best: RayHit | null = null;

  for (const wall of getWallsWithGeometry(room)) {
    const ax = wall.start.xMm;
    const ay = wall.start.yMm;
    const ex = wall.end.xMm - ax;
    const ey = wall.end.yMm - ay;

    // origin + t·dir = A + u·E. Solve with Cramer's rule on [dir, −E].
    const denom = cross(dirUnit.xMm, dirUnit.yMm, ex, ey);
    if (Math.abs(denom) < EPS) continue; // ray parallel to this segment

    const oax = ax - originMm.xMm;
    const oay = ay - originMm.yMm;
    // t = (A − O) × E / (dir × E); u = (A − O) × dir / (dir × E).
    const t = cross(oax, oay, ex, ey) / denom;
    const u = cross(oax, oay, dirUnit.xMm, dirUnit.yMm) / denom;
    if (t <= EPS) continue; // behind or at the origin
    if (u < -EPS || u > 1 + EPS) continue; // beyond the segment span

    if (!best || t < best.distanceMm) {
      best = {
        distanceMm: t,
        pointMm: { xMm: originMm.xMm + dirUnit.xMm * t, yMm: originMm.yMm + dirUnit.yMm * t },
        wallId: wall.id
      };
    }
  }

  return best;
}

// The clearances on both sides of a partition's centerline midpoint, cast
// along a chosen axis. "normal" casts along the centerline's left/right normal
// (the gap to the walls the partition faces); "axis" casts along the
// centerline direction (the gap to the walls at the ends of its span). `plus`
// is the +dir hit, `minus` the −dir hit; either is null when that ray misses.
export type PartitionClearances = {
  originMm: Point; // centerline midpoint (room-local)
  dirUnit: Point;
  plus: RayHit | null;
  minus: RayHit | null;
};

export function getPartitionClearances(
  room: Room,
  partition: FreestandingWall,
  axis: "normal" | "axis"
): PartitionClearances {
  const start: Point = { xMm: partition.startXMm, yMm: partition.startYMm };
  const end: Point = { xMm: partition.endXMm, yMm: partition.endYMm };
  const originMm = midpoint(start, end);

  const dirUnit =
    axis === "normal"
      ? unitLeftNormalOrZero(start, end)
      : safeDirection(start, end);

  const minusDir = { xMm: -dirUnit.xMm, yMm: -dirUnit.yMm };
  return {
    originMm,
    dirUnit,
    plus: castRayToPerimeter(room, originMm, dirUnit),
    minus: castRayToPerimeter(room, originMm, minusDir)
  };
}

// Centerline direction as a unit vector, tolerating a degenerate (coincident-
// endpoint) partition by returning the zero vector — castRayToPerimeter then
// reports no hit rather than dividing by zero.
function safeDirection(from: Point, to: Point): Point {
  const delta = subtract(to, from);
  if (Math.abs(delta.xMm) < EPS && Math.abs(delta.yMm) < EPS) return { xMm: 0, yMm: 0 };
  return normalize(delta);
}
