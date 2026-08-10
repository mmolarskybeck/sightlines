import { getRoomPlaceableWalls } from "../geometry/placeableWalls";
import type { WallWithGeometry } from "../geometry/walls";
import type { Project, WallObject } from "../project";
import { doWallObjectsOverlap } from "./collision";
import { getOverlapRule } from "./overlapPolicy";

export type PlacementWarning = {
  id: string;
  wallObjectId: string;
  wallId: string;
  message: string;
  // "overlap" is read-only compatibility for older persisted warnings.
  type: "bounds" | "collision" | "overlap";
  // Present only for collisions; false for non-artwork pairs.
  overridable?: boolean;
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

// Validates placements by wall-object id rather than changed wall id.
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

  // Partition faces have distinct ids, so back-to-back objects do not collide.
  const wallGeometryById = new Map<string, WallWithGeometry>(
    project.floor.rooms.flatMap((placement) =>
      getRoomPlaceableWalls(placement.room).map((wall) => [wall.id, wall])
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

    // Safety net, not a normal path: the open-wall cascade clears everything
    // off the wall, so this only fires for a hand-edited document or one
    // written by a build that predates the flag. Deliberately a runtime
    // advisory rather than a schema refinement — rejecting at parse would make
    // such a document permanently unopenable.
    if (wall.isOpenSide === true) {
      return [
        {
          id: `${wallObject.id}:open-wall`,
          wallObjectId: wallObject.id,
          wallId: wallObject.wallId,
          message: "This wall is open — nothing can hang on it.",
          type: "bounds" as const
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

// Report each overlapping same-wall pair against the object being revalidated.
function validateWallObjectCollisions(
  wallObject: WallObject,
  allWallObjects: WallObject[]
): PlacementWarning[] {
  const sameWallOthers = allWallObjects.filter(
    (other) => other.id !== wallObject.id && other.wallId === wallObject.wallId
  );

  return sameWallOthers
    .filter((other) => doWallObjectsOverlap(wallObject, other))
    .map((other) => {
      const overridable = getOverlapRule(wallObject.kind, other.kind) === "blockable";
      return {
        id: `${wallObject.id}:collision:${other.id}`,
        wallObjectId: wallObject.id,
        wallId: wallObject.wallId,
        message: collisionMessage(wallObject, other),
        type: "collision" as const,
        overridable
      };
    });
}

function collisionMessage(a: WallObject, b: WallObject): string {
  // Word the message from the same policy that decides overridability
  // (getOverlapRule), not a standalone artwork check — otherwise a
  // door/wall-text collision (now blockable) would still read as the
  // forbidden "can't overlap" message.
  if (getOverlapRule(a.kind, b.kind) === "forbidden") {
    return "Doors, windows and blocked zones can't overlap.";
  }
  if (a.kind === "artwork" && b.kind === "artwork") {
    return "Artworks overlap on this wall.";
  }
  return "Placement overlaps another object on this wall.";
}
