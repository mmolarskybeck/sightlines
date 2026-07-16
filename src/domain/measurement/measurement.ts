export type MeasurePoint = {
  xMm: number;
  yMm: number;
};

// Candidate kinds mirror the product priority families. A candidate is always
// one coherent 2-D point; edge and line generators project onto their source
// before handing the candidate to the resolver.
export type MeasurePointCandidateKind =
  | "vertex"
  | "edge"
  | "center"
  | "datum"
  | "grid";

export type MeasurePointCandidate = {
  id: string;
  kind: MeasurePointCandidateKind;
  point: MeasurePoint;
  // Lower wins. Generators may override a family's default when two visible
  // semantic sources need a more specific ordering.
  priority?: number;
};

export type MeasurePointSource = Omit<MeasurePointCandidate, "point"> & {
  point: MeasurePoint;
};

export type MeasureSegmentSource = {
  id: string;
  kind: "edge" | "datum";
  start: MeasurePoint;
  end: MeasurePoint;
  priority?: number;
};

export type MeasureCandidateSources = {
  points?: readonly MeasurePointSource[];
  segments?: readonly MeasureSegmentSource[];
};

export type ResolveMeasurePointOptions = {
  thresholdMm: number;
  previousTargetId?: string;
  breakFreeMultiplier?: number;
};

export type ResolvedMeasurePoint = {
  point: MeasurePoint;
  target: MeasurePointCandidate | null;
  snapped: boolean;
};

const KIND_PRIORITY: Record<MeasurePointCandidateKind, number> = {
  vertex: 1,
  edge: 2,
  center: 3,
  datum: 4,
  grid: 5
};

function priorityOf(candidate: MeasurePointCandidate): number {
  return candidate.priority ?? KIND_PRIORITY[candidate.kind];
}

function distanceBetween(a: MeasurePoint, b: MeasurePoint): number {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

// Unlike placement snapping, measurement snapping resolves one complete point.
// It can therefore never combine the x coordinate of one semantic feature with
// the y coordinate of another.
export function resolveMeasurePoint(
  proposed: MeasurePoint,
  candidates: readonly MeasurePointCandidate[],
  options: ResolveMeasurePointOptions
): ResolvedMeasurePoint {
  const breakFreeMultiplier = Math.max(options.breakFreeMultiplier ?? 1.5, 1);

  // A held point remains authoritative until the pointer actually breaks free.
  // Without this explicit path, ordinary priority sorting lets a newly nearby
  // vertex steal an edge snap while the edge is still inside its hold radius.
  const held = options.previousTargetId
    ? candidates.find((candidate) => candidate.id === options.previousTargetId)
    : undefined;
  if (
    held &&
    distanceBetween(proposed, held.point) <= options.thresholdMm * breakFreeMultiplier
  ) {
    return { point: { ...held.point }, target: held, snapped: true };
  }

  const winner = candidates
    .map((candidate) => ({
      candidate,
      distance: distanceBetween(proposed, candidate.point)
    }))
    .filter(({ distance }) => distance <= options.thresholdMm)
    .sort((a, b) => {
      const priorityDelta = priorityOf(a.candidate) - priorityOf(b.candidate);
      if (priorityDelta !== 0) return priorityDelta;
      const distanceDelta = a.distance - b.distance;
      if (distanceDelta !== 0) return distanceDelta;
      return a.candidate.id.localeCompare(b.candidate.id);
    })[0]?.candidate;

  if (!winner) {
    return { point: { ...proposed }, target: null, snapped: false };
  }

  return { point: { ...winner.point }, target: winner, snapped: true };
}

// Closest point on a bounded segment. Clamping the projection parameter is
// load-bearing: measuring near a short edge must snap to its endpoint rather
// than to an imaginary continuation of that edge.
export function nearestPointOnMeasureSegment(
  proposed: MeasurePoint,
  start: MeasurePoint,
  end: MeasurePoint
): MeasurePoint {
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { ...start };

  const projection =
    ((proposed.xMm - start.xMm) * dx + (proposed.yMm - start.yMm) * dy) /
    lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  return { xMm: start.xMm + t * dx, yMm: start.yMm + t * dy };
}

// Converts visible semantic geometry into coherent 0-D candidates for one
// pointer position. Point sources pass through; bounded lines contribute their
// nearest finite projection. Reference measurements are intentionally not a
// source type and therefore cannot enter this candidate set accidentally.
export function buildMeasurePointCandidates(
  proposed: MeasurePoint,
  sources: MeasureCandidateSources
): MeasurePointCandidate[] {
  return [
    ...(sources.points ?? []).map((source) => ({
      id: source.id,
      kind: source.kind,
      point: { ...source.point },
      ...(source.priority !== undefined ? { priority: source.priority } : {})
    })),
    ...(sources.segments ?? []).map((source) => ({
      id: source.id,
      kind: source.kind,
      point: nearestPointOnMeasureSegment(proposed, source.start, source.end),
      ...(source.priority !== undefined ? { priority: source.priority } : {})
    }))
  ];
}

// Shift constraint for measurement creation/refinement. Constrain to the axis
// with the larger intended movement, retaining the proposed coordinate on that
// axis. Exact diagonals resolve horizontally for deterministic pointer output.
export function constrainMeasurePointToAxis(
  anchor: MeasurePoint,
  proposed: MeasurePoint
): MeasurePoint {
  const dx = proposed.xMm - anchor.xMm;
  const dy = proposed.yMm - anchor.yMm;
  return Math.abs(dx) >= Math.abs(dy)
    ? { xMm: proposed.xMm, yMm: anchor.yMm }
    : { xMm: anchor.xMm, yMm: proposed.yMm };
}
