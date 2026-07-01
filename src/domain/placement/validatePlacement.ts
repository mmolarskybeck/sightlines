import { getWallsWithGeometry } from "../geometry/walls";
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
  const wallGeometryById = new Map(
    project.floor.rooms.flatMap((placement) =>
      getWallsWithGeometry(placement.room).map((wall) => [wall.id, wall])
    )
  );

  return project.wallObjects.flatMap((wallObject) => {
    if (!changedWallIdSet.has(wallObject.wallId)) return [];

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
      message: "Placement is outside the resized wall length."
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
