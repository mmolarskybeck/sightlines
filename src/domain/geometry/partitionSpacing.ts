// Partition spacing geometry (plan mode): ray-cast from a partition's SLAB
// FACES to the nearest obstacle so the app can (a) center a partition between
// the things it sits between, (b) offer equidistant snap targets during a
// drag, and (c) draw live clearance dimension lines. Pure — room-local
// millimetres in, room-local millimetres out; the caller lifts to floor space
// by the placement offset.
//
// Two families of clearance are computed for every partition:
//   • normal (perpendicular to the centerline) — the gaps to whatever the
//     partition's two long faces look at. Cast from the SLAB FACE (centerline
//     midpoint ± unitNormal·thickness/2) so the number is the TRUE clear gap,
//     not centerline-to-obstacle.
//   • span (along the centerline) — the gaps off each end cap. Cast from the
//     ENDPOINTS (the slab end caps sit on the endpoints) so the number is the
//     true gap past the end of the partition, never inflated by half the
//     partition's own length.
//
// Obstacles are the room perimeter segments PLUS every OTHER partition in the
// room, each as its 4-segment slab outline (two long faces at centerline ±
// unitNormal·thickness/2, two end caps). The subject partition is excluded.
// The ray is solved parametrically against every segment, so angled partitions
// and polygonal (L-shaped, etc.) rooms work by construction.

import type { FreestandingWall, Room } from "../project";
import type { Point } from "../snapping/resolveSnap";
import { getWallsWithGeometry } from "./walls";
import { add, normalize, scale, subtract, unitLeftNormalOrZero } from "./vector";

// A ray→obstacle intersection: the distance travelled from the origin, the
// point hit (room-local), and the id of the obstacle it landed on (a perimeter
// wall id, or another partition's id).
export type RayHit = {
  distanceMm: number;
  pointMm: Point;
  obstacleId: string;
};

// A single clearance ray: where it starts (a slab face point or an end cap),
// the unit direction it was cast, and its nearest hit (null when it misses).
export type SideClearance = {
  originMm: Point;
  dirUnit: Point;
  hit: RayHit | null;
};

// The four face-accurate clearances of a partition: the two perpendicular
// (normal) gaps and the two along-span (end cap) gaps.
export type PartitionClearances = {
  normal: { plus: SideClearance; minus: SideClearance };
  span: { plus: SideClearance; minus: SideClearance };
};

// A room-local obstacle segment the ray can hit, tagged with the id of the
// thing it belongs to.
export type ObstacleSegment = {
  a: Point;
  b: Point;
  id: string;
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

// The 4-segment slab outline of a partition in room-local coordinates: the two
// long faces offset ±thickness/2 along the centerline's left normal, plus the
// two end caps joining them. Mirrors getFreestandingFaces' offset math so a
// ray sees exactly the rectangle the plan paints. A degenerate (zero-length)
// partition yields a zero normal and collapses to its centerline — harmless.
export function partitionSlabSegments(partition: FreestandingWall): ObstacleSegment[] {
  const start: Point = { xMm: partition.startXMm, yMm: partition.startYMm };
  const end: Point = { xMm: partition.endXMm, yMm: partition.endYMm };
  const half = partition.thicknessMm / 2;
  const normal = unitLeftNormalOrZero(start, end);
  const off = scale(normal, half);
  const startPlus = add(start, off);
  const endPlus = add(end, off);
  const startMinus = subtract(start, off);
  const endMinus = subtract(end, off);
  return [
    { a: startPlus, b: endPlus, id: partition.id }, // +normal long face
    { a: startMinus, b: endMinus, id: partition.id }, // -normal long face
    { a: startPlus, b: startMinus, id: partition.id }, // start end cap
    { a: endPlus, b: endMinus, id: partition.id } // end end cap
  ];
}

// Every obstacle a clearance ray for the subject partition may hit: the room
// perimeter walls (tagged with their wall id) plus the slab outline of every
// OTHER partition in the room. The subject is excluded so it never blocks its
// own rays.
export function collectObstacleSegments(room: Room, subjectId: string): ObstacleSegment[] {
  const segments: ObstacleSegment[] = getWallsWithGeometry(room).map((wall) => ({
    a: { xMm: wall.start.xMm, yMm: wall.start.yMm },
    b: { xMm: wall.end.xMm, yMm: wall.end.yMm },
    id: wall.id
  }));
  for (const partition of room.freestandingWalls) {
    if (partition.id === subjectId) continue;
    segments.push(...partitionSlabSegments(partition));
  }
  return segments;
}

// Cast a ray from `originMm` along UNIT `dirUnit` and return the NEAREST
// (smallest positive distance) intersection with `segments`, or null when the
// ray escapes without crossing one. Each segment is solved parametrically:
// origin + t·dir = A + u·(B − A), keeping hits with t > EPS and u ∈ [0, 1]. A
// degenerate (zero-length) direction never hits.
export function castRay(
  segments: ObstacleSegment[],
  originMm: Point,
  dirUnit: Point
): RayHit | null {
  if (Math.abs(dirUnit.xMm) < EPS && Math.abs(dirUnit.yMm) < EPS) return null;

  let best: RayHit | null = null;

  for (const segment of segments) {
    const ax = segment.a.xMm;
    const ay = segment.a.yMm;
    const ex = segment.b.xMm - ax;
    const ey = segment.b.yMm - ay;

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
        obstacleId: segment.id
      };
    }
  }

  return best;
}

