import type { Floor, FloorObject, WallObjectBase } from "../project";
import type { Point } from "../snapping/resolveSnap";
import { getWallsWithGeometry, type WallWithGeometry } from "./walls";

// Doors/windows render as zero-thickness lines in plan view, so their rects
// need a nominal thickness to be visible/clickable — fixed (not editable),
// unlike floor objects' DEFAULT_FLOOR_OBJECT_DEPTH_MM.
export const WALL_OBJECT_PLAN_DEPTH_MM = 100;

// A room's wall lifted into floor coordinates: RoomPlacement.rotationDeg is
// validated to be 0 elsewhere (rooms are placed axis-aligned), so lifting a
// wall's endpoints only requires adding the room's offset — no rotation math.
export type FloorWall = WallWithGeometry & {
  startFloorMm: Point;
  endFloorMm: Point;
};

export function getFloorWalls(floor: Floor): FloorWall[] {
  return floor.rooms.flatMap((placement) =>
    getWallsWithGeometry(placement.room).map((wall) => ({
      ...wall,
      startFloorMm: {
        xMm: wall.start.xMm + placement.offsetXMm,
        yMm: wall.start.yMm + placement.offsetYMm
      },
      endFloorMm: {
        xMm: wall.end.xMm + placement.offsetXMm,
        yMm: wall.end.yMm + placement.offsetYMm
      }
    }))
  );
}

// Floor-space rectangle for plan rendering: center + size + rotation, ready
// for an SVG <rect> with transform={`rotate(${angleDeg} ${centerXMm} ${centerYMm})`}.
export type PlanRect = {
  centerXMm: number;
  centerYMm: number;
  widthMm: number;
  depthMm: number;
  angleDeg: number;
};

// Wall objects (doors/windows/blocked-zones anchored to a wall) render
// centered ON the wall line — object.xMm is the distance of the object's
// center along the wall from its start, matching elevation view's convention.
export function getWallObjectPlanRect(
  wall: FloorWall,
  object: Pick<WallObjectBase, "xMm" | "widthMm">,
  depthMm: number = WALL_OBJECT_PLAN_DEPTH_MM
): PlanRect {
  const dx = wall.endFloorMm.xMm - wall.startFloorMm.xMm;
  const dy = wall.endFloorMm.yMm - wall.startFloorMm.yMm;
  const angleRad = Math.atan2(dy, dx);
  const t = wall.lengthMm === 0 ? 0 : object.xMm / wall.lengthMm;

  return {
    centerXMm: wall.startFloorMm.xMm + dx * t,
    centerYMm: wall.startFloorMm.yMm + dy * t,
    widthMm: object.widthMm,
    depthMm,
    angleDeg: (angleRad * 180) / Math.PI
  };
}

// Floor-placed objects (artworks/blocked-zones dragged off all walls) carry
// their own center, footprint, and rotation directly — no wall to project onto.
export function getFloorObjectPlanRect(object: FloorObject): PlanRect {
  return {
    centerXMm: object.xMm,
    centerYMm: object.yMm,
    widthMm: object.widthMm,
    depthMm: object.depthMm,
    angleDeg: object.rotationDeg
  };
}

// Where a floor-space point lands on a wall segment: xAlongMm is the
// distance from the wall's start to the orthogonal projection, CLAMPED to
// the segment (so a point beyond either end reads as sitting at that end,
// not off in space); distanceMm is measured to that clamped point, not the
// unclamped projection, so it read as "how far from the segment" not "how
// far from the infinite line."
export type WallProjection = {
  wallId: string;
  xAlongMm: number;
  distanceMm: number;
  pointOnWallMm: Point;
};

export function projectPointToWall(pointMm: Point, wall: FloorWall): WallProjection {
  const dx = wall.endFloorMm.xMm - wall.startFloorMm.xMm;
  const dy = wall.endFloorMm.yMm - wall.startFloorMm.yMm;
  const lengthSq = dx * dx + dy * dy;

  const rawT =
    lengthSq === 0
      ? 0
      : ((pointMm.xMm - wall.startFloorMm.xMm) * dx +
          (pointMm.yMm - wall.startFloorMm.yMm) * dy) /
        lengthSq;
  const t = Math.min(1, Math.max(0, rawT));

  const pointOnWallMm: Point = {
    xMm: wall.startFloorMm.xMm + dx * t,
    yMm: wall.startFloorMm.yMm + dy * t
  };

  return {
    wallId: wall.id,
    xAlongMm: wall.lengthMm * t,
    distanceMm: Math.hypot(pointMm.xMm - pointOnWallMm.xMm, pointMm.yMm - pointOnWallMm.yMm),
    pointOnWallMm
  };
}

// Nearest wall within maxDistanceMm, or null if every wall is farther away
// (or there are no walls). Ties break on wallId so wall-capture behavior is
// deterministic rather than depending on array iteration order.
export function findNearestWall(
  pointMm: Point,
  walls: FloorWall[],
  maxDistanceMm: number
): WallProjection | null {
  let best: WallProjection | null = null;

  for (const wall of walls) {
    const projection = projectPointToWall(pointMm, wall);
    if (projection.distanceMm > maxDistanceMm) continue;

    if (
      !best ||
      projection.distanceMm < best.distanceMm ||
      (projection.distanceMm === best.distanceMm && projection.wallId.localeCompare(best.wallId) < 0)
    ) {
      best = projection;
    }
  }

  return best;
}
