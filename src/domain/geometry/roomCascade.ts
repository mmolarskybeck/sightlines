import type { Project } from "../project";
import { clearOpeningPartners } from "../placement/openingPairs";
import { faceWallIdsOf } from "./freestandingWalls";

// The single home for the room-deletion cascade rule. Deleting a room prunes
// every wallObject that hangs on the room — both on its perimeter walls AND on
// its partitions' faces (spec §6.5) — and clears any surviving opening's
// dangling partner ref. store.deleteRoom and roomDeletion.summarizeRoomContents
// both derive scope from here so the rule can't drift between the actual delete
// and the confirm dialog's copy.

export type RoomCascadeScope = {
  wallIds: Set<string>; // perimeter wall ids of the room
  faceIds: Set<string>; // partition face ids (both faces per partition)
  cascadedWallObjectIds: Set<string>; // wallObjects on either set
};

// Scope of what a room deletion cascades away, for the given room. Returns
// empty sets when the room is not on the floor.
export function getRoomCascadeScope(project: Project, roomId: string): RoomCascadeScope {
  const roomPlacement = project.floor.rooms.find(
    (placement) => placement.roomId === roomId
  );
  const wallIds = new Set<string>();
  const faceIds = new Set<string>();
  const cascadedWallObjectIds = new Set<string>();
  if (!roomPlacement) return { wallIds, faceIds, cascadedWallObjectIds };

  for (const wall of roomPlacement.room.walls) wallIds.add(wall.id);
  // Objects also hang on the room's partition faces — those ids join the
  // cascade so the prune reaches them too.
  for (const partition of roomPlacement.room.freestandingWalls) {
    for (const faceId of faceWallIdsOf(partition.id)) faceIds.add(faceId);
  }
  for (const wallObject of project.wallObjects) {
    if (wallIds.has(wallObject.wallId) || faceIds.has(wallObject.wallId)) {
      cascadedWallObjectIds.add(wallObject.id);
    }
  }
  return { wallIds, faceIds, cascadedWallObjectIds };
}

// Pure core of store.deleteRoom: drop the room from floor.rooms, prune the
// cascaded wallObjects, and clear any surviving partner's connectsToObjectId
// that pointed at a removed opening. Deliberately leaves floorObjects untouched
// — the delete action does not remove floor objects, and this preserves that
// exactly. Returns the removed wallObject ids so the store can run its own
// selection/wallContext bookkeeping against them.
export function deleteRoomFromProject(
  project: Project,
  roomId: string
): { project: Project; removedObjectIds: Set<string> } {
  const scope = getRoomCascadeScope(project, roomId);
  const removedObjectIds = scope.cascadedWallObjectIds;

  const nextRooms = project.floor.rooms.filter(
    (placement) => placement.roomId !== roomId
  );
  const survivingWallObjects = project.wallObjects.filter(
    (wallObject) => !removedObjectIds.has(wallObject.id)
  );
  const nextProject: Project = {
    ...project,
    floor: { rooms: nextRooms },
    // Clear any surviving partner's connectsToObjectId that pointed at a
    // removed opening, so no dangling pairing ref persists.
    wallObjects: clearOpeningPartners(survivingWallObjects, removedObjectIds)
  };
  return { project: nextProject, removedObjectIds };
}
