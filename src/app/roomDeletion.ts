import { getRoomCascadeScope } from "../domain/geometry/roomCascade";
import { getPlacedRoomBounds } from "../domain/geometry/walls";
import type { Project, RoomPlacement } from "../domain/project";
import { isEditableTarget } from "./hooks/isEditableTarget";
import { roomIdOf, type Selection } from "./store/selectionSlice";

// Returns the room owned by Delete/Backspace, or null when another selection,
// focused editor, or reshape mode owns the key. Wall context does not block a
// room deletion because it is sidebar state, not a wall selection.
export function shouldDeleteRoomOnKey({
  eventTarget,
  reshapeRoomId,
  selection
}: {
  eventTarget: EventTarget | null;
  reshapeRoomId: string | null;
  selection: Selection;
}): string | null {
  if (isEditableTarget(eventTarget)) return null;
  if (reshapeRoomId) return null;
  return roomIdOf(selection);
}

// Contents summarized for confirmation copy. Floor objects inside the room are
// counted for context but are intentionally not deleted with the room.
export type RoomContentsSummary = {
  artworks: number;
  doors: number;
  windows: number;
  blockedZones: number;
  partitions: number;
  isEmpty: boolean;
};

export function summarizeRoomContents(
  project: Project,
  placement: RoomPlacement
): RoomContentsSummary {
  const { cascadedWallObjectIds } = getRoomCascadeScope(project, placement.roomId);
  const bounds = getPlacedRoomBounds(placement);

  let artworks = 0;
  let doors = 0;
  let windows = 0;
  let blockedZones = 0;

  for (const wallObject of project.wallObjects) {
    if (!cascadedWallObjectIds.has(wallObject.id)) continue;
    if (wallObject.kind === "artwork") artworks += 1;
    else if (wallObject.kind === "door") doors += 1;
    else if (wallObject.kind === "window") windows += 1;
    else blockedZones += 1;
  }
  for (const floorObject of project.floorObjects) {
    const inside =
      floorObject.xMm >= bounds.minX &&
      floorObject.xMm <= bounds.maxX &&
      floorObject.yMm >= bounds.minY &&
      floorObject.yMm <= bounds.maxY;
    if (!inside) continue;
    if (floorObject.kind === "artwork") artworks += 1;
    else blockedZones += 1;
  }

  const partitions = placement.room.freestandingWalls.length;
  return {
    artworks,
    doors,
    windows,
    blockedZones,
    partitions,
    isEmpty: artworks + doors + windows + blockedZones + partitions === 0
  };
}

// Formats nonzero categories for the confirmation sentence.
export function describeRoomContents(summary: RoomContentsSummary): string {
  const parts: string[] = [];
  const push = (count: number, singular: string, plural = `${singular}s`) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  };
  push(summary.artworks, "artwork");
  push(summary.doors, "door");
  push(summary.windows, "window");
  push(summary.blockedZones, "blocked zone");
  push(summary.partitions, "partition");

  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
