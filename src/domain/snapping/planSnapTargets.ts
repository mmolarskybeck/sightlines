import type { WallObject, WallObjectBase } from "../project";
import {
  getWallObjectPlanRect,
  projectPointToWall,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type FloorWall,
  type PlanRect
} from "../geometry/planObjects";
import { getNeighborXSnapTargets } from "./artworkSnapTargets";
import {
  resolveSnap,
  type Guide,
  type Point,
  type SnapTarget,
  type SnapTargetIds
} from "./resolveSnap";

// Pixel radius (screen space) within which a plan drag captures onto a wall.
// Lives here as the canonical default so PlanView imports it and converts
// px→mm with the live zoom before calling resolvePlanPlacement — the domain
// only ever deals in mm.
export const WALL_CAPTURE_PX = 24;

// Mirrors resolveSnap's breakFreeMultiplier default: the wall an object is
// currently anchored to gets 1.5× the capture radius so plan drags don't
// flicker between wall and floor at the boundary.
const WALL_BREAK_FREE_MULTIPLIER = 1.5;

// A committed plan placement. `wall` means the object is anchored to a wall
// with its center at xMm along that wall (wall-local, distance from start);
// `floor` means a free floor-space center. Callers persist exactly this.
export type PlanPlacement =
  | { anchor: "wall"; wallId: string; xMm: number }
  | { anchor: "floor"; xMm: number; yMm: number };

export type PlanPlacementResult = {
  placement: PlanPlacement;
  // Ready-to-render preview geometry, so preview and commit agree.
  planRect: PlanRect;
  // Hysteresis state the caller threads back in via previousSnapTargetIds.
  snapTargetIds: SnapTargetIds;
  // Floor-space guides; always [] for wall placements (see below).
  activeGuides: Guide[];
};

export type PlanMovingSize = {
  widthMm: number;
  heightMm: number;
  depthMm: number;
};

// THE single composed entry point for every plan-view placement — move drag,
// click-to-place ghost, artwork drop ghost — so the preview a user sees and
// the value that gets committed can never disagree, the same discipline as
// resolveArtworkSnap. Two stages: try to capture onto a wall (with per-object
// cross-boundary hysteresis); if nothing captures and the object can float,
// resolve a free floor-space center against the grid.
export function resolvePlanPlacement(
  proposedCenterFloorMm: Point,
  args: {
    walls: FloorWall[];
    // ALL wall objects across all walls; the moving object is already excluded
    // by the caller. Filtered to the captured wall for neighbor targets.
    wallObjects: WallObjectBase[];
    movingSize: PlanMovingSize;
    movingKind: WallObject["kind"];
    // artwork | blocked-zone → true; door | window → false.
    canFloat: boolean;
    // The wall the object is currently anchored to, for the wider break-free
    // capture radius; null when it isn't currently on any wall.
    currentAnchorWallId: string | null;
    captureDistanceMm: number;
    // Floor-space grid targets from getGridSnapTargets; only consulted when
    // snapToGrid and the object is floating.
    gridTargets: SnapTarget[];
    snapToGrid: boolean;
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
    // The object's live rotation, passed through to a floor placement's rect so
    // the preview matches the rendered object (wall placements take the wall's
    // angle instead). Defaults to 0 for fresh placements.
    rotationDeg?: number;
  }
): PlanPlacementResult {
  const capturedWall = captureWall(
    proposedCenterFloorMm,
    args.walls,
    args.captureDistanceMm,
    args.canFloat,
    args.currentAnchorWallId
  );

  if (capturedWall) {
    return resolveOnWall(proposedCenterFloorMm, capturedWall, args);
  }

  // Floor stage. Reached when nothing captured: either the object can float
  // and is far from every wall, or (invariant break, e.g. a room with no
  // walls) there was no wall to capture at all. In the latter case we fall
  // back to a floor placement even for doors/windows rather than crash —
  // rooms always have walls in practice, so canFloat === false here only ever
  // means "no walls exist."
  return resolveOnFloor(proposedCenterFloorMm, args);
}

