import type { SnapTarget } from "./resolveSnap";

export type VisibleBoundsMm = {
  minXMm: number;
  maxXMm: number;
  minYMm: number;
  maxYMm: number;
};

// Defensive cap on lines-per-axis, independent of whatever bounds/interval
// a caller passes in. The zoom-adaptive interval from precision.ts already
// keeps this well under the cap in practice; this just stops a misused
// (huge bounds, tiny interval) call from generating an unbounded array.
// Exported so regression tests can assert real-world target volumes stay
// comfortably under it without hardcoding a drift-prone copy.
export const MAX_LINES_PER_AXIS = 1000;

// Grid candidates are the lowest-priority snap target (docs/plan.md §2:
// centerline > neighbor-center > neighbor-edge > grid) and are generated
// fresh per call from the currently active grid interval and visible
// coordinate space — never owned by a renderer, never a separate ad hoc
// spacing constant (§5.5). One candidate per visible grid line, not per
// intersection point: each snaps only its own axis, the same shape every
// other single-axis target in this module already uses.
export function getGridSnapTargets(
  intervalMm: number,
  visibleBoundsMm: VisibleBoundsMm
): SnapTarget[] {
  if (!Number.isFinite(intervalMm) || intervalMm <= 0) return [];

  const verticalLines = linesWithin(
    visibleBoundsMm.minXMm,
    visibleBoundsMm.maxXMm,
    intervalMm
  ).map(
    (xMm): SnapTarget => ({
      id: `grid-x-${xMm}`,
      kind: "grid",
      axis: "x",
      point: { xMm, yMm: 0 }
    })
  );

  const horizontalLines = linesWithin(
    visibleBoundsMm.minYMm,
    visibleBoundsMm.maxYMm,
    intervalMm
  ).map(
    (yMm): SnapTarget => ({
      id: `grid-y-${yMm}`,
      kind: "grid",
      axis: "y",
      point: { xMm: 0, yMm }
    })
  );

  return [...verticalLines, ...horizontalLines];
}

function linesWithin(minMm: number, maxMm: number, intervalMm: number): number[] {
  if (!Number.isFinite(minMm) || !Number.isFinite(maxMm) || maxMm < minMm) return [];

  const firstIndex = Math.ceil(minMm / intervalMm);
  const lastIndex = Math.floor(maxMm / intervalMm);
  const lineCount = lastIndex - firstIndex + 1;
  if (lineCount <= 0) return [];

  const clampedLastIndex =
    lineCount > MAX_LINES_PER_AXIS ? firstIndex + MAX_LINES_PER_AXIS - 1 : lastIndex;

  const lines: number[] = [];
  for (let index = firstIndex; index <= clampedLastIndex; index += 1) {
    lines.push(index * intervalMm);
  }

  return lines;
}
