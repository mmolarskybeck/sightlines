import type { ConnectableOpeningWallObject, Project } from "../project";
import { parseFaceWallId } from "./freestandingWalls";
import { floorWallDirection, getFloorWalls, type FloorWall } from "./planObjects";
import { clamp } from "./scalar";
import { dot, pointAlong, pointToLineDistance, projectScalar } from "./vector";

// Starting tolerances from room-shapes-spec.md §7.2. They are named and
// exported because both candidate filtering and the inspector copy need to
// describe the same rule the 3D derivation uses.
export const OPENING_PAIR_ANGLE_TOLERANCE_DEG = 2;
export const OPENING_PAIR_MAX_GAP_MM = 250;
export const OPENING_PAIR_MIN_OVERLAP_RATIO = 0.5;
export const OPENING_PAIR_MIN_OVERLAP_MM = 300;

export type OpeningAlignment =
  | {
      status: "aligned";
      clearA: { xMinMm: number; xMaxMm: number };
      clearB: { xMinMm: number; xMaxMm: number };
    }
  | { status: "misaligned"; reason: "angle" | "gap" | "no-overlap" | "height" };

type Point = { xMm: number; yMm: number };
type UnitDirection = { xMm: number; yMm: number };

type OpeningOnWall = {
  opening: ConnectableOpeningWallObject;
  wall: FloorWall;
  direction: UnitDirection;
  center: Point;
};

// Pure advisory geometry for one proposed/stored opening pair. The function is
// deliberately total: wallObject.wallId is not schema-cross-checked, so a
// hand-edited project can contain a dangling wall reference. With no geometry
// there is no shared clear interval, which is reported as "no-overlap" rather
// than throwing from an inspector or the 3D derivation.
export function evaluateOpeningPair(
  project: Project,
  aId: string,
  bId: string
): OpeningAlignment {
  const wallsById = new Map(getFloorWalls(project.floor).map((wall) => [wall.id, wall]));
  const a = resolveOpening(project, wallsById, aId);
  const b = resolveOpening(project, wallsById, bId);

  if (
    !a ||
    !b ||
    aId === bId ||
    a.opening.kind !== b.opening.kind ||
    a.wall.id === b.wall.id ||
    parseFaceWallId(a.wall.id) !== null ||
    parseFaceWallId(b.wall.id) !== null
  ) {
    return { status: "misaligned", reason: "no-overlap" };
  }

  // Abutting room loops run in opposite directions along their shared edge.
  // Measure deviation from an exact anti-parallel dot (-1); same-direction
  // walls are not a connection between the two room interiors (spec §2/§10).
  const directionDot = clamp(dot(a.direction, b.direction), -1, 1);
  const angleDeg = (Math.acos(-directionDot) * 180) / Math.PI;
  if (angleDeg > OPENING_PAIR_ANGLE_TOLERANCE_DEG) {
    return { status: "misaligned", reason: "angle" };
  }

  // For the small allowed angle tolerance, check separation where the two
  // openings actually sit rather than using infinite lines (which would
  // eventually intersect and misleadingly have zero distance). Requiring both
  // center-to-opposite-line distances to fit makes the result symmetric.
  const gapMm = Math.max(
    pointToLineDistance(b.center, a.wall.startFloorMm, a.direction),
    pointToLineDistance(a.center, b.wall.startFloorMm, b.direction)
  );
  if (gapMm > OPENING_PAIR_MAX_GAP_MM) {
    return { status: "misaligned", reason: "gap" };
  }

  // Compute one floor-space clear segment on A's axis. Each opening's physical
  // segment is projected onto that common axis; the overlap is then projected
  // back into EACH wall's authored local x, because anti-parallel walls run in
  // opposite directions and therefore need mirrored local intervals.
  const aProjected = projectedOpeningInterval(a, a.wall.startFloorMm, a.direction);
  const bProjected = projectedOpeningInterval(b, a.wall.startFloorMm, a.direction);
  const overlapMinMm = Math.max(aProjected.minMm, bProjected.minMm);
  const overlapMaxMm = Math.min(aProjected.maxMm, bProjected.maxMm);
  const overlapMm = Math.max(0, overlapMaxMm - overlapMinMm);
  const smallerWidthMm = Math.min(a.opening.widthMm, b.opening.widthMm);

  if (
    overlapMm < OPENING_PAIR_MIN_OVERLAP_MM ||
    overlapMm < smallerWidthMm * OPENING_PAIR_MIN_OVERLAP_RATIO
  ) {
    return { status: "misaligned", reason: "no-overlap" };
  }

  const verticalA = verticalExtent(a.opening);
  const verticalB = verticalExtent(b.opening);
  if (Math.max(verticalA.minMm, verticalB.minMm) >= Math.min(verticalA.maxMm, verticalB.maxMm)) {
    return { status: "misaligned", reason: "height" };
  }

  const clearStart = pointAlong(a.wall.startFloorMm, a.direction, overlapMinMm);
  const clearEnd = pointAlong(a.wall.startFloorMm, a.direction, overlapMaxMm);

  return {
    status: "aligned",
    clearA: localInterval(clearStart, clearEnd, a.wall.startFloorMm, a.direction),
    clearB: localInterval(clearStart, clearEnd, b.wall.startFloorMm, b.direction)
  };
}

function resolveOpening(
  project: Project,
  wallsById: ReadonlyMap<string, FloorWall>,
  id: string
): OpeningOnWall | null {
  const object = project.wallObjects.find((candidate) => candidate.id === id);
  if (!object || (object.kind !== "door" && object.kind !== "window")) return null;

  const wall = wallsById.get(object.wallId);
  if (!wall || wall.lengthMm <= 0) return null;

  const direction = floorWallDirection(wall);
  return {
    opening: object,
    wall,
    direction,
    center: pointAlong(wall.startFloorMm, direction, object.xMm)
  };
}

function projectedOpeningInterval(
  subject: OpeningOnWall,
  axisOrigin: Point,
  axis: UnitDirection
): { minMm: number; maxMm: number } {
  const halfWidthMm = subject.opening.widthMm / 2;
  const start = pointAlong(subject.center, subject.direction, -halfWidthMm);
  const end = pointAlong(subject.center, subject.direction, halfWidthMm);
  const startProjection = projectScalar(start, axisOrigin, axis);
  const endProjection = projectScalar(end, axisOrigin, axis);
  return {
    minMm: Math.min(startProjection, endProjection),
    maxMm: Math.max(startProjection, endProjection)
  };
}

function verticalExtent(opening: ConnectableOpeningWallObject): {
  minMm: number;
  maxMm: number;
} {
  return {
    minMm: opening.kind === "door" ? 0 : opening.yMm - opening.heightMm / 2,
    maxMm: opening.yMm + opening.heightMm / 2
  };
}

function localInterval(
  start: Point,
  end: Point,
  wallStart: Point,
  wallDirection: UnitDirection
): { xMinMm: number; xMaxMm: number } {
  const startMm = projectScalar(start, wallStart, wallDirection);
  const endMm = projectScalar(end, wallStart, wallDirection);
  return { xMinMm: Math.min(startMm, endMm), xMaxMm: Math.max(startMm, endMm) };
}

