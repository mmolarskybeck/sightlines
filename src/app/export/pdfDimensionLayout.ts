export type PdfLabelBox = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

function boxesIntersect(a: PdfLabelBox, b: PdfLabelBox, gap = 2): boolean {
  return !(
    a.right + gap < b.left ||
    a.left - gap > b.right ||
    a.top + gap < b.bottom ||
    a.bottom - gap > b.top
  );
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
  occupied: readonly PdfLabelBox[]
): T {
  if (candidates.length === 0) {
    throw new Error("At least one PDF label candidate is required.");
  }
  const available = candidates.find((candidate) =>
    occupied.every((box) => !boxesIntersect(candidate.box, box))
  );
  if (available) return available;
  return candidates.reduce((best, candidate) => {
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
