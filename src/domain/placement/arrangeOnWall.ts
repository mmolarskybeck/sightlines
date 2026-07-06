import type { WallObjectBase } from "../project";

// "Arrange on wall": the curatorial move where a group of works is centered
// on its wall (equal inset from both wall edges) and distributed with equal
// edge-to-edge gaps in the remaining span. Inset and gap are two views of
// one degree of freedom, linked by
//
//   2·inset + Σwidths + (n−1)·gap = wallLength
//
// so every conversion below is that equation solved for one variable. All
// functions are pure and assume the members already live on the same wall —
// the store guards that before calling (a cross-wall "arrangement" has no
// single wallLength to arrange within).

function sumWidthsMm(members: WallObjectBase[]): number {
  return members.reduce((total, member) => total + member.widthMm, 0);
}

// The "equal everywhere" default: wall margins and inter-work gaps all take
// the same value, x = (W − Σwidths)/(n+1) — n works create n−1 interior gaps
// plus 2 margins, n+1 equal spaces in total.
export function solveEqualArrangement(
  members: WallObjectBase[],
  wallLengthMm: number
): { insetMm: number; gapMm: number } {
  const spacingMm = (wallLengthMm - sumWidthsMm(members)) / (members.length + 1);
  return { insetMm: spacingMm, gapMm: spacingMm };
}

// The gap that a given inset forces (and vice versa below). May legitimately
// go negative when the works are wider than the available span — callers
// surface that rather than clamping, and the collision gate catches any
// resulting overlap on commit. Requires n ≥ 2 (n−1 interior gaps).
export function gapForInset(
  members: WallObjectBase[],
  wallLengthMm: number,
  insetMm: number
): number {
  return (
    (wallLengthMm - 2 * insetMm - sumWidthsMm(members)) / (members.length - 1)
  );
}

export function insetForGap(
  members: WallObjectBase[],
  wallLengthMm: number,
  gapMm: number
): number {
  return (
    (wallLengthMm - sumWidthsMm(members) - (members.length - 1) * gapMm) / 2
  );
}

// Centered arrangement at the given inset: members keep their current
// left-to-right order (sorted by xMm — arranging must never reshuffle the
// hang), the leftmost left edge lands at insetMm from the wall start, and
// every interior gap takes the derived equal value. Returns new CENTER xMm
// per member (the WallObjectBase convention); yMm is untouched by design —
// arranging is a horizontal move only. Returns [] for fewer than 2 members.
export function arrangeOnWall(
  members: WallObjectBase[],
  wallLengthMm: number,
  opts: { insetMm: number }
): { id: string; xMm: number }[] {
  if (members.length < 2) return [];

  const sorted = [...members].sort((a, b) => a.xMm - b.xMm);
  const gapMm = gapForInset(members, wallLengthMm, opts.insetMm);

  let cursorMm = opts.insetMm;
  return sorted.map((member) => {
    const xMm = cursorMm + member.widthMm / 2;
    cursorMm += member.widthMm + gapMm;
    return { id: member.id, xMm };
  });
}

// Seeds the inspector's linked fields from the CURRENT layout: inset reads
// as the leftmost member's left-edge offset from the wall start, and gap as
// whatever that inset forces through the shared equation. Exact once a
// layout has been arranged; a sensible seed for a freehand layout (the two
// values stay mutually consistent by construction either way, so the fields
// can never disagree with what a commit would produce).
export function getArrangeReadout(
  members: WallObjectBase[],
  wallLengthMm: number
): { insetMm: number; gapMm: number } {
  const insetMm = Math.min(
    ...members.map((member) => member.xMm - member.widthMm / 2)
  );
  return { insetMm, gapMm: gapForInset(members, wallLengthMm, insetMm) };
}
