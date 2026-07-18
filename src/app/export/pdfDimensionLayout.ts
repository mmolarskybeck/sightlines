export type PdfLabelBox = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

export type PdfPoint = { x: number; y: number };

function boxesIntersect(a: PdfLabelBox, b: PdfLabelBox, gap = 2): boolean {
  return !(
    a.right + gap < b.left ||
    a.left - gap > b.right ||
    a.top + gap < b.bottom ||
    a.bottom - gap > b.top
  );
}

function segmentIntersectsBox(
  from: PdfPoint,
  to: PdfPoint,
  box: PdfLabelBox
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let exit = 1;
  for (const [start, delta, lo, hi] of [
    [from.x, dx, box.left, box.right],
    [from.y, dy, box.bottom, box.top]
  ] as const) {
    if (delta === 0) {
      if (start < lo || start > hi) return false;
      continue;
    }
    const near = (lo - start) / delta;
    const far = (hi - start) / delta;
    enter = Math.max(enter, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
    if (enter > exit) return false;
  }
  return true;
}

/** Returns a direct or single-elbow leader that does not cross artwork. */
export function findPdfLeaderRoute(
  from: PdfPoint,
  to: PdfPoint,
  obstacles: readonly PdfLabelBox[]
): PdfPoint[] | null {
  const clear = (points: readonly PdfPoint[]) =>
    points.slice(1).every((point, index) =>
      obstacles.every(
        (box) => !segmentIntersectsBox(points[index]!, point, box)
      )
    );
  if (clear([from, to])) return [from, to];

  const horizontalThenVertical = { x: to.x, y: from.y };
  if (clear([from, horizontalThenVertical, to])) {
    return [from, horizontalThenVertical, to];
  }
  const verticalThenHorizontal = { x: from.x, y: to.y };
  if (clear([from, verticalThenHorizontal, to])) {
    return [from, verticalThenHorizontal, to];
  }
  return null;
}

function overlapArea(a: PdfLabelBox, b: PdfLabelBox): number {
  const width = Math.max(
    0,
    Math.min(a.right, b.right) - Math.max(a.left, b.left)
  );
  const height = Math.max(
    0,
    Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom)
  );
  return width * height;
}

export function choosePdfLabelCandidate<T extends { box: PdfLabelBox }>(
  candidates: readonly T[],
  occupied: readonly PdfLabelBox[],
  hardObstacles: readonly PdfLabelBox[] = []
): T | null {
  if (candidates.length === 0) {
    return null;
  }
  const clearOfArtwork = candidates.filter((candidate) =>
    hardObstacles.every((box) => !boxesIntersect(candidate.box, box))
  );
  const available = clearOfArtwork.find((candidate) =>
    occupied.every((box) => !boxesIntersect(candidate.box, box))
  );
  if (available) return available;
  // Artwork and openings are never a valid fallback. A caller may expand
  // its search, or omit the label while retaining the dimension line.
  if (clearOfArtwork.length === 0) return null;
  const fallbackCandidates = clearOfArtwork;
  return fallbackCandidates.reduce((best, candidate) => {
    const bestOverlap = occupied.reduce(
      (total, box) => total + overlapArea(best.box, box),
      0
    );
    const candidateOverlap = occupied.reduce(
      (total, box) => total + overlapArea(candidate.box, box),
      0
    );
    return candidateOverlap < bestOverlap ? candidate : best;
  });
}
