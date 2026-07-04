import { getWallsWithGeometry, type WallWithGeometry } from "../geometry/walls";
import type { Project, WallObject } from "../project";

export type PlacementWarning = {
  id: string;
  wallObjectId: string;
  wallId: string;
  message: string;
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
          message: "Placement references a wall that no longer exists."
        }
      ];
    }

    return validateWallObjectBounds(wallObject, wall.lengthMm, wall.heightMm);
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
      message: "Placement extends beyond the wall's length."
    });
  }

  if (bottomMm < 0 || topMm > wallHeightMm) {
    warnings.push({
      id: `${wallObject.id}:vertical-bounds`,
      wallObjectId: wallObject.id,
      wallId: wallObject.wallId,
      message: "Placement is outside the wall height."
    });
  }

  return warnings;
}
