import { getRoomCascadeScope } from "../domain/geometry/roomCascade";
import { getPlacedRoomBounds } from "../domain/geometry/walls";
import type { Project, RoomPlacement } from "../domain/project";
import { isEditableTarget } from "./hooks/isEditableTarget";
import { roomIdOf, type Selection } from "./store/selectionSlice";

// The Delete/Backspace → delete-room decision, factored out of App's keydown
// chain so it's unit-testable without a full App mount (same reasoning as the
// selectionSlice helpers). Returns the room to delete, or null when the
// shortcut must not fire. The selection union already makes the exclusivity
// guards structural:
//   - objects/partition selections are different `kind`s (and App's chain
//     handles them BEFORE this runs, keeping their priority);
//   - a wall focus is NOT a whole-room selection — selectWall writes
//     NO_SELECTION plus wallContextId, so kind "room" never coexists with a
//     selected wall. wallContextId itself is sidebar context that persists
//     under a room selection, so it deliberately does NOT block deletion.
// Edit-shape mode owns Delete for vertex removal (PlanView's armed handler),
// so an armed reshapeRoomId always wins over room deletion. Focused inputs
// keep the key for text editing (LengthFields use Backspace).
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

// What deleting this room would cascade away, bucketed for the confirm
// dialog's copy. The wall/face-object scope comes from getRoomCascadeScope —
// the same domain rule the actual delete uses — so the dialog can't drift from
// what deleteRoom removes. Floor objects within the placed bounds are counted
// here for the copy ONLY: the delete action deliberately does NOT remove floor
// objects, so this count overstates what actually disappears. That discrepancy
// is intentional dialog copy (the same derivation App uses for RoomInspector's
// counts) and is left as-is. Partitions are counted from the room itself.
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

// "4 artworks and 2 doors" / "1 artwork, 1 window, and 1 partition" — zero
// categories are omitted; the caller composes the surrounding sentence. Empty
// contents never reach this (empty rooms delete without a dialog).
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
