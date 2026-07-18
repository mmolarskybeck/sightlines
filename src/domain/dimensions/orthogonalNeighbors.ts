// Pure derivation: the document-page dimension pass for one elevation
// (docs/export-spec.md §9.6). The canvas's GroupDimensionLines is selection-
// driven and one-dimensional; a document has no selection and its reader asks
// "where does everything go?", so this derives a two-axis orthogonal
// visibility-neighbor graph over the wall's rendered footprints. No row/salon
// classification and no guessed lane grouping — one unified rule (§9.6).
//
// The engine is deliberately generic over axis-aligned footprints, NOT over
// ElevationScene, so it can be unit-tested without scene fixtures and reused by
// any caller. elevationDimensions.ts adapts an ElevationScene into this input.
//
// Coordinate convention (documented once, used throughout): wall-local space,
// y-UP from the floor and x-right from the wall start (docs/plan.md §2), with
// each rect given by its MIN corner (left/bottom) plus width/height. This is
// NOT SVG y-down space; center height reads directly as bottom + height/2 and
// the floor is y = 0. A renderer flips to SVG via wallLocalYToSvgY as needed.

export type ParticipantKind = "artwork" | "door" | "window" | "blocked-zone";

export type ParticipantRect = {
  // Min corner (left, bottom) in wall-local y-up space, plus extent.
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

export type DimensionParticipant = {
  id: string;
  kind: ParticipantKind;
  rect: ParticipantRect;
};

export type DimensionInput = {
  wallLengthMm: number;
  wallHeightMm: number;
  participants: DimensionParticipant[];
  // Defaults to NEIGHBOR_TOLERANCE_MM. Spans overlapping by <= this are not
  // neighbors; gaps within this read 0; corridors at or below this are slivers.
  toleranceMm?: number;
  // Default true: prune the visibility graph to each participant's nearest
  // gap per axis direction and suppress wall margins made redundant by a
  // kept neighbor (see selectNearestNeighborGaps). False returns the full
  // §9.6 visibility graph and every exposed boundary margin.
  nearestNeighborsOnly?: boolean;
};

export type DimensionAxis = "horizontal" | "vertical";

// Sentinels for the wall's left/right boundaries acting as virtual horizontal
// neighbors (§9.6). Boundary margins carry them via BoundaryDimension.side, so
// these never appear as participant ids and cannot collide with real ids.
export const WALL_LEFT_SENTINEL = "wall:left" as const;
export const WALL_RIGHT_SENTINEL = "wall:right" as const;

export type GapDimension = {
  axis: DimensionAxis;
  // Unordered pair, ids sorted lexically so a pair is emitted once per axis.
  aId: string;
  bId: string;
  // >= 0. 0 = touching within tolerance; overlapping pairs emit no GapDimension
  // (§9.6: overlap is an in-app advisory, not a negative distance to print).
  gapMm: number;
  // Facing-edge coordinates along the gap's own axis (horizontal -> x values,
  // vertical -> y values). The renderer draws end ticks here; fromMm <= toMm.
  fromMm: number;
  toMm: number;
  // The widest clear corridor's perpendicular span — where the dimension line
  // sits (horizontal gap -> a y-interval, vertical gap -> an x-interval).
  corridorLoMm: number;
  corridorHiMm: number;
};

export type BoundaryDimension = {
  side: "left" | "right";
  // > 1 when coincident exterior margins consolidate (§9.6: equal margins are
  // unambiguous). Ids sorted lexically.
  participantIds: string[];
  gapMm: number;
  // Wall edge -> facing edge, along x. fromMm <= toMm.
  fromMm: number;
  toMm: number;
  // Perpendicular (y) span for line placement; the widest member's corridor.
  corridorLoMm: number;
  corridorHiMm: number;
};

export type CenterHeightDimension = {
  // > 1 when several works share a center height -> one common centerline datum
  // (§9.6). Ids sorted lexically.
  participantIds: string[];
  centerHeightMm: number;
  common: boolean;
};

export type ElevationDimensions = {
  overallWidthMm: number;
  overallHeightMm: number;
  neighborGaps: GapDimension[];
  boundaryGaps: BoundaryDimension[];
  centerHeights: CenterHeightDimension[];
};

// Shared geometry tolerance. Mirrors GroupDimensionLines' MIN_SEGMENT_MM (the
// "0" touching readout threshold) and arrangeOnWall's MIXED_EPSILON_MM — the
// app's established sub-millimeter slop for elevation spacing. Not a new magic
// number; kept in sync with those so a nudge that reads as "touching" on the
// canvas reads the same here.
export const NEIGHBOR_TOLERANCE_MM = 0.5;

type Bounds = {
  loA: number; // primary-axis min (left / bottom)
  hiA: number; // primary-axis max (right / top)
  loP: number; // perpendicular-axis min
  hiP: number; // perpendicular-axis max
};

// Project a rect onto (primary, perpendicular) axes for the requested gap axis.
// Horizontal gaps measure along x (perp = y); vertical gaps measure along y
// (perp = x). Everything downstream is axis-agnostic once projected.
function project(rect: ParticipantRect, axis: DimensionAxis): Bounds {
  if (axis === "horizontal") {
    return {
      loA: rect.xMm,
      hiA: rect.xMm + rect.widthMm,
      loP: rect.yMm,
      hiP: rect.yMm + rect.heightMm
    };
  }
  return {
    loA: rect.yMm,
    hiA: rect.yMm + rect.heightMm,
    loP: rect.xMm,
    hiP: rect.xMm + rect.widthMm
  };
}

// Subtract blocked sub-intervals from [lo, hi], returning the remaining clear
// intervals left-to-right. The corridor primitive behind every neighbor test.
function subtractIntervals(
  lo: number,
  hi: number,
  blocked: Array<[number, number]>
): Array<[number, number]> {
  const clipped = blocked
    .map(([s, e]): [number, number] => [Math.max(lo, s), Math.min(hi, e)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const clear: Array<[number, number]> = [];
  let cursor = lo;
  for (const [s, e] of clipped) {
    if (s > cursor) clear.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < hi) clear.push([cursor, hi]);
  return clear;
}

function widest(intervals: Array<[number, number]>): [number, number] | null {
  let best: [number, number] | null = null;
  for (const interval of intervals) {
    if (!best || interval[1] - interval[0] > best[1] - best[0]) best = interval;
  }
  return best;
}

type CorridorResult = {
  gapMm: number;
  fromMm: number;
  toMm: number;
  corridorLoMm: number;
  corridorHiMm: number;
};

// The one corridor computation shared by object pairs and wall boundaries. A
// horizontal line (in projected space) connects the facing edges [fromA, toA]
// through the shared perpendicular span [pLo, pHi]; each blocker removes the
// perpendicular band it covers WHERE it also intrudes into the gap corridor.
// Returns the widest surviving corridor, or null when every corridor is blocked
// or a sliver (<= tolerance).
function corridorBetween(
  fromA: number,
  toA: number,
  pLo: number,
  pHi: number,
  blockers: Bounds[],
  tol: number
): CorridorResult | null {
  if (pHi - pLo <= tol) return null; // perpendicular spans barely overlap
  // True overlap along the primary axis is never a gap dimension (§9.6:
  // overlap is an in-app advisory, not a negative distance to print). Guarded
  // here so wall-boundary margins reject an out-of-bounds work the same way
  // pairGap rejects an overlapping pair.
  if (toA - fromA < -tol) return null;

  const blocked: Array<[number, number]> = [];
  for (const c of blockers) {
    // C obstructs the corridor only where it genuinely intrudes into the open
    // gap (> tol) — a hairline touch at the gap edge does not block, keeping
    // the relationship stable under sub-millimeter nudges.
    const intrude = Math.min(toA, c.hiA) - Math.max(fromA, c.loA);
    if (intrude <= tol) continue;
    const bandLo = Math.max(pLo, c.loP);
    const bandHi = Math.min(pHi, c.hiP);
    if (bandHi > bandLo) blocked.push([bandLo, bandHi]);
  }

  const corridor = widest(subtractIntervals(pLo, pHi, blocked));
  if (!corridor || corridor[1] - corridor[0] <= tol) return null;

  // Touching within tolerance reads a clean 0 (§9.6), matching the canvas's
  // MIN_SEGMENT_MM "0" readout; larger separations keep their true value.
  const rawGap = toA - fromA;
  return {
    gapMm: rawGap <= tol ? 0 : rawGap,
    // Touching within tolerance still ticks the facing edges; normalize any
    // tiny overlap-slop so fromMm <= toMm always holds for the renderer.
    fromMm: Math.min(fromA, toA),
    toMm: Math.max(fromA, toA),
    corridorLoMm: corridor[0],
    corridorHiMm: corridor[1]
  };
}

// A neighbor gap for one unordered pair on one axis, or null when they are not
// neighbors on it (spans miss, they overlap, or every corridor is blocked).
function pairGap(
  a: DimensionParticipant,
  b: DimensionParticipant,
  others: DimensionParticipant[],
  axis: DimensionAxis,
  tol: number
): GapDimension | null {
  const ba = project(a.rect, axis);
  const bb = project(b.rect, axis);

  const pLo = Math.max(ba.loP, bb.loP);
  const pHi = Math.min(ba.hiP, bb.hiP);
  if (pHi - pLo <= tol) return null; // perpendicular spans don't overlap enough

  // Order along the primary axis by facing edges. gapAB assumes A is lower; the
  // larger of the two signed gaps is the real separation (both negative only
  // when the primary ranges overlap, i.e. a true 2-D overlap).
  const gapAB = bb.loA - ba.hiA;
  const gapBA = ba.loA - bb.hiA;
  const aIsLower = gapAB >= gapBA;
  const gap = aIsLower ? gapAB : gapBA;
  if (gap < -tol) return null; // overlapping objects get no gap dimension

  const fromA = aIsLower ? ba.hiA : bb.hiA;
  const toA = aIsLower ? bb.loA : ba.loA;

  const blockers = others.map((o) => project(o.rect, axis));
  const corridor = corridorBetween(fromA, toA, pLo, pHi, blockers, tol);
  if (!corridor) return null;

  const [aId, bId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  return {
    axis,
    aId,
    bId,
    gapMm: corridor.gapMm,
    fromMm: corridor.fromMm,
    toMm: corridor.toMm,
    corridorLoMm: corridor.corridorLoMm,
    corridorHiMm: corridor.corridorHiMm
  };
}

// Left/right wall boundary as a virtual horizontal neighbor for one exposed
// work. The boundary spans the full wall height, so the shared perpendicular
// span is the work's own y-span; other participants act as blockers.
function boundaryGap(
  work: DimensionParticipant,
  side: "left" | "right",
  wallLengthMm: number,
  others: DimensionParticipant[],
  tol: number
): BoundaryDimension | null {
  const wb = project(work.rect, "horizontal");
  const fromA = side === "left" ? 0 : wb.hiA;
  const toA = side === "left" ? wb.loA : wallLengthMm;

  const blockers = others.map((o) => project(o.rect, "horizontal"));
  const corridor = corridorBetween(fromA, toA, wb.loP, wb.hiP, blockers, tol);
  if (!corridor) return null;

  return {
    side,
    participantIds: [work.id],
    gapMm: corridor.gapMm,
    fromMm: corridor.fromMm,
    toMm: corridor.toMm,
    corridorLoMm: corridor.corridorLoMm,
    corridorHiMm: corridor.corridorHiMm
  };
}

// Consolidate exterior margins that share a side and an equal gap into one
// dimension (§9.6: coincident exterior dimensions may consolidate when
// unambiguous — equal margins are the unambiguous case). Ids and corridor come
// from the members; the corridor is the widest member's for line placement.
function consolidateBoundary(gaps: BoundaryDimension[], tol: number): BoundaryDimension[] {
  const buckets = new Map<string, BoundaryDimension[]>();
  for (const gap of gaps) {
    const key = `${gap.side}:${Math.round(gap.gapMm / tol)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(gap);
    else buckets.set(key, [gap]);
  }

  const result: BoundaryDimension[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      result.push(bucket[0]);
      continue;
    }
    const widestMember = bucket.reduce((best, g) =>
      g.corridorHiMm - g.corridorLoMm > best.corridorHiMm - best.corridorLoMm ? g : best
    );
    result.push({
      side: bucket[0].side,
      participantIds: bucket.map((g) => g.participantIds[0]).sort(),
      gapMm: bucket[0].gapMm,
      fromMm: bucket[0].fromMm,
      toMm: bucket[0].toMm,
      corridorLoMm: widestMember.corridorLoMm,
      corridorHiMm: widestMember.corridorHiMm
    });
  }
  return result;
}

// Center height from the floor for every work: one common datum per shared
// center height, individual datums otherwise (§9.6). Works within tolerance of
// each other's center height share a datum.
function centerHeights(
  works: DimensionParticipant[],
  tol: number
): CenterHeightDimension[] {
  const buckets = new Map<number, DimensionParticipant[]>();
  for (const work of works) {
    const center = work.rect.yMm + work.rect.heightMm / 2;
    const key = Math.round(center / tol);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(work);
    else buckets.set(key, [work]);
  }

  const result: CenterHeightDimension[] = [];
  for (const bucket of buckets.values()) {
    const centers = bucket.map((w) => w.rect.yMm + w.rect.heightMm / 2);
    const centerHeightMm = centers.reduce((sum, c) => sum + c, 0) / centers.length;
    result.push({
      participantIds: bucket.map((w) => w.id).sort(),
      centerHeightMm,
      common: bucket.length > 1
    });
  }
  return result;
}

// The visibility-neighbor graph alone still connects distant pairs whenever a
// thin clear band survives over or under the intervening row, which floods a
// dense hang with long-range dimensions nobody hangs from. The printed set
// keeps, for each participant and each axis direction, only its nearest gap
// (ties within tolerance all survive); a gap is kept when it is nearest for
// at least one of its two endpoints, so a tall work flanked by a stacked pair
// keeps the gap to each stacked member via that member's own nearest slot.
export function selectNearestNeighborGaps(
  participants: DimensionParticipant[],
  gaps: GapDimension[],
  toleranceMm = NEIGHBOR_TOLERANCE_MM
): GapDimension[] {
  const centers = new Map(
    participants.map((participant) => [
      participant.id,
      {
        x: participant.rect.xMm + participant.rect.widthMm / 2,
        y: participant.rect.yMm + participant.rect.heightMm / 2
      }
    ])
  );
  // "id:axis:side" -> smallest gap on that side of that participant, where
  // side is which direction the partner lies along the gap's axis.
  const slotFor = (gap: GapDimension, id: string): string | null => {
    const a = centers.get(gap.aId);
    const b = centers.get(gap.bId);
    if (!a || !b) return null;
    const axisA = gap.axis === "horizontal" ? a.x : a.y;
    const axisB = gap.axis === "horizontal" ? b.x : b.y;
    const idIsLower = (id === gap.aId) === (axisA <= axisB);
    return `${id}:${gap.axis}:${idIsLower ? "hi" : "lo"}`;
  };
  const best = new Map<string, number>();
  for (const gap of gaps) {
    for (const id of [gap.aId, gap.bId]) {
      const slot = slotFor(gap, id);
      if (!slot) continue;
      const current = best.get(slot);
      if (current === undefined || gap.gapMm < current) {
        best.set(slot, gap.gapMm);
      }
    }
  }
  return gaps.filter((gap) =>
    [gap.aId, gap.bId].some((id) => {
      const slot = slotFor(gap, id);
      return (
        slot !== null && gap.gapMm <= (best.get(slot) ?? Infinity) + toleranceMm
      );
    })
  );
}

// Vertical-axis slice of the §9.6 pass for the in-app canvas. The canvas's
// GroupDimensionLines stays one-dimensional along the wall; stacked works get
// their vertical spacing from this instead — the same corridor engine and
// nearest-neighbor pruning the document page uses, restricted to one axis so
// the caller pays nothing for boundaries or center heights it won't render.
export function deriveVerticalNeighborGaps(
  participants: DimensionParticipant[],
  toleranceMm = NEIGHBOR_TOLERANCE_MM
): GapDimension[] {
  const gaps: GapDimension[] = [];
  for (let i = 0; i < participants.length; i += 1) {
    for (let j = i + 1; j < participants.length; j += 1) {
      const others = participants.filter((_, k) => k !== i && k !== j);
      const gap = pairGap(participants[i], participants[j], others, "vertical", toleranceMm);
      if (gap) gaps.push(gap);
    }
  }
  return selectNearestNeighborGaps(participants, gaps, toleranceMm).sort(
    (x, y) => x.aId.localeCompare(y.aId) || x.bId.localeCompare(y.bId)
  );
}

export function deriveElevationDimensions(input: DimensionInput): ElevationDimensions {
  const tol = input.toleranceMm ?? NEIGHBOR_TOLERANCE_MM;
  const { participants, wallLengthMm, wallHeightMm } = input;

  const allGaps: GapDimension[] = [];
  for (let i = 0; i < participants.length; i += 1) {
    for (let j = i + 1; j < participants.length; j += 1) {
      const a = participants[i];
      const b = participants[j];
      const others = participants.filter((_, k) => k !== i && k !== j);
      for (const axis of ["horizontal", "vertical"] as const) {
        const gap = pairGap(a, b, others, axis, tol);
        if (gap) allGaps.push(gap);
      }
    }
  }
  const nearestOnly = input.nearestNeighborsOnly !== false;
  const neighborGaps = nearestOnly
    ? selectNearestNeighborGaps(participants, allGaps, tol)
    : allGaps;
  neighborGaps.sort(
    (x, y) =>
      x.axis.localeCompare(y.axis) ||
      x.aId.localeCompare(y.aId) ||
      x.bId.localeCompare(y.bId)
  );

  // Wall boundaries dimension exposed WORKS only (§9.6: "for works exposed
  // directly to them"). All kinds still act as blockers, so a door in front of
  // a work correctly suppresses that work's margin. Openings and blocked zones
  // sit flush to edges by nature and don't want their own exterior margins.
  const works = participants.filter((p) => p.kind === "artwork");
  // A work that keeps a printed neighbor gap on a side is already anchored
  // through the chain on that side; its wall margin there is redundant noise.
  // Boundary margins remain only where the chain has no partner — the outer
  // ends of a row, or a work nothing else faces on that side.
  const centersById = new Map(
    participants.map((p) => [p.id, p.rect.xMm + p.rect.widthMm / 2])
  );
  const hasNeighborOnSide = new Set<string>();
  for (const gap of nearestOnly ? neighborGaps : []) {
    if (gap.axis !== "horizontal") continue;
    const aCenter = centersById.get(gap.aId) ?? 0;
    const bCenter = centersById.get(gap.bId) ?? 0;
    const [lower, higher] =
      aCenter <= bCenter ? [gap.aId, gap.bId] : [gap.bId, gap.aId];
    hasNeighborOnSide.add(`${lower}:right`);
    hasNeighborOnSide.add(`${higher}:left`);
  }
  const rawBoundary: BoundaryDimension[] = [];
  for (const work of works) {
    const others = participants.filter((p) => p.id !== work.id);
    for (const side of ["left", "right"] as const) {
      if (hasNeighborOnSide.has(`${work.id}:${side}`)) continue;
      const gap = boundaryGap(work, side, wallLengthMm, others, tol);
      if (gap) rawBoundary.push(gap);
    }
  }
  const boundaryGaps = consolidateBoundary(rawBoundary, tol).sort(
    (x, y) => x.side.localeCompare(y.side) || x.participantIds[0].localeCompare(y.participantIds[0])
  );

  const heights = centerHeights(works, tol).sort(
    (x, y) =>
      x.centerHeightMm - y.centerHeightMm ||
      x.participantIds[0].localeCompare(y.participantIds[0])
  );

  return {
    overallWidthMm: wallLengthMm,
    overallHeightMm: wallHeightMm,
    neighborGaps,
    boundaryGaps,
    centerHeights: heights
  };
}
