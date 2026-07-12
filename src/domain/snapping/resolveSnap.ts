export type Point = {
  xMm: number;
  yMm: number;
};

export type SnapTarget = {
  id: string;
  point: Point;
  kind: "floor" | "centerline" | "neighbor-center" | "neighbor-edge" | "grid";
  axis: "x" | "y" | "both";
  // Optional explicit rank overriding the kind's default (lower wins). Used
  // by the floor target, whose rank depends on what is being moved: primary
  // (0, above centerline) for a door, just below the centerline for
  // everything else — a static per-kind map can't express that.
  priority?: number;
};

export type Guide = {
  id: string;
  axis: "x" | "y";
  positionMm: number;
  targetId: string;
  // Optional segment extent ALONG the guide's length (for a vertical x-guide
  // this is the y range; for a horizontal y-guide the x range). When set, the
  // overlay draws the guide as a bounded segment over [startMm, endMm] instead
  // of a full-viewBox line — used to clip a partition drag's guides to the
  // containing room. Producers that leave it undefined keep full-viewport
  // rendering; resolveSnap itself never sets it (the drag stamps it afterward).
  extentMm?: { startMm: number; endMm: number };
};

// The ids of the targets that won each axis on a previous resolve, so the
// break-free hysteresis can be tracked per axis: an artwork held on the
// centerline in y must not lose (or leak) its stickiness through whatever
// grid line the x axis happens to be snapped to at the same time.
export type SnapTargetIds = {
  x?: string;
  y?: string;
};

export type SnapOptions = {
  thresholdMm: number;
  breakFreeMultiplier?: number;
  previousSnapTargetIds?: SnapTargetIds;
};

// Default tier ranks per kind (lower wins). The floor default sits between
// the centerline (1) and neighbor-center (2): every wall object can settle
// onto the floor, but for most of them the eyeline comes first. Door drags
// override the floor target's rank to 0 via SnapTarget.priority — for a
// door the floor IS the primary destination (see getArtworkSnapTargets).
const KIND_PRIORITY: Record<SnapTarget["kind"], number> = {
  centerline: 1,
  floor: 1.5,
  "neighbor-center": 2,
  "neighbor-edge": 3,
  grid: 4
};

function priorityOf(target: SnapTarget): number {
  return target.priority ?? KIND_PRIORITY[target.kind];
}

// Resolves each axis INDEPENDENTLY: the x winner and the y winner are picked
// from separate per-axis candidate pools, so a high-priority y-only target
// (the centerline) never suppresses an x snap (a grid line) — an artwork can
// sit on the eyeline and land on the grid at the same time. Within one axis
// the tier ordering is: [floor first for doors] > centerline > floor >
// neighbor-center > neighbor-edge > grid (docs/plan.md §2), then distance,
// then id for a stable tiebreak. An `axis: "both"` target competes on each
// axis using that axis's own delta and may win either or both.
export function resolveSnap(
  proposed: Point,
  candidates: SnapTarget[],
  opts: SnapOptions
): { point: Point; activeGuides: Guide[]; snapTargetIds: SnapTargetIds } {
  const point = { ...proposed };
  const activeGuides: Guide[] = [];
  const snapTargetIds: SnapTargetIds = {};

  for (const axis of ["x", "y"] as const) {
    const previousId = opts.previousSnapTargetIds?.[axis];
    const thresholdFor = (candidate: SnapTarget) =>
      candidate.id === previousId
        ? opts.thresholdMm * (opts.breakFreeMultiplier ?? 1.5)
        : opts.thresholdMm;

    const eligible = candidates
      .filter((candidate) => candidate.axis === axis || candidate.axis === "both")
      .map((candidate) => ({ candidate, distance: distanceForAxis(proposed, candidate, axis) }))
      .filter(({ candidate, distance }) => distance <= thresholdFor(candidate))
      .sort((a, b) => {
        const priorityDelta = priorityOf(a.candidate) - priorityOf(b.candidate);
        if (priorityDelta !== 0) return priorityDelta;

        const distanceDelta = a.distance - b.distance;
        if (distanceDelta !== 0) return distanceDelta;

        return a.candidate.id.localeCompare(b.candidate.id);
      });

    const best = eligible[0]?.candidate;
    if (!best) continue;

    const positionMm = axis === "x" ? best.point.xMm : best.point.yMm;
    if (axis === "x") {
      point.xMm = positionMm;
    } else {
      point.yMm = positionMm;
    }

    activeGuides.push({
      id: `${best.id}-${axis}`,
      axis,
      positionMm,
      targetId: best.id
    });
    snapTargetIds[axis] = best.id;
  }

  return { point, activeGuides, snapTargetIds };
}

// The candidate's distance from the proposed point ALONG the axis being
// resolved — an `axis: "both"` target evaluated for the x pool competes on
// its x delta alone (and likewise for y), never the hypot, since each axis's
// pool is ranked and applied independently.
function distanceForAxis(
  proposed: Point,
  candidate: SnapTarget,
  axis: "x" | "y"
): number {
  return axis === "x"
    ? Math.abs(proposed.xMm - candidate.point.xMm)
    : Math.abs(proposed.yMm - candidate.point.yMm);
}
