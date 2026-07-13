import type { WallObjectBase } from "../project";

// Center a same-wall group with equal edge-to-edge gaps. Inset and gap satisfy:
//
//   2·inset + Σwidths + (n−1)·gap = wallLength

function sumWidthsMm(members: WallObjectBase[]): number {
  return members.reduce((total, member) => total + member.widthMm, 0);
}

// n works create n+1 equal spaces: (W − Σwidths)/(n+1).
export function solveEqualArrangement(
  members: WallObjectBase[],
  wallLengthMm: number
): { insetMm: number; gapMm: number } {
  const spacingMm = (wallLengthMm - sumWidthsMm(members)) / (members.length + 1);
  return { insetMm: spacingMm, gapMm: spacingMm };
}

// Equal arrangement within an arbitrary wall-local zone.
export function solveEqualArrangementInZone(
  members: WallObjectBase[],
  zoneStartMm: number,
  zoneEndMm: number
): { insetMm: number; gapMm: number } {
  return solveEqualArrangement(members, zoneEndMm - zoneStartMm);
}

// Negative results remain unclamped for commit-time collision handling. Requires n ≥ 2.
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

// Preserve left-to-right order and return new center x positions only.
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

// Arrange equally between zone edges rather than wall edges.
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

// Apply a caller-supplied inset from both zone edges.
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

// Translate the group rigidly to an absolute inset from one boundary.
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

// Wall-edge wrapper around slideGroupToBoundaryInset.
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

// Set absolute interior gaps while preserving the group's union-bounds center.
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

// Return current margins and interior gaps; overlaps remain negative and unclamped.
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

// Free span bounded by same-wall unselected neighbors, falling back to wall edges.
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

// Detect the nearest same-wall neighbor overlapping the selection's vertical band.
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
    // Accept fully-left neighbors and those overlapping from the left.
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

  // Accept fully-right neighbors and those overlapping from the right.
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

// Center one work between its detected left and right boundaries.
export function centerMemberBetweenBoundaries(
  member: WallObjectBase,
  others: WallObjectBase[],
  wallLengthMm: number
): number {
  const left = detectBoundary("left", [member], others, wallLengthMm);
  const right = detectBoundary("right", [member], others, wallLengthMm);
  return (left.edgeMm + right.edgeMm) / 2;
}

// Like getSpacingSegments, but outer gaps end at detected neighbor boundaries.
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

  // Neighbors affect only the two outer segments.
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

// Absorb floating-point noise without hiding visibly freeform spacing.
const MIXED_EPSILON_MM = 0.5;

// Read actual layout values: gap is the mean interior gap, never derived from
// inset. Two members have one gap, so it cannot be mixed.
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
