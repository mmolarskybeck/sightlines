import type { Project, Room, RoomPlacement, Wall } from "../project";
import { clearOpeningPartners, includePairedOpenings } from "../placement/openingPairs";
import { parseFaceWallId } from "./freestandingWalls";
import { getFloorWalls } from "./planObjects";
import { splitWall } from "./reshapeRoom";
import { findSharedBoundary, type SharedBoundary } from "./sharedWalls";

// The single home for the open-wall cascade rule, mirroring roomCascade.ts.
// Opening a wall removes its SURFACE while the wall record stays in the closed
// loop: artworks are unhung (their placement goes, the checklist row stays),
// every fixture on it is deleted, and its elevation reference measurements go
// with it. store.openWall and the confirm dialog's copy both derive from
// getWallOpenEligibility so the rule can't drift between what we say and what
// we do.

// A split point closer than this to a wall's end is not a split at all — it is
// the end. Matches reshapeRoom's own MIN_VERTEX_SPACING_MM, which is also the
// floor splitWall enforces, so planning against it means we never ask for a
// split splitWall would reject.
const MIN_VERTEX_SPACING_MM = 10;

function boundariesOf(project: Project, wallId: string): SharedBoundary[] {
  const result = findSharedBoundary(project, wallId);
  if (result.status === "none") return [];
  return result.status === "confirmed" ? [result.boundary] : result.boundaries;
}

// How much of one counterpart backs the wall being opened, in the
// COUNTERPART's own local x.
//
// The reciprocal lookup is essential, not belt-and-braces: SharedBoundary's
// commonMin/MaxMm are expressed in the SOURCE wall's local x only, so asking
// the opened wall tells us which run of ITSELF is shared — never which run of
// the neighbour is.
export type CounterpartBacking = {
  wallId: string;
  loMm: number;
  hiMm: number;
  lengthMm: number;
  // The counterpart lies entirely within the opened wall's run, so it opens
  // whole and needs no split.
  coversWholeWall: boolean;
};

export function getCounterpartBackings(
  project: Project,
  wallId: string
): CounterpartBacking[] {
  const walls = getFloorWalls(project.floor);
  const source = walls.find((wall) => wall.id === wallId);
  if (!source || source.lengthMm <= 0) return [];

  const backings: CounterpartBacking[] = [];
  for (const boundary of boundariesOf(project, wallId)) {
    const candidate = walls.find((wall) => wall.id === boundary.wallId);
    if (!candidate || candidate.lengthMm <= 0) continue;

    const reciprocal = boundariesOf(project, candidate.id).find(
      (other) => other.wallId === wallId
    );
    if (!reciprocal) continue;

    // Clamp the shared run to the counterpart, then treat anything within a
    // vertex-spacing of an end AS that end — a 3mm stub is not a wall.
    const rawLo = Math.max(0, reciprocal.commonMinMm);
    const rawHi = Math.min(candidate.lengthMm, reciprocal.commonMaxMm);
    const loMm = rawLo <= MIN_VERTEX_SPACING_MM ? 0 : rawLo;
    const hiMm =
      rawHi >= candidate.lengthMm - MIN_VERTEX_SPACING_MM ? candidate.lengthMm : rawHi;
    if (hiMm - loMm <= MIN_VERTEX_SPACING_MM) continue;

    backings.push({
      wallId: candidate.id,
      loMm,
      hiMm,
      lengthMm: candidate.lengthMm,
      coversWholeWall: loMm === 0 && hiMm === candidate.lengthMm
    });
  }
  return backings;
}

export type WallOpenScope = {
  // The selected wall, plus every counterpart that opens WHOLE. A counterpart
  // that only partly backs the selection is not here — it gets split first, and
  // its middle segment's id doesn't exist until then (see openWallInProject).
  wallIds: Set<string>;
  // Counterparts and how much of each backs the selected wall.
  backings: CounterpartBacking[];
  // At least one counterpart extends past the selected wall and will be split.
  willSplit: boolean;
  // Artwork placements: dropped, but the work stays on the checklist as
  // unplaced (checklistArtworkIds is never touched by placement removal).
  unhungArtworkObjectIds: Set<string>;
  // Doors, windows, blocked zones, wall text and cases: gone for good.
  deletedFixtureObjectIds: Set<string>;
  // The union, expanded across shared-opening pairs. A door's other half can
  // live on a wall that is NOT being opened, and it must still die.
  removedObjectIds: Set<string>;
  removedMeasurementIds: Set<string>;
  // Rooms losing wall on the other side of the boundary, for the confirm copy.
  sharedRoomNames: string[];
};

