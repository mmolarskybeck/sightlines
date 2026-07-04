import type { WallObjectBase } from "../project";
import { getGridSnapTargets } from "./gridSnapTargets";
import { resolveSnap, type Guide, type Point, type SnapTarget } from "./resolveSnap";

export type ArtworkSize = {
  widthMm: number;
  heightMm: number;
};

// The four snap-target families for elevation placement (docs/plan.md §2:
// centerline > neighbor-center > neighbor-edge > grid), built fresh from
// wall geometry and the current neighbor set on every call — never owned by
// the renderer, same discipline as getGridSnapTargets. Callers exclude the
// object actually being moved from `neighbors` before calling this; a moving
// object should never snap to itself. `neighbors` is typed at the
// WallObjectBase level (not ArtworkWallObject) so any wall object — artwork
// or an opening — can act as a snap neighbor for any other; only the shared
// center/size fields are ever read here.
export function getArtworkSnapTargets(args: {
  centerlineYMm: number;
  wallLengthMm: number;
  wallHeightMm: number;
  gridIntervalMm: number;
  neighbors: WallObjectBase[];
  movingSize: ArtworkSize;
}): SnapTarget[] {
  const { centerlineYMm, wallLengthMm, wallHeightMm, gridIntervalMm, neighbors, movingSize } =
    args;

  const targets: SnapTarget[] = [
    // The curatorial convention (docs/plan.md §5.5): a work's CENTER lands
    // on the centerline, not its top or bottom edge.
    {
      id: "centerline",
      kind: "centerline",
      axis: "y",
      point: { xMm: 0, yMm: centerlineYMm }
    }
  ];

  for (const neighbor of neighbors) {
    const neighborLeftMm = neighbor.xMm - neighbor.widthMm / 2;
    const neighborRightMm = neighbor.xMm + neighbor.widthMm / 2;
    const neighborTopMm = neighbor.yMm + neighbor.heightMm / 2;
    const neighborBottomMm = neighbor.yMm - neighbor.heightMm / 2;

    // Neighbor-center: align the moving artwork's center with the
    // neighbor's, one target per axis so a horizontal-only or
    // vertical-only alignment can each snap independently.
    targets.push({
      id: `neighbor-center:${neighbor.id}:x`,
      kind: "neighbor-center",
      axis: "x",
      point: { xMm: neighbor.xMm, yMm: 0 }
    });
    targets.push({
      id: `neighbor-center:${neighbor.id}:y`,
      kind: "neighbor-center",
      axis: "y",
      point: { xMm: 0, yMm: neighbor.yMm }
    });

    // Neighbor-edge: candidate CENTER positions for the moving artwork such
    // that its own edge lands flush against (left/right) or aligned with
    // (top/bottom) the neighbor's corresponding edge. These are centers,
    // not the edge coordinates themselves, since resolveSnap always snaps
    // the point being dragged — the artwork's center (docs/plan.md §2).
    targets.push({
      id: `neighbor-edge:${neighbor.id}:left`,
      kind: "neighbor-edge",
      axis: "x",
      point: { xMm: neighborLeftMm - movingSize.widthMm / 2, yMm: 0 }
    });
    targets.push({
      id: `neighbor-edge:${neighbor.id}:right`,
      kind: "neighbor-edge",
      axis: "x",
      point: { xMm: neighborRightMm + movingSize.widthMm / 2, yMm: 0 }
    });
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
// gates only the grid tier; centerline/neighbor targets are always active
// per docs/plan.md §5.5 ("Show grid"/"Snap to grid" are independent, but
// grid is still lowest priority and the only tier either preference
// touches).
export function resolveArtworkSnap(
  proposedCenterMm: Point,
  args: {
    centerlineYMm: number;
    wallLengthMm: number;
    wallHeightMm: number;
    gridIntervalMm: number;
    neighbors: WallObjectBase[];
    movingSize: ArtworkSize;
    snapToGrid: boolean;
    thresholdMm: number;
    previousSnapTargetId?: string;
  }
): { point: Point; activeGuides: Guide[]; snapTargetId?: string } {
  const allTargets = getArtworkSnapTargets({
    centerlineYMm: args.centerlineYMm,
    wallLengthMm: args.wallLengthMm,
    wallHeightMm: args.wallHeightMm,
    gridIntervalMm: args.gridIntervalMm,
    neighbors: args.neighbors,
    movingSize: args.movingSize
  });

  const candidates = args.snapToGrid
    ? allTargets
    : allTargets.filter((target) => target.kind !== "grid");

  return resolveSnap(proposedCenterMm, candidates, {
    thresholdMm: args.thresholdMm,
    previousSnapTargetId: args.previousSnapTargetId
  });
}
