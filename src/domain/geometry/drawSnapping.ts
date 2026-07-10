// Draw-mode room snapping: pure geometry that lets a new polygon room latch
// onto an already-placed room so the two can share a wall exactly. No React,
// no coordinate transforms — floor-space millimetres in, floor-space out.
//
// Kept a small focused module (this codebase deliberately avoids a monolithic
// geometryUtils): only the two things the draw tool needs — "snap the cursor
// to nearby room geometry" and "may this click close the loop onto a wall?".

import { parseFaceWallId } from "./freestandingWalls";
import { projectPointToWall, type FloorWall } from "./planObjects";
import type { Point } from "../snapping/resolveSnap";

// A point pulled onto an existing room's perimeter: `vertex` means the exact
// endpoint, `edge` means the clamped orthogonal projection onto the segment.
export type DrawRoomSnap = {
  pointMm: Point;
  kind: "vertex" | "edge";
  wallId: string;
};

// points[0] must sit this close to a wall's line (and the candidate must sit
// this close to its segment) for a click on that wall to count as closing the
// loop — the snapped candidate is already on the wall, so this is really a
// guard on the FIRST vertex having been drawn from that same wall.
const CLOSE_ON_WALL_TOLERANCE_MM = 1;

// Snap `pointMm` to the nearest room perimeter geometry within thresholdMm, or
// null when nothing is in range. Vertices (wall endpoints) beat edges (segment
// projections) whenever both are in range, so a shared corner lands exactly on
// the corner rather than sliding along the wall. Ties break deterministically:
// vertex-over-edge first, then distance, then wallId.localeCompare — never
// array iteration order. Partition faces are NEVER snap targets (only
// parseFaceWallId(id) === null perimeter walls); a new room shares perimeter
// walls, not the thick slabs floating inside a room.
export function snapDrawPointToRooms(
  pointMm: Point,
  walls: FloorWall[],
  thresholdMm: number
): DrawRoomSnap | null {
  // rank 0 = vertex, rank 1 = edge (lower wins).
  let best: (DrawRoomSnap & { distanceMm: number; rank: number }) | null = null;

  const consider = (candidate: DrawRoomSnap & { distanceMm: number; rank: number }) => {
    if (candidate.distanceMm > thresholdMm) return;
    if (!best) {
      best = candidate;
      return;
    }
    if (candidate.rank !== best.rank) {
      if (candidate.rank < best.rank) best = candidate;
      return;
    }
    if (candidate.distanceMm !== best.distanceMm) {
      if (candidate.distanceMm < best.distanceMm) best = candidate;
      return;
    }
    if (candidate.wallId.localeCompare(best.wallId) < 0) best = candidate;
  };

  for (const wall of walls) {
    if (parseFaceWallId(wall.id) !== null) continue; // perimeter walls only

    for (const endpoint of [wall.startFloorMm, wall.endFloorMm]) {
      consider({
        pointMm: { xMm: endpoint.xMm, yMm: endpoint.yMm },
        kind: "vertex",
        wallId: wall.id,
        distanceMm: Math.hypot(pointMm.xMm - endpoint.xMm, pointMm.yMm - endpoint.yMm),
        rank: 0
      });
    }

    const projection = projectPointToWall(pointMm, wall);
    consider({
      pointMm: projection.pointOnWallMm,
      kind: "edge",
      wallId: wall.id,
      distanceMm: projection.distanceMm,
      rank: 1
    });
  }

  if (!best) return null;
  const winner: DrawRoomSnap & { distanceMm: number; rank: number } = best;
  return { pointMm: winner.pointMm, kind: winner.kind, wallId: winner.wallId };
}

// Would clicking at `candidate` (already room-snapped onto `wall`) close the
// in-progress loop onto that wall? True only when BOTH the candidate and the
// loop's first vertex lie on `wall` (within tolerance) and project inside its
// segment span — i.e. the run of walls was drawn off `wall` and now returns to
// it, so [...points, candidate] shares that wall as coincident geometry. This
// is the pure wall-membership predicate; the caller additionally gates on the
// closed polygon staying simple / self-intersection-free (drawSegmentInvalid +
// isSimplePolygon), which need the whole point list, not just the wall.
export function canCloseOnWall(points: Point[], candidate: Point, wall: FloorWall): boolean {
  if (points.length < 3) return false;

  const first = points[0];
  const firstProj = projectPointToWall(first, wall);
  if (firstProj.distanceMm > CLOSE_ON_WALL_TOLERANCE_MM) return false;
  if (!isWithinSpan(firstProj.xAlongMm, wall.lengthMm)) return false;

  const candidateProj = projectPointToWall(candidate, wall);
  if (candidateProj.distanceMm > CLOSE_ON_WALL_TOLERANCE_MM) return false;
  if (!isWithinSpan(candidateProj.xAlongMm, wall.lengthMm)) return false;

  return true;
}

// projectPointToWall already clamps xAlongMm to [0, length]; this inclusive
// check documents the "within the segment, endpoints allowed" intent and stays
// robust if the projection ever stops clamping.
function isWithinSpan(xAlongMm: number, lengthMm: number): boolean {
  return xAlongMm >= -CLOSE_ON_WALL_TOLERANCE_MM && xAlongMm <= lengthMm + CLOSE_ON_WALL_TOLERANCE_MM;
}
