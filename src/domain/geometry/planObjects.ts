import type { Floor, FloorObject, WallObjectBase } from "../project";
import type { Point } from "../snapping/resolveSnap";
import { getRoomPlaceableWalls } from "./placeableWalls";
import type { WallWithGeometry } from "./walls";

// Doors/windows render as zero-thickness lines in plan view, so their rects
// need a nominal frame/leaf depth to be visible/clickable — fixed (not
// editable), unlike floor objects' DEFAULT_FLOOR_OBJECT_DEPTH_MM.
export const WALL_OBJECT_PLAN_DEPTH_MM = 150;

// A room's wall lifted into floor coordinates: RoomPlacement.rotationDeg is
// validated to be 0 elsewhere (rooms are placed axis-aligned), so lifting a
// wall's endpoints only requires adding the room's offset — no rotation math.
export type FloorWall = WallWithGeometry & {
  startFloorMm: Point;
  endFloorMm: Point;
};

export function getFloorWalls(floor: Floor): FloorWall[] {
  // Perimeter walls plus partition faces (spec §5.3/§6.1). Faces are physically
  // offset ±t/2, so nearest-face capture falls out of the plain distance test
  // with no side-of-line logic — resolvePlanPlacement/findNearestWall are
  // untouched.
  return floor.rooms.flatMap((placement) =>
    getRoomPlaceableWalls(placement.room).map((wall) => ({
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

// Does a (possibly rotated) plan rect intersect an axis-aligned marquee rect?
// Elevation's counterpart (getIdsIntersectingRect) gets away with a plain
// min/max overlap test because wall objects are axis-aligned in wall-local
// space — but plan objects are NOT: wall objects lie along angled walls
// (angleDeg = the wall's floor-space direction) and floor objects carry their
// own rotationDeg. An axis-aligned bounding-box test on a 45°-rotated rect
// would false-positive on the empty corners of its bounding box, so this uses
// the separating-axis theorem instead: two convex polygons are disjoint iff
// their projections onto some candidate axis don't overlap. For two rectangles
// the only candidates are the four edge normals — world x, world y, and the
// plan rect's two local axes — so testing those four axes is exact.
export function planRectIntersectsRect(
  planRect: PlanRect,
  rect: { minXMm: number; maxXMm: number; minYMm: number; maxYMm: number }
): boolean {
  const angleRad = (planRect.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfW = planRect.widthMm / 2;
  const halfD = planRect.depthMm / 2;

  // The plan rect's 4 corners: center ± halfWidth along its local x axis
  // (cos, sin) ± halfDepth along its local y axis (-sin, cos).
  const planCorners: Point[] = [
    { xMm: -halfW, yMm: -halfD },
    { xMm: halfW, yMm: -halfD },
    { xMm: halfW, yMm: halfD },
    { xMm: -halfW, yMm: halfD }
  ].map((local) => ({
    xMm: planRect.centerXMm + local.xMm * cos - local.yMm * sin,
    yMm: planRect.centerYMm + local.xMm * sin + local.yMm * cos
  }));

  // The marquee's 4 corners, straight from its min/max bounds.
  const rectCorners: Point[] = [
    { xMm: rect.minXMm, yMm: rect.minYMm },
    { xMm: rect.maxXMm, yMm: rect.minYMm },
    { xMm: rect.maxXMm, yMm: rect.maxYMm },
    { xMm: rect.minXMm, yMm: rect.maxYMm }
  ];

  // The four candidate separating axes: world x, world y, and the plan rect's
  // two local axes. (The marquee's own axes ARE world x/y, so they don't add
  // new candidates.)
  const axes: Point[] = [
    { xMm: 1, yMm: 0 },
    { xMm: 0, yMm: 1 },
    { xMm: cos, yMm: sin },
    { xMm: -sin, yMm: cos }
  ];

  for (const axis of axes) {
    const planProj = planCorners.map((corner) => corner.xMm * axis.xMm + corner.yMm * axis.yMm);
    const rectProj = rectCorners.map((corner) => corner.xMm * axis.xMm + corner.yMm * axis.yMm);
    const planMin = Math.min(...planProj);
    const planMax = Math.max(...planProj);
    const rectMin = Math.min(...rectProj);
    const rectMax = Math.max(...rectProj);

    // Strictly disjoint on this axis → the axis separates them → no overlap.
    // Edge-touch (planMax === rectMin) does NOT separate, matching getIds-
    // IntersectingRect's inclusive-on-edge-touch behavior: a marquee that just
    // grazes an edge still selects.
    if (planMax < rectMin || rectMax < planMin) return false;
  }

  return true;
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