// Nearest wall the object should capture onto, or null to fall through to the
// floor stage. Each wall carries its own effective radius: the current anchor
// wall gets the wider break-free radius (so it stays sticky), every other wall
// gets the base radius (so re-anchoring only happens once a wall is genuinely
// close). Doors/windows (canFloat false) capture the globally nearest wall at
// any distance — they never float.
function captureWall(
  pointMm: Point,
  walls: FloorWall[],
  captureDistanceMm: number,
  canFloat: boolean,
  currentAnchorWallId: string | null
) {
  let best: { wall: FloorWall; xAlongMm: number; distanceMm: number } | null = null;

  for (const wall of walls) {
    const projection = projectPointToWall(pointMm, wall);
    const radius = canFloat
      ? wall.id === currentAnchorWallId
        ? captureDistanceMm * WALL_BREAK_FREE_MULTIPLIER
        : captureDistanceMm
      : Infinity;

    if (projection.distanceMm > radius) continue;

    if (
      !best ||
      projection.distanceMm < best.distanceMm ||
      (projection.distanceMm === best.distanceMm && wall.id.localeCompare(best.wall.id) < 0)
    ) {
      best = { wall, xAlongMm: projection.xAlongMm, distanceMm: projection.distanceMm };
    }
  }

  return best;
}

function resolveOnWall(
  proposedCenterFloorMm: Point,
  captured: { wall: FloorWall; xAlongMm: number },
  args: {
    wallObjects: WallObjectBase[];
    movingSize: PlanMovingSize;
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
  }
): PlanPlacementResult {
  const wall = captured.wall;
  const { widthMm } = args.movingSize;

  // Neighbor targets are wall-local x only: objects on this wall, positioned by
  // their own xMm-along-the-wall. No grid tier along the wall (floor grid is
  // meaningless projected onto an angled wall) and no y candidates.
  const neighbors = args.wallObjects.filter((object) => object.wallId === wall.id);
  const candidates = getNeighborXSnapTargets(neighbors, widthMm);

  const resolved = resolveSnap(
    { xMm: captured.xAlongMm, yMm: 0 },
    candidates,
    {
      thresholdMm: args.thresholdMm,
      previousSnapTargetIds: args.previousSnapTargetIds
    }
  );

  // Clamp the object's center so its full width stays on the wall; if the wall
  // is shorter than the object there's no valid range, so center it.
  const minXMm = widthMm / 2;
  const maxXMm = wall.lengthMm - widthMm / 2;
  const xMm = maxXMm < minXMm ? wall.lengthMm / 2 : clamp(resolved.point.xMm, minXMm, maxXMm);

  return {
    placement: { anchor: "wall", wallId: wall.id, xMm },
    planRect: getWallObjectPlanRect(wall, { xMm, widthMm }, WALL_OBJECT_PLAN_DEPTH_MM),
    snapTargetIds: resolved.snapTargetIds,
    // Wall-local guides are omitted in v1: the resolve above ran in wall-local
    // coordinates, so its guides are in the wrong space to draw over the
    // floor-space plan. Emitting them would misplace the guide lines.
    activeGuides: []
  };
}

function resolveOnFloor(
  proposedCenterFloorMm: Point,
  args: {
    movingSize: PlanMovingSize;
    gridTargets: SnapTarget[];
    snapToGrid: boolean;
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
    rotationDeg?: number;
  }
): PlanPlacementResult {
  // Grid is the only floor tier and is preference-gated; with snap off there
  // are no candidates and the proposed center passes through unchanged.
  const candidates = args.snapToGrid ? args.gridTargets : [];

  const resolved = resolveSnap(proposedCenterFloorMm, candidates, {
    thresholdMm: args.thresholdMm,
    previousSnapTargetIds: args.previousSnapTargetIds
  });

  const centerXMm = resolved.point.xMm;
  const centerYMm = resolved.point.yMm;

  return {
    placement: { anchor: "floor", xMm: centerXMm, yMm: centerYMm },
    planRect: {
      centerXMm,
      centerYMm,
      widthMm: args.movingSize.widthMm,
      depthMm: args.movingSize.depthMm,
      angleDeg: args.rotationDeg ?? 0
    },
    snapTargetIds: resolved.snapTargetIds,
    // These guides ARE floor-space (the resolve ran on the floor-space center),
    // so they're correct to draw over the plan.
    activeGuides: resolved.activeGuides
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