// Whether this wall can be opened at all. A discriminated result rather than a
// flag on an otherwise-usable scope, so an ineligible wall is unrepresentable
// as input to the mutation instead of merely discouraged.
//
// All three are inert no-ops the UI never opens a dialog for. There is
// deliberately no "partial"/"ambiguous" refusal: opening a wall opens exactly
// that wall, and any counterpart that outruns it is split rather than refused.
export type WallOpenBlockedReason = "missing" | "partition-face" | "already-open";

export type WallOpenEligibility =
  | { status: "ready"; scope: WallOpenScope }
  | { status: "blocked"; reason: WallOpenBlockedReason };

function findWall(project: Project, wallId: string): { placement: RoomPlacement; wall: Wall } | null {
  for (const placement of project.floor.rooms) {
    const wall = placement.room.walls.find((candidate) => candidate.id === wallId);
    if (wall) return { placement, wall };
  }
  return null;
}

export function isWallOpen(project: Project, wallId: string): boolean {
  return findWall(project, wallId)?.wall.isOpenSide === true;
}

// "Can something hang here?" — the guard every placement and re-anchoring
// action funnels through. Partition faces are always hangable; only perimeter
// walls can be opened.
export function isHangableWall(project: Project, wallId: string): boolean {
  if (parseFaceWallId(wallId) !== null) return true;
  return !isWallOpen(project, wallId);
}

export function getOpenWallIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const placement of project.floor.rooms) {
    for (const wall of placement.room.walls) {
      if (wall.isOpenSide === true) ids.add(wall.id);
    }
  }
  return ids;
}

export function getWallOpenEligibility(project: Project, wallId: string): WallOpenEligibility {
  // Partitions are deleted, never opened — they are a different entity with a
  // different action, and their faces are derived ids that own no flag.
  if (parseFaceWallId(wallId) !== null) return { status: "blocked", reason: "partition-face" };

  const found = findWall(project, wallId);
  if (!found) return { status: "blocked", reason: "missing" };
  if (found.wall.isOpenSide === true) return { status: "blocked", reason: "already-open" };

  const backings = getCounterpartBackings(project, wallId);

  // Whole-opening counterparts are named up front; a partly-backing one is
  // split first, so its middle segment has no id yet.
  const wallIds = new Set<string>([wallId]);
  for (const backing of backings) {
    if (backing.coversWholeWall) wallIds.add(backing.wallId);
  }

  // Objects go if they sit on the selected wall, or on the BACKED RUN of a
  // counterpart. Testing the run by xMm here mirrors exactly how splitWall
  // repartitions objects, so the confirm copy counts what the edit removes.
  const doomed = new Set<string>();
  for (const wallObject of project.wallObjects) {
    if (wallObject.wallId === wallId) {
      doomed.add(wallObject.id);
      continue;
    }
    const backing = backings.find((candidate) => candidate.wallId === wallObject.wallId);
    if (!backing) continue;
    if (wallObject.xMm >= backing.loMm && wallObject.xMm <= backing.hiMm) {
      doomed.add(wallObject.id);
    }
  }

  const unhungArtworkObjectIds = new Set<string>();
  const deletedFixtureObjectIds = new Set<string>();
  for (const wallObject of project.wallObjects) {
    if (!doomed.has(wallObject.id)) continue;
    if (wallObject.kind === "artwork") unhungArtworkObjectIds.add(wallObject.id);
    else deletedFixtureObjectIds.add(wallObject.id);
  }

  const removedObjectIds = includePairedOpenings(project.wallObjects, doomed);

  const removedMeasurementIds = new Set<string>(
    (project.referenceMeasurements ?? [])
      .filter(
        (measurement) =>
          measurement.kind === "elevation" &&
          (measurement.wallId === wallId ||
            backings.some((backing) => backing.wallId === measurement.wallId))
      )
      .map((measurement) => measurement.id)
  );

  const sharedRoomNames: string[] = [];
  for (const backing of backings) {
    const name = roomNameOfWall(project, backing.wallId);
    if (name && !sharedRoomNames.includes(name)) sharedRoomNames.push(name);
  }

  return {
    status: "ready",
    scope: {
      wallIds,
      backings,
      willSplit: backings.some((backing) => !backing.coversWholeWall),
      unhungArtworkObjectIds,
      deletedFixtureObjectIds,
      removedObjectIds,
      removedMeasurementIds,
      sharedRoomNames
    }
  };
}

function roomNameOfWall(project: Project, wallId: string): string | null {
  return findWall(project, wallId)?.placement.room.name ?? null;
}

