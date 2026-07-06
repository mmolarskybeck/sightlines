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

// The wall-local spans left over once every member is placed: the left
// margin (wall start → leftmost member's left edge), one actual gap per
// adjacent pair of members (right edge of one → left edge of the next), and
// the right margin (rightmost member's right edge → wall end) — n members
// bound n+1 segments this way. These are the CURRENT edge-to-edge gaps as
// they exist on the wall, not the solved uniform gap "equal" mode would
// produce, so a freeform hang's dimension lines/readouts describe what's
// actually there instead of a fictional average. A segment legitimately
// comes back with toMm < fromMm when neighbors overlap — returned unclamped;
// the commit-time collision gate is what catches that, not this readout.
export function getSpacingSegments(
  members: WallObjectBase[],
  wallLengthMm: number
): { fromMm: number; toMm: number }[] {
  if (members.length === 0) return [];

  const sorted = [...members].sort((a, b) => a.xMm - b.xMm);
  const segments: { fromMm: number; toMm: number }[] = [
    { fromMm: 0, toMm: sorted[0].xMm - sorted[0].widthMm / 2 }
  ];

  for (let i = 0; i < sorted.length - 1; i++) {
    segments.push({
      fromMm: sorted[i].xMm + sorted[i].widthMm / 2,
      toMm: sorted[i + 1].xMm - sorted[i + 1].widthMm / 2
    });
  }

  const rightmost = sorted[sorted.length - 1];
  segments.push({
    fromMm: rightmost.xMm + rightmost.widthMm / 2,
    toMm: wallLengthMm
  });

  return segments;
}

// Like getSpacingSegments, but the two OUTER segments stop at the nearest
// UNSELECTED neighbour on that side instead of always running to the wall edge
// — so an idle selection's dimension lines describe the space actually beside
// the works (up to the next window/door/work) rather than sailing through it to
// the far wall. Interior gaps between members are unchanged (member edge ↔
// member edge, same as getSpacingSegments).
//
// A boundary object counts only when its vertical extent overlaps the
// selection's union y-band — a low pedestal zone or a high transom window sits
// outside the works' band and is not "beside" them, so it never bounds a
// segment. On each side the boundary is the nearest qualifying neighbour edge:
//   left  → the greatest right-edge of a y-overlapping object whose right edge
//           lies left of the selection's right edge (a fully-left neighbour, or
//           one overlapping the selection from the left), else the wall start;
//   right → the least left-edge of a y-overlapping object whose left edge lies
//           right of the selection's left edge, else the wall end.
// An overlapping neighbour puts the boundary INSIDE the selection's span, which
// yields a negative outer segment — returned as-is unclamped, the same
// convention getSpacingSegments follows. With no qualifying others on a side the
// boundary falls back to the wall edge, so a members-only call reproduces
// getSpacingSegments exactly.
//
// `others` is the caller's responsibility: the unselected wall objects on the
// SAME wall as the members (the caller filters by wall and by selection).
export function getNeighborAwareSegments(
  members: WallObjectBase[],
  others: WallObjectBase[],
  wallLengthMm: number
): { fromMm: number; toMm: number }[] {
  if (members.length === 0) return [];

  const sorted = [...members].sort((a, b) => a.xMm - b.xMm);
  const leftEdgeMm = sorted[0].xMm - sorted[0].widthMm / 2;
  const rightmost = sorted[sorted.length - 1];
  const rightEdgeMm = rightmost.xMm + rightmost.widthMm / 2;

  // The selection's union vertical band; a neighbour must overlap it to count.
  const bandTopMm = Math.max(...members.map((member) => member.yMm + member.heightMm / 2));
  const bandBottomMm = Math.min(...members.map((member) => member.yMm - member.heightMm / 2));
  const overlapsBand = (object: WallObjectBase) =>
    object.yMm + object.heightMm / 2 > bandBottomMm &&
    object.yMm - object.heightMm / 2 < bandTopMm;
  const bandOthers = others.filter(overlapsBand);

  // Left boundary: nearest right-edge that lies left of the selection's right
  // edge (fully-left neighbour, or one overlapping from the left). Wall start
  // when there's nothing beside the works on the left.
  let leftBoundaryMm = 0;
  for (const object of bandOthers) {
    const objectRightMm = object.xMm + object.widthMm / 2;
    if (objectRightMm < rightEdgeMm && objectRightMm > leftBoundaryMm) {
      leftBoundaryMm = objectRightMm;
    }
  }

  // Right boundary: nearest left-edge that lies right of the selection's left
  // edge (fully-right neighbour, or one overlapping from the right). Wall end
  // when there's nothing beside the works on the right.
  let rightBoundaryMm = wallLengthMm;
  for (const object of bandOthers) {
    const objectLeftMm = object.xMm - object.widthMm / 2;
    if (objectLeftMm > leftEdgeMm && objectLeftMm < rightBoundaryMm) {
      rightBoundaryMm = objectLeftMm;
    }
  }

  const segments: { fromMm: number; toMm: number }[] = [
    { fromMm: leftBoundaryMm, toMm: leftEdgeMm }
  ];

  for (let i = 0; i < sorted.length - 1; i++) {
    segments.push({
      fromMm: sorted[i].xMm + sorted[i].widthMm / 2,
      toMm: sorted[i + 1].xMm - sorted[i + 1].widthMm / 2
    });
  }

  segments.push({ fromMm: rightEdgeMm, toMm: rightBoundaryMm });

  return segments;
}

// Below this spread, two gaps (or two insets) are "the same" for display
// purposes — enough slack to absorb floating-point noise from a prior
// arrange without flickering, tight enough that a genuinely freeform hang
// still reads as mixed.
const MIXED_EPSILON_MM = 0.5;

// The inspector's richer readout: the same inset/gap seed as
// getArrangeReadout (so switching modes or typing a value still starts from
// where the layout already is), plus whether the CURRENT layout is uniform
// enough for those single numbers to be trusted — a freeform hang shows
// "Mixed" in the panel instead of a misleadingly precise gap or inset.
// gapIsMixed only makes sense with 2+ interior gaps, i.e. 3+ members (2
// members have exactly one interior gap, which can't disagree with itself).
export function getArrangeReadoutDetailed(
  members: WallObjectBase[],
  wallLengthMm: number
): {
  insetMm: number;
  gapMm: number;
  gapIsMixed: boolean;
  insetIsMixed: boolean;
} {
  const { insetMm, gapMm } = getArrangeReadout(members, wallLengthMm);

  const segments = getSpacingSegments(members, wallLengthMm);
  const interiorGapsMm = segments
    .slice(1, -1)
    .map((segment) => segment.toMm - segment.fromMm);

  const gapIsMixed =
    interiorGapsMm.length >= 2 &&
    Math.max(...interiorGapsMm) - Math.min(...interiorGapsMm) >
      MIXED_EPSILON_MM;

  const leftInsetMm = segments[0].toMm - segments[0].fromMm;
  const lastSegment = segments[segments.length - 1];
  const rightInsetMm = lastSegment.toMm - lastSegment.fromMm;
  const insetIsMixed = Math.abs(leftInsetMm - rightInsetMm) > MIXED_EPSILON_MM;

  return { insetMm, gapMm, gapIsMixed, insetIsMixed };
}
