import type { WallObjectBase } from "../project";
import type { ArtworkSize } from "./artworkSnapTargets";
import type { Point } from "./resolveSnap";

// "Clean-increment" quantization for wall-object positions. Where grid
// snapping (getGridSnapTargets) snaps an object's CENTER to a lattice — which
// puts the object's irregular EDGES, and therefore every gap / wall-distance
// dimension the curator actually reads, on messy fractions — this quantizer
// snaps the MEASUREMENTS instead. It nudges a proposed center so that at least
// one of the distances a dimension line reports (edge-to-wall or edge-to-
// neighbour) lands on a multiple of the working increment.
//
// Coordinates are wall-local: x runs 0..wallLengthMm from the wall start, y
// runs up from the floor at 0, and objects are CENTER xMm/yMm with widthMm/
// heightMm (the WallObjectBase convention). Both functions are pure, do NOT
// clamp to the wall (an out-of-bounds proposal quantizes normally), and return
// the proposed coordinate untouched for a degenerate increment (≤ 0 or non-
// finite). Group moves quantize the union bounding box as one virtual object
// (size = union size, position = union center) and the caller applies the
// resulting delta to every member — the same trick the elevation group
// snapping uses.

// Nearest value to `proposed` among `candidates`. Deterministic tie-break:
// smallest absolute distance wins; on an exact distance tie the smaller
// (more-negative / leftmost / lower) coordinate wins. `candidates` is never
// empty at the call sites below (the two wall-edge families always contribute).
function nearestCandidate(proposed: number, candidates: number[]): number {
  let best = candidates[0];
  let bestDistance = Math.abs(best - proposed);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const distance = Math.abs(candidate - proposed);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

// Nearest point of the ascending half-lattice { base + k·step : k ≥ 0 } to
// `proposed`. k is clamped to 0 so the underlying distance stays a NON-negative
// multiple of the increment (a proposal below `base` snaps to base itself).
function nearestAscending(proposed: number, base: number, step: number): number {
  const index = Math.max(0, Math.round((proposed - base) / step));
  return base + index * step;
}

// Nearest point of the descending half-lattice { base − k·step : k ≥ 0 }.
function nearestDescending(proposed: number, base: number, step: number): number {
  const index = Math.max(0, Math.round((base - proposed) / step));
  return base - index * step;
}

// Nearest member of the directed half-lattice
//   { base + direction * k * increment : k >= 0 }.
// Partition snapping uses this same clean-distance primitive for room-wall
// insets and partition-to-partition gaps. Callers validate the increment so a
// bad value cannot accidentally create a sticky target at the pointer.
export function nearestDirectedIncrement(
  proposed: number,
  base: number,
  direction: -1 | 1,
  incrementMm: number
): number {
  return direction === 1
    ? nearestAscending(proposed, base, incrementMm)
    : nearestDescending(proposed, base, incrementMm);
}

// Quantize a proposed CENTER x so one of the horizontal measurements a
// dimension line reports lands on a multiple of `incrementMm`. Four candidate
// families, each a half-lattice of period `incrementMm` (so its correction is
// always ≤ incrementMm/2):
//   (a) left-edge distance from the wall start  → center = width/2 + k·inc
//   (b) right-edge distance from the wall end   → center = (wallLength − width/2) − k·inc
//   (c) left-edge gap to the nearest neighbour on the left  (its right edge)
//   (d) right-edge gap to the nearest neighbour on the right (its left edge)
// The candidate nearest the proposal wins. Neighbours qualify only when their
// vertical extent overlaps the moving object's band at the proposed y (same
// spirit as getNeighborAwareSegments' y-band rule), and "nearest on the
// left/right" is measured against the proposed CENTER x — a deterministic
// divider that doesn't shift as the object's own edges move.
export function quantizeXToCleanIncrement(
  proposed: Point,
  size: ArtworkSize,
  incrementMm: number,
  wallLengthMm: number,
  neighbors: WallObjectBase[]
): number {
  if (!Number.isFinite(incrementMm) || incrementMm <= 0) return proposed.xMm;

  const proposedXMm = proposed.xMm;
  const halfWidthMm = size.widthMm / 2;

  const candidates: number[] = [
    // (a) left edge a whole number of increments from the wall start.
    nearestAscending(proposedXMm, halfWidthMm, incrementMm),
    // (b) right edge a whole number of increments from the wall end.
    nearestDescending(proposedXMm, wallLengthMm - halfWidthMm, incrementMm)
  ];

  // The moving object's vertical band at the proposed y; a neighbour must
  // overlap it to bound a horizontal gap (a low pedestal or high transom is not
  // "beside" the work). Strict overlap, matching getOpenSpaceBounds.
  const movingTopMm = proposed.yMm + size.heightMm / 2;
  const movingBottomMm = proposed.yMm - size.heightMm / 2;

  let leftNeighborRightMm = Number.NEGATIVE_INFINITY;
  let rightNeighborLeftMm = Number.POSITIVE_INFINITY;
  for (const neighbor of neighbors) {
    const overlapsBand =
      neighbor.yMm + neighbor.heightMm / 2 > movingBottomMm &&
      neighbor.yMm - neighbor.heightMm / 2 < movingTopMm;
    if (!overlapsBand) continue;

    const neighborRightMm = neighbor.xMm + neighbor.widthMm / 2;
    const neighborLeftMm = neighbor.xMm - neighbor.widthMm / 2;
    // Nearest neighbour to the left: greatest right edge left of the proposed
    // center. To the right: least left edge right of the proposed center.
    if (neighborRightMm <= proposedXMm && neighborRightMm > leftNeighborRightMm) {
      leftNeighborRightMm = neighborRightMm;
    }
    if (neighborLeftMm >= proposedXMm && neighborLeftMm < rightNeighborLeftMm) {
      rightNeighborLeftMm = neighborLeftMm;
    }
  }

  if (leftNeighborRightMm !== Number.NEGATIVE_INFINITY) {
    // (c) left edge a whole number of increments right of the neighbour's right
    // edge (a non-negative gap): center = (neighborRight + width/2) + k·inc.
    candidates.push(
      nearestAscending(proposedXMm, leftNeighborRightMm + halfWidthMm, incrementMm)
    );
  }
  if (rightNeighborLeftMm !== Number.POSITIVE_INFINITY) {
    // (d) right edge a whole number of increments left of the neighbour's left
    // edge (a non-negative gap): center = (neighborLeft − width/2) − k·inc.
    candidates.push(
      nearestDescending(proposedXMm, rightNeighborLeftMm - halfWidthMm, incrementMm)
    );
  }

  return nearestCandidate(proposedXMm, candidates);
}

// Quantize a proposed CENTER y so either the center height from the floor OR
// the bottom-edge height from the floor lands on a multiple of `incrementMm`;
// the nearer of the two candidates wins. Both families are lattices of period
// `incrementMm` (correction ≤ incrementMm/2). No neighbours enter — vertical
// alignment is always read against the floor.
export function quantizeYToCleanIncrement(
  proposed: Point,
  size: ArtworkSize,
  incrementMm: number
): number {
  if (!Number.isFinite(incrementMm) || incrementMm <= 0) return proposed.yMm;

  const proposedYMm = proposed.yMm;
  const halfHeightMm = size.heightMm / 2;

  const candidates: number[] = [
    // Center height from the floor a whole number of increments.
    Math.round(proposedYMm / incrementMm) * incrementMm,
    // Bottom-edge height from the floor a whole number of increments.
    Math.round((proposedYMm - halfHeightMm) / incrementMm) * incrementMm + halfHeightMm
  ];

  return nearestCandidate(proposedYMm, candidates);
}
