import type { WallObject, WallObjectBase } from "../project";
import { getGridSnapTargets } from "./gridSnapTargets";
import {
  resolveSnap,
  type Guide,
  type Point,
  type SnapTarget,
  type SnapTargetIds
} from "./resolveSnap";

export type ArtworkSize = {
  widthMm: number;
  heightMm: number;
};

// The x-axis neighbor tiers (neighbor-center + neighbor-edge) for a set of
// neighbors, given the moving object's width. Extracted so plan snapping can
// build the SAME neighbor x-targets when a wall-anchored object is dragged
// along a wall in wall-local coordinates — there the wall's length runs along
// x and there is no y to align against, so only these x-targets apply. Elevation
// placement (getArtworkSnapTargets) composes this with the y counterparts.
// Neighbors are typed at WallObjectBase level so any wall object can act as a
// neighbor; only the shared center/size fields are read. Callers exclude the
// object actually being moved before calling.
export function getNeighborXSnapTargets(
  neighbors: WallObjectBase[],
  movingWidthMm: number
): SnapTarget[] {
  const targets: SnapTarget[] = [];

  for (const neighbor of neighbors) {
    const neighborLeftMm = neighbor.xMm - neighbor.widthMm / 2;
    const neighborRightMm = neighbor.xMm + neighbor.widthMm / 2;

    // Neighbor-center: align the moving object's center with the neighbor's.
    targets.push({
      id: `neighbor-center:${neighbor.id}:x`,
      kind: "neighbor-center",
      axis: "x",
      point: { xMm: neighbor.xMm, yMm: 0 }
    });

    // Neighbor-edge: candidate CENTER positions such that the moving object's
    // own edge lands flush against the neighbor's corresponding edge. These
    // are centers, not the edge coordinates themselves, since resolveSnap
    // always snaps the point being dragged — the object's center.
    targets.push({
      id: `neighbor-edge:${neighbor.id}:left`,
      kind: "neighbor-edge",
      axis: "x",
      point: { xMm: neighborLeftMm - movingWidthMm / 2, yMm: 0 }
    });
    targets.push({
      id: `neighbor-edge:${neighbor.id}:right`,
      kind: "neighbor-edge",
      axis: "x",
      point: { xMm: neighborRightMm + movingWidthMm / 2, yMm: 0 }
    });
  }

  return targets;
}

