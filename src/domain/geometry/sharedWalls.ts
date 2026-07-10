import type { Project } from "../project";
import { parseFaceWallId } from "./freestandingWalls";
import {
  OPENING_PAIR_ANGLE_TOLERANCE_DEG,
  OPENING_PAIR_MAX_GAP_MM
} from "./openingConnections";
import { floorWallDirection, getFloorWalls, projectPointToWall } from "./planObjects";
import { clamp } from "./scalar";
import { dot, pointAlong, pointToLineDistance, projectScalar } from "./vector";

// Two abutting rooms are modeled as two geometrically coincident perimeter
// walls, one per room ("coincident twin walls"): the rooms' loops run in
// opposite directions along the shared edge, so the twin walls are
// anti-parallel and (near) coincident. When a door or window lands on one such
// wall it must appear on BOTH rooms at the same floor position, kept in sync via
// connectsToObjectId (spec §5.5). This module is the pure geometry that finds a
// wall's coincident twin and mirrors a position across it; the store owns the
// lifecycle that writes the paired openings.

// An opening's extent may overhang a coincident twin by this much and still
// count as "landing on it" — a hair of floating-point / authoring slop, not a
// real overhang. Sub-millimeter, so a genuinely shorter twin is still rejected.
const EXTENT_EPS_MM = 1;

// The coincident twin of `wallId` that a door/window at `centerXMm` (width
// `widthMm`) should be mirrored onto, or null when the wall has no usable twin.
// Candidates are the OTHER rooms' perimeter walls (partition faces never twin,
// spec §2/§6.1); a candidate qualifies when it runs anti-parallel to the source
// within the pairing angle tolerance, sits within the pairing gap of the
// opening's center, and spans the opening's full extent. Ties break on smallest
// gap then wallId, deterministic like findNearestWall.
export function findSharedWallCounterpart(
  project: Project,
  wallId: string,
  centerXMm: number,
  widthMm: number
): { wallId: string; xMm: number } | null {
  const walls = getFloorWalls(project.floor);
  const source = walls.find((wall) => wall.id === wallId);
  if (!source || source.lengthMm <= 0) return null;

  const sourceRoomId = roomIdOfWall(project, source.id);
  const sourceDir = floorWallDirection(source);
  const centerFloorMm = pointAlong(source.startFloorMm, sourceDir, centerXMm);
  const extentStartMm = pointAlong(source.startFloorMm, sourceDir, centerXMm - widthMm / 2);
  const extentEndMm = pointAlong(source.startFloorMm, sourceDir, centerXMm + widthMm / 2);

  let best: { wallId: string; xMm: number; gapMm: number } | null = null;

  for (const candidate of walls) {
    if (candidate.id === source.id) continue;
    if (candidate.lengthMm <= 0) continue;
    // Perimeter walls only; a candidate on the same room can't be an abutment.
    if (parseFaceWallId(candidate.id) !== null) continue;
    if (roomIdOfWall(project, candidate.id) === sourceRoomId) continue;

    const candidateDir = floorWallDirection(candidate);

    // Abutting room loops are anti-parallel: measure deviation from an exact
    // anti-parallel dot (-1), same as evaluateOpeningPair. Same-direction walls
    // are two rooms' faces of the same edge only when they abut, which is the
    // anti-parallel case; a co-directional match is not a shared wall.
    const directionDot = clamp(dot(sourceDir, candidateDir), -1, 1);
    const angleDeg = (Math.acos(-directionDot) * 180) / Math.PI;
    if (angleDeg > OPENING_PAIR_ANGLE_TOLERANCE_DEG) continue;

    // Perpendicular separation at the opening's center. Symmetric like
    // evaluateOpeningPair: require both center-to-opposite-line distances to
    // fit (they coincide for exactly-parallel lines, and stay bounded when the
    // small angle tolerance tilts them).
    const counterCenterMm = projectPointToWall(centerFloorMm, candidate).pointOnWallMm;
    const gapMm = Math.max(
      pointToLineDistance(centerFloorMm, candidate.startFloorMm, candidateDir),
      pointToLineDistance(counterCenterMm, source.startFloorMm, sourceDir)
    );
    if (gapMm > OPENING_PAIR_MAX_GAP_MM) continue;

    // The opening's full extent, projected onto the candidate, must land within
    // the candidate's segment [0, length] — a twin that only partly backs the
    // opening isn't a shared wall.
    const startAlongMm = projectScalar(extentStartMm, candidate.startFloorMm, candidateDir);
    const endAlongMm = projectScalar(extentEndMm, candidate.startFloorMm, candidateDir);
    if (Math.min(startAlongMm, endAlongMm) < -EXTENT_EPS_MM) continue;
    if (Math.max(startAlongMm, endAlongMm) > candidate.lengthMm + EXTENT_EPS_MM) continue;

    const xMm = projectPointToWall(centerFloorMm, candidate).xAlongMm;
    if (
      !best ||
      gapMm < best.gapMm ||
      (gapMm === best.gapMm && candidate.id.localeCompare(best.wallId) < 0)
    ) {
      best = { wallId: candidate.id, xMm, gapMm };
    }
  }

  return best ? { wallId: best.wallId, xMm: best.xMm } : null;
}

// The along-wall distance on `toWallId` of the point that sits at `fromXMm`
// along `fromWallId` — the store's move-sync primitive for keeping a paired
// opening mirrored onto its twin. Returns null when either wall is missing or
// degenerate. Anti-parallel twins run in opposite directions, so this naturally
// yields the mirrored local x (near-`length − fromXMm` for a coincident twin).
export function mirrorOpeningXMm(
  project: Project,
  fromWallId: string,
  toWallId: string,
  fromXMm: number
): number | null {
  const walls = getFloorWalls(project.floor);
  const from = walls.find((wall) => wall.id === fromWallId);
  const to = walls.find((wall) => wall.id === toWallId);
  if (!from || !to || from.lengthMm <= 0 || to.lengthMm <= 0) return null;

  const fromCenterMm = pointAlong(from.startFloorMm, floorWallDirection(from), fromXMm);
  return projectPointToWall(fromCenterMm, to).xAlongMm;
}

// The room that owns a wall id (perimeter walls are listed on the room record).
// Faces belong to a room too but are excluded from twin candidacy upstream.
function roomIdOfWall(project: Project, wallId: string): string | null {
  for (const placement of project.floor.rooms) {
    if (placement.room.walls.some((wall) => wall.id === wallId)) return placement.roomId;
  }
  return null;
}
