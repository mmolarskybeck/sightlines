import type { DoorLeaf, Project } from "../project";
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

// Two walls must share more than this much run to count as one physical
// boundary. Deliberately a bare geometry epsilon rather than a meaningful
// threshold: openings may have any positive width, so no opening-derived number
// belongs in wall topology. A partly-shared wall is handled where it should be
// — an opening that misses the shared run entirely is exterior, and one that
// straddles its edge is an overhang — so this only has to exclude walls that
// touch at a mathematical point.
export const SHARED_BOUNDARY_MIN_OVERLAP_MM = 1;

// One wall that faces `wallId` across a shared physical boundary. `commonMinMm`
// / `commonMaxMm` are the run the two walls have in common, expressed in the
// SOURCE wall's local x — the interval an opening on this wall must lie inside
// to be a shared opening rather than an exterior one.
export type SharedBoundary = {
  wallId: string;
  gapMm: number;
  angleDeg: number;
  commonMinMm: number;
  commonMaxMm: number;
};

// Deliberately three-valued. Two rooms whose walls both back the same run is a
// state the app cannot resolve on its own, and silently taking the nearer one
// (which is what the old tie-break did) picks a room for the user.
export type SharedBoundaryResult =
  | { status: "none" }
  | { status: "confirmed"; boundary: SharedBoundary }
  | { status: "ambiguous"; boundaries: SharedBoundary[] };

type WallGeometry = ReturnType<typeof getFloorWalls>[number];

// The pairwise boundary test, with no reference to any opening. Returns null
// when these two walls are not two faces of one physical boundary.
function boundaryBetween(
  project: Project,
  source: WallGeometry,
  candidate: WallGeometry
): SharedBoundary | null {
  if (candidate.id === source.id) return null;
  if (source.lengthMm <= 0 || candidate.lengthMm <= 0) return null;
  // Perimeter walls only; a candidate on the same room can't be an abutment.
  if (parseFaceWallId(source.id) !== null) return null;
  if (parseFaceWallId(candidate.id) !== null) return null;
  if (roomIdOfWall(project, candidate.id) === roomIdOfWall(project, source.id)) return null;

  const sourceDir = floorWallDirection(source);
  const candidateDir = floorWallDirection(candidate);

  // Abutting room loops are anti-parallel: measure deviation from an exact
  // anti-parallel dot (-1), same as evaluateOpeningPair. A co-directional match
  // is not a shared wall.
  const directionDot = clamp(dot(sourceDir, candidateDir), -1, 1);
  const angleDeg = (Math.acos(-directionDot) * 180) / Math.PI;
  if (angleDeg > OPENING_PAIR_ANGLE_TOLERANCE_DEG) return null;

  // The candidate's endpoints projected onto the source axis. Anti-parallel
  // walls project in reverse order, so re-derive min/max rather than assuming
  // start < end — the same order-reversal trap mirrorOpeningXMm documents.
  const candidateEndMm = pointAlong(candidate.startFloorMm, candidateDir, candidate.lengthMm);
  const projectedA = projectScalar(candidate.startFloorMm, source.startFloorMm, sourceDir);
  const projectedB = projectScalar(candidateEndMm, source.startFloorMm, sourceDir);

  const commonMinMm = Math.max(0, Math.min(projectedA, projectedB));
  const commonMaxMm = Math.min(source.lengthMm, Math.max(projectedA, projectedB));
  if (commonMaxMm - commonMinMm < SHARED_BOUNDARY_MIN_OVERLAP_MM) return null;

  // Separation measured at BOTH ENDS of the shared run, not its midpoint. The
  // walls are only near-parallel — up to OPENING_PAIR_ANGLE_TOLERANCE_DEG apart
  // — so they splay, and a midpoint comfortably inside the tolerance can hide an
  // end that is well outside it. Taking the worst end is what makes the reported
  // gap an actual bound on the whole run, so an opening near the far end cannot
  // become a twin across a gap wider than the settled tolerance.
  //
  // Each end is measured symmetrically (point-to-opposite-line in both
  // directions) so the result cannot depend on which wall is called the source.
  const separationAt = (alongMm: number): number => {
    const onSource = pointAlong(source.startFloorMm, sourceDir, alongMm);
    const onCandidate = projectPointToWall(onSource, candidate).pointOnWallMm;
    return Math.max(
      pointToLineDistance(onSource, candidate.startFloorMm, candidateDir),
      pointToLineDistance(onCandidate, source.startFloorMm, sourceDir)
    );
  };
  const gapMm = Math.max(separationAt(commonMinMm), separationAt(commonMaxMm));
  if (gapMm > OPENING_PAIR_MAX_GAP_MM) return null;

  return { wallId: candidate.id, gapMm, angleDeg, commonMinMm, commonMaxMm };
}

