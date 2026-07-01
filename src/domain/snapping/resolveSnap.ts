export type Point = {
  xMm: number;
  yMm: number;
};

export type SnapTarget = {
  id: string;
  point: Point;
  kind: "centerline" | "neighbor-center" | "neighbor-edge" | "grid";
  axis: "x" | "y" | "both";
};

export type Guide = {
  id: string;
  axis: "x" | "y";
  positionMm: number;
  targetId: string;
};

export type SnapOptions = {
  thresholdMm: number;
  breakFreeMultiplier?: number;
  previousSnapTargetId?: string;
};

const PRIORITY: Record<SnapTarget["kind"], number> = {
  centerline: 0,
  "neighbor-center": 1,
  "neighbor-edge": 2,
  grid: 3
};

export function resolveSnap(
  proposed: Point,
  candidates: SnapTarget[],
  opts: SnapOptions
): { point: Point; activeGuides: Guide[]; snapTargetId?: string } {
  const thresholdFor = (candidate: SnapTarget) =>
    candidate.id === opts.previousSnapTargetId
      ? opts.thresholdMm * (opts.breakFreeMultiplier ?? 1.5)
      : opts.thresholdMm;

  const eligible = candidates
    .map((candidate) => {
      const distance = distanceForAxis(proposed, candidate);
      return { candidate, distance };
    })
    .filter(({ candidate, distance }) => distance <= thresholdFor(candidate))
    .sort((a, b) => {
      const priorityDelta = PRIORITY[a.candidate.kind] - PRIORITY[b.candidate.kind];
      if (priorityDelta !== 0) return priorityDelta;

      const distanceDelta = a.distance - b.distance;
      if (distanceDelta !== 0) return distanceDelta;

      return a.candidate.id.localeCompare(b.candidate.id);
    });

  const best = eligible[0]?.candidate;

  if (!best) {
    return { point: proposed, activeGuides: [] };
  }

  const point = { ...proposed };
  const activeGuides: Guide[] = [];

  if (best.axis === "x" || best.axis === "both") {
    point.xMm = best.point.xMm;
    activeGuides.push({
      id: `${best.id}-x`,
      axis: "x",
      positionMm: best.point.xMm,
      targetId: best.id
    });
  }

  if (best.axis === "y" || best.axis === "both") {
    point.yMm = best.point.yMm;
    activeGuides.push({
      id: `${best.id}-y`,
      axis: "y",
      positionMm: best.point.yMm,
      targetId: best.id
    });
  }

  return { point, activeGuides, snapTargetId: best.id };
}

function distanceForAxis(proposed: Point, candidate: SnapTarget): number {
  if (candidate.axis === "x") {
    return Math.abs(proposed.xMm - candidate.point.xMm);
  }

  if (candidate.axis === "y") {
    return Math.abs(proposed.yMm - candidate.point.yMm);
  }

  return Math.hypot(
    proposed.xMm - candidate.point.xMm,
    proposed.yMm - candidate.point.yMm
  );
}
