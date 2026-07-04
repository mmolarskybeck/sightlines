import { getWallsWithGeometry, type WallWithGeometry } from "../geometry/walls";
import type { Project, WallObject } from "../project";
import { doWallObjectsOverlap } from "./collision";

export type PlacementWarning = {
  id: string;
  wallObjectId: string;
  wallId: string;
  message: string;
  // "collision" warnings are the ones a caller can choose to block on (an
  // artwork/opening overlap, by default disallowed — see store.ts's
  // allowOverlappingPlacement). "bounds" warnings (off the wall's edges, or
  // a dangling wall reference) stay advisory only; there's no "override" for
  // a placement that isn't on the wall at all.
  type: "bounds" | "collision";
};

export function validateChangedWallPlacements(
  project: Project,
  changedWallIds: string[]
): PlacementWarning[] {
  if (changedWallIds.length === 0 || project.wallObjects.length === 0) {
    return [];
  }

  const changedWallIdSet = new Set(changedWallIds);
  const wallObjects = project.wallObjects.filter((wallObject) =>
    changedWallIdSet.has(wallObject.wallId)
  );

  return validateWallObjects(project, wallObjects);
}

// Validates specific wall objects (by id) against their wall's current
// geometry — the same bounds check as validateChangedWallPlacements, just
// keyed by wall object rather than by which walls just changed. Used after a
// fresh placement or move, where there's no "changed wall" to key off of.
export function validateWallObjectPlacements(
  project: Project,
  wallObjectIds: string[]
): PlacementWarning[] {
  if (wallObjectIds.length === 0 || project.wallObjects.length === 0) {
    return [];
  }

  const wallObjectIdSet = new Set(wallObjectIds);
  const wallObjects = project.wallObjects.filter((wallObject) =>
    wallObjectIdSet.has(wallObject.id)
  );

  return validateWallObjects(project, wallObjects);
}

function validateWallObjects(project: Project, wallObjects: WallObject[]): PlacementWarning[] {
  if (wallObjects.length === 0) return [];

  const wallGeometryById = new Map<string, WallWithGeometry>(
    project.floor.rooms.flatMap((placement) =>
      getWallsWithGeometry(placement.room).map((wall) => [wall.id, wall])
    )
  );

  return wallObjects.flatMap((wallObject) => {
    const wall = wallGeometryById.get(wallObject.wallId);
    if (!wall) {
      return [
        {
          id: `${wallObject.id}:missing-wall`,
          wallObjectId: wallObject.id,
          wallId: wallObject.wallId,
          message: "Placement references a wall that no longer exists.",
          type: "bounds"
        }
      ];
    }

    return [
      ...validateWallObjectBounds(wallObject, wall.lengthMm, wall.heightMm),
      ...validateWallObjectCollisions(wallObject, project.wallObjects)
    ];
  });
}

function validateWallObjectBounds(
  wallObject: WallObject,
  wallLengthMm: number,
  wallHeightMm: number
): PlacementWarning[] {
  const warnings: PlacementWarning[] = [];
  const leftMm = wallObject.xMm - wallObject.widthMm / 2;
  const rightMm = wallObject.xMm + wallObject.widthMm / 2;
  const bottomMm = wallObject.yMm - wallObject.heightMm / 2;
  const topMm = wallObject.yMm + wallObject.heightMm / 2;

  if (leftMm < 0 || rightMm > wallLengthMm) {
    warnings.push({
      id: `${wallObject.id}:horizontal-bounds`,
      wallObjectId: wallObject.id,
      wallId: wallObject.wallId,
      message: "Placement extends beyond the wall's length.",
      type: "bounds"
    });
  }

  if (bottomMm < 0 || topMm > wallHeightMm) {
    warnings.push({
      id: `${wallObject.id}:vertical-bounds`,
      wallObjectId: wallObject.id,
      wallId: wallObject.wallId,
      message: "Placement is outside the wall height.",
      type: "bounds"
    });
  }

  return warnings;
}

// Flags an artwork that overlaps a door/window/blocked-zone on the same
// wall, and symmetrically flags an opening that overlaps an artwork —
// whichever side was actually moved gets the warning attached to it. This is
// detection only: the store decides what to do with a "collision" warning
// (by default, reject the edit — see allowOverlappingPlacement in store.ts).
// Two openings overlapping each other (e.g. a door inside a blocked zone)
// isn't checked — out of scope for this slice, which is about protecting
// artwork placements from real obstacles.
function validateWallObjectCollisions(
  wallObject: WallObject,
  allWallObjects: WallObject[]
): PlacementWarning[] {
  const others = allWallObjects.filter(
    (other) =>
      other.id !== wallObject.id &&
      other.wallId === wallObject.wallId &&
      isBlockingPair(wallObject, other)
  );

  return others
    .filter((other) => doWallObjectsOverlap(wallObject, other))
    .map((other) => ({
      id: `${wallObject.id}:collision:${other.id}`,
      wallObjectId: wallObject.id,
      wallId: wallObject.wallId,
      message: "Placement overlaps another object on this wall.",
      type: "collision" as const
    }));
}

// Only an artwork/obstacle pair is a real conflict — an obstacle is never
// blocked by another obstacle, and two artworks overlapping is a separate,
// not-yet-built concern (multi-select/grouping, docs/plan.md's MVP1C list).
function isBlockingPair(a: WallObject, b: WallObject): boolean {
  return (a.kind === "artwork") !== (b.kind === "artwork");
}