// Every wall facing `wallId` across a shared boundary. Takes no opening
// dimensions on purpose: whether two walls are one physical boundary must not
// depend on whether some particular door happens to fit it, or resizing a door
// would change the topology of its own room.
export function findSharedBoundary(project: Project, wallId: string): SharedBoundaryResult {
  const walls = getFloorWalls(project.floor);
  const source = walls.find((wall) => wall.id === wallId);
  if (!source) return { status: "none" };

  const boundaries: SharedBoundary[] = [];
  for (const candidate of walls) {
    const boundary = boundaryBetween(project, source, candidate);
    if (boundary) boundaries.push(boundary);
  }

  if (boundaries.length === 0) return { status: "none" };
  if (boundaries.length === 1) return { status: "confirmed", boundary: boundaries[0] };

  boundaries.sort((a, b) => a.wallId.localeCompare(b.wallId));
  return { status: "ambiguous", boundaries };
}

// Whether these two specific walls are the two faces of one physical boundary.
//
// Deliberately NOT "is B the confirmed result of findSharedBoundary(A)". A
// third wall near the same run makes *discovery* ambiguous, but it says nothing
// about the A-B relationship — routing this through discovery would turn an
// already-resolved pair into a boundary-lost conflict the moment an unrelated
// room moved nearby.
export function areSharedBoundaryWalls(
  project: Project,
  wallIdA: string,
  wallIdB: string
): boolean {
  const walls = getFloorWalls(project.floor);
  const a = walls.find((wall) => wall.id === wallIdA);
  const b = walls.find((wall) => wall.id === wallIdB);
  if (!a || !b) return false;
  return boundaryBetween(project, a, b) !== null;
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

// The same hung leaf, described from the TWIN wall's frame — the handing half
// of mirrorOpeningXMm, and it lives here for the same reason: it is a fact
// about coincident twin walls, not about doors.
//
// BOTH flags invert, and it is worth being explicit about why, because
// inverting one is the obvious wrong answer:
//   - `hingeAtStart` flips because the twins are ANTI-PARALLEL, so the jamb
//     nearer one wall's start vertex is the jamb nearer the other's end;
//   - `swingsToLeft` flips because the twins face OPPOSITE interiors, so the
//     left of one wall's direction is the right of the other's.
// The two inversions compose to the identity in world space: the leaf stays in
// the same physical quadrant seen from either room, which is the whole point.
export function mirrorDoorLeaf(leaf: DoorLeaf): DoorLeaf {
  return { hingeAtStart: !leaf.hingeAtStart, swingsToLeft: !leaf.swingsToLeft };
}

// Structural equality for the equality guards on the leaf-sync paths, where
// `undefined` (a plain doorway) is a meaningful value on both sides.
export function sameDoorLeaf(a: DoorLeaf | undefined, b: DoorLeaf | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.hingeAtStart === b.hingeAtStart && a.swingsToLeft === b.swingsToLeft;
}

// The room that owns a wall id (perimeter walls are listed on the room record).
// Faces belong to a room too but are excluded from twin candidacy upstream.
function roomIdOfWall(project: Project, wallId: string): string | null {
  for (const placement of project.floor.rooms) {
    if (placement.room.walls.some((wall) => wall.id === wallId)) return placement.roomId;
  }
  return null;
}
