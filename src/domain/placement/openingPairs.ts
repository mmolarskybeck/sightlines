import type { WallObject } from "../project";

// Doorway pairing lives here. This module is the home for the doorway-pairing
// writers landing in slice 4 (the code that SETS connectsToObjectId when two
// openings on facing walls pair up). For now it owns the one pairing-aware
// cascade that already ships: clearing dangling partner refs when openings are
// removed.
//
// After openings are deleted (directly or via a wall/room/partition cascade),
// clear any surviving door/window's connectsToObjectId that pointed at one of
// them, so no dangling pairing ref ever persists (spec §5.5). No writers set
// connectsToObjectId until slice 4, so today this is a no-op in practice — but
// the cascade is here so the invariant holds the moment pairing ships.
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
