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

// The same equal solve, but confined to an arbitrary zone [zoneStartMm,
// zoneEndMm] along the wall rather than the whole wall — the "Space within →
// Open space" case, where the works spread evenly across just the free span
// between the nearest neighbours (see getOpenSpaceBounds). The zone's length is
// the only thing the spacing depends on, so this is solveEqualArrangement over
// (zoneEndMm − zoneStartMm); a zone of [0, wallLengthMm] reproduces the whole-
// wall solve exactly. A zone too small for Σwidths yields a negative spacing,
// returned unclamped like every other solver here.
export function solveEqualArrangementInZone(
  members: WallObjectBase[],
  zoneStartMm: number,
  zoneEndMm: number
): { insetMm: number; gapMm: number } {
  return solveEqualArrangement(members, zoneEndMm - zoneStartMm);
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

// The zone-aware equal arrangement: like arrangeOnWall, but the group is
// centred within [zoneStartMm, zoneEndMm] instead of the whole wall, with the
// equal margins measured from the zone edges (not the wall edges). Positions
// are the whole-wall equal solve over the zone's length, translated right by
// zoneStartMm — so a zone of [0, wallLengthMm] reproduces
// arrangeOnWall(members, wallLengthMm, { insetMm: solveEqualArrangement(...) })
// exactly. Same conventions as arrangeOnWall: keeps left-to-right order, x-only
// (yMm untouched), unclamped (a too-small zone yields negative gaps and
// overlap, caught by the commit-time collision gate, not here). Returns new
// CENTER xMm per member; returns [] for fewer than 2 members.
export function arrangeOnWallInZone(
  members: WallObjectBase[],
  zoneStartMm: number,
  zoneEndMm: number
): { id: string; xMm: number }[] {
  if (members.length < 2) return [];

  const zoneLengthMm = zoneEndMm - zoneStartMm;
  const { insetMm } = solveEqualArrangement(members, zoneLengthMm);
  return arrangeOnWall(members, zoneLengthMm, { insetMm }).map((move) => ({
    id: move.id,
    xMm: move.xMm + zoneStartMm
  }));
}

// Like arrangeOnWallInZone, but the caller supplies the (equal) inset
// directly instead of solving for it — the "From edges → Both" case once its
// boundary is a detected zone rather than the whole wall: the group is
// centred within [zoneStartMm, zoneEndMm] with insetMm from each zone edge,
// same equation arrangeOnWall solves against the whole wall. A zone of
// [0, wallLengthMm] reproduces arrangeOnWall(members, wallLengthMm, {
// insetMm }) exactly, so this is the drop-in generalisation once a per-side
// boundary (wall or neighbour, see detectBoundary) replaces the wall edges.
export function arrangeOnWallInZoneWithInset(
  members: WallObjectBase[],
  zoneStartMm: number,
  zoneEndMm: number,
  insetMm: number
): { id: string; xMm: number }[] {
  if (members.length < 2) return [];

  const zoneLengthMm = zoneEndMm - zoneStartMm;
  return arrangeOnWall(members, zoneLengthMm, { insetMm }).map((move) => ({
    id: move.id,
    xMm: move.xMm + zoneStartMm
  }));
}

// Slides the whole group as a RIGID unit so one of its outer edges lands a
// given distance from an arbitrary boundary edge (a wall start/end, or a
// neighbouring object's edge — see detectBoundary), preserving every interior
// gap (x-only, a single shared translation applied to every member). Unlike
// arrangeOnWall, which re-solves the interior spacing to centre the group,
// this keeps the hang exactly as it is and only moves it sideways.
//
//   side "left"  → the group's leftmost edge lands at (boundaryEdgeMm +
//                  insetMm): delta = boundaryEdgeMm + insetMm − (current
//                  leftmost left edge)
//   side "right" → the group's rightmost edge lands at (boundaryEdgeMm −
//                  insetMm): delta = (boundaryEdgeMm − insetMm) − (current
//                  rightmost right edge)
//
// The semantics are ABSOLUTE, not cumulative: calling twice with the same
// insetMm produces no additional movement (the second delta is 0), because
// the target edge is already there. insetMm is unclamped — a negative or
// overflowing distance is allowed and the commit-time collision gate is what
// catches any resulting overlap, same convention as arrangeOnWall. Returns new
// CENTER xMm per member; yMm is untouched. Returns [] for fewer than 2 members.
export function slideGroupToBoundaryInset(
  members: WallObjectBase[],
  side: "left" | "right",
  boundaryEdgeMm: number,
  insetMm: number
): { id: string; xMm: number }[] {
  if (members.length < 2) return [];

  const leftEdgeMm = Math.min(
    ...members.map((member) => member.xMm - member.widthMm / 2)
  );
  const rightEdgeMm = Math.max(
    ...members.map((member) => member.xMm + member.widthMm / 2)
  );

  const deltaMm =
    side === "left"
      ? boundaryEdgeMm + insetMm - leftEdgeMm
      : boundaryEdgeMm - insetMm - rightEdgeMm;

  return members.map((member) => ({ id: member.id, xMm: member.xMm + deltaMm }));
}

// The wall-edge-only case of slideGroupToBoundaryInset — the boundary is
// always the wall start (side "left") or wall end (side "right"). Kept as a
// thin wrapper so call sites that never deal in neighbour boundaries (and the
// tests documenting this exact behaviour) don't need to know the general
// form exists.
export function slideGroupToEdgeInset(
  members: WallObjectBase[],
  wallLengthMm: number,
  side: "left" | "right",
  insetMm: number
): { id: string; xMm: number }[] {
  return slideGroupToBoundaryInset(
    members,
    side,
    side === "left" ? 0 : wallLengthMm,
    insetMm
  );
}

// Re-spaces the group in place: every interior edge-to-edge gap is set to
// gapMm while the group's union-bounds CENTER stays exactly where it is — the
// "Between works" curatorial move, which changes only the spacing and never
// re-centers the hang on the wall. Members keep their left-to-right order
// (sorted by xMm; arranging must never reshuffle the hang). x-only, yMm is
// untouched, no clamping — a negative gapMm is allowed and the commit-time
// collision gate catches any resulting overlap, same convention as
// arrangeOnWall. Semantics are ABSOLUTE: calling twice with the same gapMm is
// a no-op the second time (the center and widths are unchanged, so the run
// lands in the same place). Needs no wallLengthMm — the wall never enters in.
// Returns new CENTER xMm per member; returns [] for fewer than 2 members.
export function spaceGroupAboutCenter(
  members: WallObjectBase[],
  gapMm: number
): { id: string; xMm: number }[] {
  if (members.length < 2) return [];

  const sorted = [...members].sort((a, b) => a.xMm - b.xMm);

  const oldLeftEdgeMm = Math.min(
    ...members.map((member) => member.xMm - member.widthMm / 2)
  );
  const oldRightEdgeMm = Math.max(
    ...members.map((member) => member.xMm + member.widthMm / 2)
  );
  const oldCenterMm = (oldLeftEdgeMm + oldRightEdgeMm) / 2;

  const runWidthMm = sumWidthsMm(sorted) + (sorted.length - 1) * gapMm;

  let cursorMm = oldCenterMm - runWidthMm / 2;
  return sorted.map((member) => {
    const xMm = cursorMm + member.widthMm / 2;
    cursorMm += member.widthMm + gapMm;
    return { id: member.id, xMm };
  });
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

// The free span a selection sits in: the wall-local [startMm, endMm] bounded
// on each side by detectBoundary — the nearest qualifying UNSELECTED
// neighbour beside the works, falling back to the wall edge when there's
// nothing beside them on that side. Powers "Space evenly → Open space" (the
// works distribute within just this span, see arrangeOnWallInZone) and is
// exactly the outer-boundary rule getNeighborAwareSegments uses for its two
// outer segments.
//
// `others` is the caller's responsibility: the unselected wall objects on the
// SAME wall as the members (the caller filters by wall and by selection).
export function getOpenSpaceBounds(
  members: WallObjectBase[],
  others: WallObjectBase[],
  wallLengthMm: number
): { startMm: number; endMm: number } {
  if (members.length === 0) return { startMm: 0, endMm: wallLengthMm };

  const left = detectBoundary("left", members, others, wallLengthMm);
  const right = detectBoundary("right", members, others, wallLengthMm);
  return { startMm: left.edgeMm, endMm: right.edgeMm };
}

// What a selection's edge measures against on one side: the wall itself, or
// the nearest qualifying UNSELECTED neighbour beside it (see the y-band and
// "nearest qualifying" rules on getOpenSpaceBounds/getNeighborAwareSegments —
// this is that same detector, pulled out so a second consumer (the "From
// edges" panel's per-side field) can ask the identical question getOpenSpace-
// Bounds asks for "Space evenly → Open space", rather than re-implementing
// wall-vs-neighbour detection. No manual override: whichever the detector
// finds IS the target, which is the whole point — see arrangeSlice's
// insetBoundary.
//
// `others` is the caller's responsibility: the unselected wall objects on the
// SAME wall as `members` (assumed non-empty — callers with zero members, e.g.
// an idle empty selection, short-circuit before reaching here).
export type BoundaryDetection =
  | { type: "wall"; edgeMm: number }
  | { type: "object"; edgeMm: number; objectId: string };

export function detectBoundary(
  side: "left" | "right",
  members: WallObjectBase[],
  others: WallObjectBase[],
  wallLengthMm: number
): BoundaryDetection {
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

  if (side === "left") {
    // Nearest right-edge that lies left of the selection's right edge
    // (fully-left neighbour, or one overlapping from the left). Wall start
    // when there's nothing beside the works on the left.
    let edgeMm = 0;
    let objectId: string | undefined;
    for (const object of bandOthers) {
      const objectRightMm = object.xMm + object.widthMm / 2;
      if (objectRightMm < rightEdgeMm && objectRightMm > edgeMm) {
        edgeMm = objectRightMm;
        objectId = object.id;
      }
    }
    return objectId ? { type: "object", edgeMm, objectId } : { type: "wall", edgeMm };
  }

  // Nearest left-edge that lies right of the selection's left edge
  // (fully-right neighbour, or one overlapping from the right). Wall end
  // when there's nothing beside the works on the right.
  let edgeMm = wallLengthMm;
  let objectId: string | undefined;
  for (const object of bandOthers) {
    const objectLeftMm = object.xMm - object.widthMm / 2;
    if (objectLeftMm > leftEdgeMm && objectLeftMm < edgeMm) {
      edgeMm = objectLeftMm;
      objectId = object.id;
    }
  }
  return objectId ? { type: "object", edgeMm, objectId } : { type: "wall", edgeMm };
}

// The "Center" move for a SINGLE work: the x that puts its center exactly
// midway between whatever detectBoundary finds on its left and right — the
// nearest UNSELECTED wall object beside it (openings/blocked zones count,
// same as every other detector here), else the wall edge on that side. This
// is the one-member reduction of the same curatorial idea arrangeOnWall*
// solves for groups (equal margins either side), but a lone work has no
// interior gaps to re-solve — centering it is just the midpoint of
// [leftBoundary.edgeMm, rightBoundary.edgeMm], so this calls detectBoundary
// directly rather than routing through the zone helpers built for 2+ members.
// x-only (yMm is not this function's concern), unclamped — a work wider than
// the resulting span still centers on that midpoint; the commit-time
// collision gate is what catches the overlap, not this, same convention as
// every other solver in this file.
//
// `others` is the caller's responsibility: the unselected wall objects on the
// SAME wall as `member` (same convention as detectBoundary/getOpenSpaceBounds).
export function centerMemberBetweenBoundaries(
  member: WallObjectBase,
  others: WallObjectBase[],
  wallLengthMm: number
): number {
  const left = detectBoundary("left", [member], others, wallLengthMm);
  const right = detectBoundary("right", [member], others, wallLengthMm);
  return (left.edgeMm + right.edgeMm) / 2;
}

// Like getSpacingSegments, but the two OUTER segments stop at the boundary
// detectBoundary finds on that side (the nearest UNSELECTED neighbour, else
// the wall edge) instead of always running to the wall edge — so an idle
// selection's dimension lines describe the space actually beside the works
// (up to the next window/door/work) rather than sailing through it to the far
// wall. Interior gaps between members are unchanged (member edge ↔ member
// edge, same as getSpacingSegments). An overlapping neighbour puts the
// boundary INSIDE the selection's span, which yields a negative outer segment
// — returned as-is unclamped, the same convention getSpacingSegments follows.
// With no qualifying others on a side the boundary falls back to the wall
// edge, so a members-only call reproduces getSpacingSegments exactly.
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

  // The two outer boundaries are exactly the open-space bounds; the interior
  // segments are member-edge ↔ member-edge, unaffected by neighbours.
  const { startMm: leftBoundaryMm, endMm: rightBoundaryMm } = getOpenSpaceBounds(
    members,
    others,
    wallLengthMm
  );

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

// The inspector's richer readout, seeded from the CURRENT layout so switching
// modes or typing a value starts from where the works already are, plus
// whether the layout is uniform enough for those single numbers to be trusted
// — a freeform hang shows "Mixed" in the panel instead of a misleadingly
// precise gap or inset. Both the inset and the gap describe what is ACTUALLY
// on the wall: insetMm is the leftmost member's left-edge offset, and gapMm is
// the mean of the real interior edge-to-edge gaps (the single actual gap for 2
// members). gapMm must NOT be derived from the inset via the symmetric
// equation — for an off-center group that huge left inset forces a hugely
// negative solved gap that has nothing to do with the real spacing.
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
  const insetMm = Math.min(
    ...members.map((member) => member.xMm - member.widthMm / 2)
  );

  const segments = getSpacingSegments(members, wallLengthMm);
  const interiorGapsMm = segments
    .slice(1, -1)
    .map((segment) => segment.toMm - segment.fromMm);

  const gapMm =
    interiorGapsMm.length > 0
      ? interiorGapsMm.reduce((sum, gap) => sum + gap, 0) /
        interiorGapsMm.length
      : 0;

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
