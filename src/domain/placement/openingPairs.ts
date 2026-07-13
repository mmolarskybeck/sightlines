import type { WallObject } from "../project";

// A shared-wall door/window is stored as two linked wall objects. Expand a set
// of requested deletions to include those paired twins so every direct-delete
// entrypoint preserves the full-sync contract.
export function includePairedOpenings(
  wallObjects: WallObject[],
  requestedIds: Iterable<string>
): Set<string> {
  const deletedIds = new Set(requestedIds);
  for (const wallObject of wallObjects) {
    if (
      deletedIds.has(wallObject.id) &&
      (wallObject.kind === "door" || wallObject.kind === "window") &&
      wallObject.connectsToObjectId !== undefined
    ) {
      deletedIds.add(wallObject.connectsToObjectId);
    }
  }
  return deletedIds;
}

// After openings are deleted via a room/wall cascade, clear any surviving
// door/window's partner pointer so no dangling reference persists.
export function clearOpeningPartners(
  wallObjects: WallObject[],
  deletedIds: Set<string>
): WallObject[] {
  if (deletedIds.size === 0) return wallObjects;
  return wallObjects.map((wallObject) => {
    if (
      (wallObject.kind === "door" || wallObject.kind === "window") &&
      wallObject.connectsToObjectId !== undefined &&
      deletedIds.has(wallObject.connectsToObjectId)
    ) {
      const { connectsToObjectId: _cleared, ...rest } = wallObject;
      return rest;
    }
    return wallObject;
  });
}