// The four face-accurate clearances of `partition` inside `room`. Normal casts
// start on the slab faces (midpoint ± unitNormal·thickness/2) so the numbers
// exclude the partition's own thickness; span casts start on the endpoints so
// the numbers exclude the partition's own length. Every other partition is an
// obstacle alongside the room perimeter.
export function getPartitionClearances(
  room: Room,
  partition: FreestandingWall
): PartitionClearances {
  const start: Point = { xMm: partition.startXMm, yMm: partition.startYMm };
  const end: Point = { xMm: partition.endXMm, yMm: partition.endYMm };
  const half = partition.thicknessMm / 2;
  const normalDir = unitLeftNormalOrZero(start, end);
  const spanDir = safeDirection(start, end);
  const segments = collectObstacleSegments(room, partition.id);

  const midpointMm: Point = {
    xMm: (start.xMm + end.xMm) / 2,
    yMm: (start.yMm + end.yMm) / 2
  };

  const side = (originMm: Point, dirUnit: Point): SideClearance => ({
    originMm,
    dirUnit,
    hit: castRay(segments, originMm, dirUnit)
  });

  const negNormal = scale(normalDir, -1);
  const negSpan = scale(spanDir, -1);
  return {
    // Normal: origin offset to the slab face so the gap is truly clear.
    normal: {
      plus: side(add(midpointMm, scale(normalDir, half)), normalDir),
      minus: side(add(midpointMm, scale(negNormal, half)), negNormal)
    },
    // Span: origin at each end cap (the endpoints), casting outward. The +span
    // ray leaves the `end` endpoint; the −span ray leaves the `start` endpoint.
    span: {
      plus: side(end, spanDir),
      minus: side(start, negSpan)
    }
  };
}

// Which of a partition's two clearance DIRECTIONS — its span (the along-
// centerline / end-cap gaps, reported as "axis") or its unit normal (the
// perpendicular / face gaps, reported as "normal") — is DOMINANT on the given
// world axis. Span and normal are perpendicular, so exactly one is x-dominant
// and the other y-dominant, except at an exact 45° tilt where their |components|
// tie. The tie is broken deterministically so the span always counts as
// x-dominant: world "x" favors the span (>=), world "y" favors the normal
// (strict >), and the two world axes therefore never resolve to the same
// direction. For a horizontal partition: world x → "axis", world y → "normal";
// a vertical partition is the mirror. Drives both the axis-named centering
// buttons and the motion-relevant dimension mask.
export function partitionAxisForWorldAxis(
  partition: FreestandingWall,
  world: "x" | "y"
): "normal" | "axis" {
  const start: Point = { xMm: partition.startXMm, yMm: partition.startYMm };
  const end: Point = { xMm: partition.endXMm, yMm: partition.endYMm };
  const spanDir = safeDirection(start, end);
  const normalDir = unitLeftNormalOrZero(start, end);
  const spanComp = world === "x" ? Math.abs(spanDir.xMm) : Math.abs(spanDir.yMm);
  const normalComp = world === "x" ? Math.abs(normalDir.xMm) : Math.abs(normalDir.yMm);
  if (world === "x") return spanComp >= normalComp ? "axis" : "normal";
  return spanComp > normalComp ? "axis" : "normal";
}

// Centerline direction as a unit vector, tolerating a degenerate (coincident-
// endpoint) partition by returning the zero vector — castRay then reports no
// hit rather than dividing by zero.
function safeDirection(from: Point, to: Point): Point {
  const delta = subtract(to, from);
  if (Math.abs(delta.xMm) < EPS && Math.abs(delta.yMm) < EPS) return { xMm: 0, yMm: 0 };
  return normalize(delta);
}