// The snap-target tiers for elevation placement (docs/plan.md §2), built
// fresh from wall geometry and the current neighbor set on every call —
// never owned by the renderer, same discipline as getGridSnapTargets.
// Callers exclude the object actually being moved from `neighbors` before
// calling this; a moving object should never snap to itself. `neighbors` is
// typed at the WallObjectBase level (not ArtworkWallObject) so any wall
// object — artwork or an opening — can act as a snap neighbor for any
// other; only the shared center/size fields are ever read here.
//
// Every moving kind gets a floor target (anything can settle onto the
// floor), but its RANK depends on `movingKind`: for a door the floor is the
// primary tier (above the centerline — doors are expected to sit on the
// floor); for artwork/windows/blocked zones the eyeline comes first and the
// floor slots directly below it, above the neighbor and grid tiers. So the
// per-axis ordering reads: [floor first for doors] > centerline > floor >
// neighbor-center > neighbor-edge > grid.
export function getArtworkSnapTargets(args: {
  centerlineYMm: number;
  wallLengthMm: number;
  wallHeightMm: number;
  gridIntervalMm: number;
  neighbors: WallObjectBase[];
  movingSize: ArtworkSize;
  movingKind?: WallObject["kind"];
}): SnapTarget[] {
  const {
    centerlineYMm,
    wallLengthMm,
    wallHeightMm,
    gridIntervalMm,
    neighbors,
    movingSize,
    movingKind
  } = args;

  const targets: SnapTarget[] = [
    // The center-y that puts the moving object's bottom edge on the floor
    // line (wall-local y=0, y up). Emitted for every kind, but ranked
    // per-kind via the explicit priority: a door's primary target (0, above
    // the centerline's 1); for everything else just below the centerline
    // (1.5) and above the neighbor tiers.
    {
      id: "floor",
      kind: "floor",
      axis: "y",
      priority: movingKind === "door" ? 0 : 1.5,
      point: { xMm: 0, yMm: movingSize.heightMm / 2 }
    },
    // The curatorial convention (docs/plan.md §5.5): a work's CENTER lands
    // on the centerline, not its top or bottom edge.
    {
      id: "centerline",
      kind: "centerline",
      axis: "y",
      point: { xMm: 0, yMm: centerlineYMm }
    }
  ];

  // The x-axis neighbor tiers, shared verbatim with plan snapping's wall-local
  // resolve via getNeighborXSnapTargets.
  targets.push(...getNeighborXSnapTargets(neighbors, movingSize.widthMm));

  // The y-axis neighbor tiers stay elevation-specific: there is no vertical
  // alignment when dragging along a wall in plan, so plan snapping never needs
  // these. One target per axis so a horizontal-only or vertical-only alignment
  // can each snap independently.
  for (const neighbor of neighbors) {
    const neighborTopMm = neighbor.yMm + neighbor.heightMm / 2;
    const neighborBottomMm = neighbor.yMm - neighbor.heightMm / 2;

    // Neighbor-center on y: align the moving artwork's center with the neighbor's.
    targets.push({
      id: `neighbor-center:${neighbor.id}:y`,
      kind: "neighbor-center",
      axis: "y",
      point: { xMm: 0, yMm: neighbor.yMm }
    });

    // Neighbor-edge on y: candidate CENTER positions such that the moving
    // artwork's top/bottom edge aligns with the neighbor's (docs/plan.md §2).
    targets.push({
      id: `neighbor-edge:${neighbor.id}:top`,
      kind: "neighbor-edge",
      axis: "y",
      point: { xMm: 0, yMm: neighborTopMm - movingSize.heightMm / 2 }
    });
    targets.push({
      id: `neighbor-edge:${neighbor.id}:bottom`,
      kind: "neighbor-edge",
      axis: "y",
      point: { xMm: 0, yMm: neighborBottomMm + movingSize.heightMm / 2 }
    });
  }

  const gridTargets = getGridSnapTargets(gridIntervalMm, {
    minXMm: 0,
    maxXMm: wallLengthMm,
    minYMm: 0,
    maxYMm: wallHeightMm
  });

  return [...targets, ...gridTargets];
}

// Single call site composing getArtworkSnapTargets + resolveSnap so the
// HTML5 drop-ghost preview and the pointer-drag move preview in
// ElevationView can never disagree about where an artwork would land — both
// call this exact function with the same arguments shape. `snapToGrid`
// gates only the grid tier; the floor (doors), centerline, and neighbor
// targets are always active per docs/plan.md §5.5 ("Show grid"/"Snap to
// grid" are independent, but grid is still lowest priority and the only
// tier either preference touches).
export function resolveArtworkSnap(
  proposedCenterMm: Point,
  args: {
    centerlineYMm: number;
    wallLengthMm: number;
    wallHeightMm: number;
    gridIntervalMm: number;
    neighbors: WallObjectBase[];
    movingSize: ArtworkSize;
    movingKind?: WallObject["kind"];
    snapToGrid: boolean;
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
  }
): { point: Point; activeGuides: Guide[]; snapTargetIds: SnapTargetIds } {
  const allTargets = getArtworkSnapTargets({
    centerlineYMm: args.centerlineYMm,
    wallLengthMm: args.wallLengthMm,
    wallHeightMm: args.wallHeightMm,
    gridIntervalMm: args.gridIntervalMm,
    neighbors: args.neighbors,
    movingSize: args.movingSize,
    movingKind: args.movingKind
  });

  const candidates = args.snapToGrid
    ? allTargets
    : allTargets.filter((target) => target.kind !== "grid");

  return resolveSnap(proposedCenterMm, candidates, {
    thresholdMm: args.thresholdMm,
    previousSnapTargetIds: args.previousSnapTargetIds
  });
}