function withWallFlags(
  project: Project,
  wallIds: ReadonlySet<string>,
  open: boolean
): Project {
  const mapRoom = (room: Room): Room => ({
    ...room,
    walls: room.walls.map((wall) => {
      if (!wallIds.has(wall.id)) return wall;
      if (open) return { ...wall, isOpenSide: true };
      // Restore DELETES the key rather than writing false, so a restored wall
      // round-trips byte-identical to a pre-v5 document.
      const { isOpenSide: _closed, ...rest } = wall;
      return rest;
    })
  });

  return {
    ...project,
    floor: {
      rooms: project.floor.rooms.map((placement) => ({
        ...placement,
        room: mapRoom(placement.room)
      }))
    }
  };
}

export type WallOpenResult =
  | { status: "ready"; project: Project; scope: WallOpenScope }
  | { status: "blocked"; reason: WallOpenBlockedReason };

// Pure core of store.openWall. Returns the SAME discriminated shape as
// getWallOpenEligibility, so a blocked wall can never fall through to a
// mutation. Floor objects are deliberately untouched — they sit on the floor,
// not on the wall.
export function openWallInProject(project: Project, wallId: string): WallOpenResult {
  const eligibility = getWallOpenEligibility(project, wallId);
  if (eligibility.status === "blocked") return { status: "blocked", reason: eligibility.reason };

  const { scope } = eligibility;

  // Split any counterpart that outruns the selected wall, so only the segment
  // actually behind it opens. Splitting FIRST means the cascade below runs
  // against final wall ids and splitWall's own object repartitioning has
  // already put each object on the right segment.
  let working = project;
  const openIds = new Set<string>([wallId]);

  for (const backing of scope.backings) {
    if (backing.coversWholeWall) {
      openIds.add(backing.wallId);
      continue;
    }

    // Cut the FAR end first: splitWall keeps the original id on the near
    // segment, so cutting at `hi` and then at `lo` leaves the middle piece as
    // the second segment of the second cut — the one we want.
    let targetId = backing.wallId;
    if (backing.hiMm < backing.lengthMm) {
      const far = splitWall(working, targetId, backing.hiMm);
      working = far.project;
      // targetId still names [0, hi]; far.newWallId is the discarded tail.
    }
    if (backing.loMm > 0) {
      const near = splitWall(working, targetId, backing.loMm);
      working = near.project;
      targetId = near.newWallId; // [lo, hi] — the run behind the opened wall.
    }
    openIds.add(targetId);
  }

  // Re-derive the cascade against the POST-SPLIT project: object ids are stable
  // across a split but their wallId may have moved to a new segment.
  const doomed = new Set<string>();
  for (const wallObject of working.wallObjects) {
    if (openIds.has(wallObject.wallId)) doomed.add(wallObject.id);
  }
  const removedObjectIds = includePairedOpenings(working.wallObjects, doomed);
  const removedMeasurementIds = new Set<string>(
    (working.referenceMeasurements ?? [])
      .filter(
        (measurement) =>
          measurement.kind === "elevation" && openIds.has(measurement.wallId)
      )
      .map((measurement) => measurement.id)
  );

  const survivingWallObjects = working.wallObjects.filter(
    (wallObject) => !removedObjectIds.has(wallObject.id)
  );

  const flagged = withWallFlags(working, openIds, true);
  const nextProject: Project = {
    ...flagged,
    wallObjects: clearOpeningPartners(survivingWallObjects, removedObjectIds),
    referenceMeasurements: (working.referenceMeasurements ?? []).filter(
      (measurement) => !removedMeasurementIds.has(measurement.id)
    )
  };

  return {
    status: "ready",
    project: nextProject,
    scope: { ...scope, wallIds: openIds, removedObjectIds, removedMeasurementIds }
  };
}

// Restore is symmetric while the twins are still coincident, and re-resolves
// geometrically: if the rooms have since moved apart, only this wall closes and
// the former twin stays open, which is a valid state. Contents never come back
// — only undo restores them.
export function restoreWallInProject(
  project: Project,
  wallId: string
): { project: Project; wallIds: Set<string> } {
  const found = findWall(project, wallId);
  if (!found || found.wall.isOpenSide !== true) {
    return { project, wallIds: new Set() };
  }

  // Close this wall and every currently-open counterpart behind it. After an
  // open, a split counterpart's middle segment is an exact twin, so this closes
  // the pair symmetrically. It does NOT un-split: the extra vertices stay, and
  // undo is the way to reverse the split itself.
  const wallIds = new Set<string>([wallId]);
  for (const backing of getCounterpartBackings(project, wallId)) {
    if (isWallOpen(project, backing.wallId)) wallIds.add(backing.wallId);
  }

  return { project: withWallFlags(project, wallIds, false), wallIds };
}
