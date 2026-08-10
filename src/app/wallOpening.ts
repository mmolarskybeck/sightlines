import { getWallOpenEligibility } from "../domain/geometry/wallCascade";
import type { Project } from "../domain/project";
import { isEditableTarget } from "./hooks/isEditableTarget";
import { pickedWallIdOf, type Selection } from "./store/selectionSlice";

// Pure helpers behind the open-wall confirmation, mirroring roomDeletion.ts.
// Everything here derives from getWallOpenEligibility so the copy can never
// describe a different cascade than the one that actually runs.

// Returns the wall the Delete key owns, or null when something else does.
//
// Reads the SELECTION UNION, never wallContextId. getSelectedWall falls back to
// walls[0], so the inspector always displays some wall — keying a destructive
// action off the displayed wall would let Delete remove a wall the user never
// picked. The reshape guard is load-bearing: PlanView mounts a second window
// keydown listener for vertex merge while edit-shape is armed.
export function shouldOpenWallOnKey({
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
  return pickedWallIdOf(selection);
}

// The two fates are separate fields on purpose: artworks are unhung (the work
// survives, its placement doesn't), everything else is deleted outright. The
// copy formatter must never merge them into one count.
export type WallContentsSummary = {
  artworks: number;
  doors: number;
  windows: number;
  blockedZones: number;
  wallTexts: number;
  cases: number;
  measurements: number;
  isEmpty: boolean;
};

// Always "ready" now: opening a wall opens exactly that wall, and a counterpart
// that outruns it is split rather than refused. The remaining blocked reasons
// (missing / partition face / already open) are inert no-ops that resolve to a
// null request, so no dialog is ever shown for them.
export type OpenWallRequest = {
  wallId: string;
  wallName: string;
  roomName: string;
  summary: WallContentsSummary;
  sharedRoomNames: string[];
  // A counterpart runs past this wall and will be split so only the segment
  // behind it opens. Worth saying — it changes the neighbour's wall count.
  willSplit: boolean;
};

function findWall(project: Project, wallId: string) {
  for (const placement of project.floor.rooms) {
    const wall = placement.room.walls.find((candidate) => candidate.id === wallId);
    if (wall) return { placement, wall };
  }
  return null;
}

// Builds everything the dialog needs, or null when the wall can't be opened for
// a reason the user never needs explained (missing id, partition face, already
// open). A null request simply leaves the dialog closed, which is also how a
// stale pending id — after an undo or a room delete — resolves safely.
export function buildOpenWallRequest(
  project: Project,
  wallId: string
): OpenWallRequest | null {
  const found = findWall(project, wallId);
  if (!found) return null;

  const wallName = found.wall.name;
  const roomName = found.placement.room.name;
  const eligibility = getWallOpenEligibility(project, wallId);
  if (eligibility.status === "blocked") return null;

  const { scope } = eligibility;
  const counted = new Set<string>();
  const summary: WallContentsSummary = {
    artworks: 0,
    doors: 0,
    windows: 0,
    blockedZones: 0,
    wallTexts: 0,
    cases: 0,
    measurements: scope.removedMeasurementIds.size,
    isEmpty: true
  };

  for (const wallObject of project.wallObjects) {
    if (!scope.removedObjectIds.has(wallObject.id)) continue;
    // A shared door is TWO stored objects but ONE physical opening. Counting
    // both would tell the user two doors are going when only one hole is.
    if (
      (wallObject.kind === "door" || wallObject.kind === "window") &&
      wallObject.connectsToObjectId !== undefined
    ) {
      const pairKey = [wallObject.id, wallObject.connectsToObjectId].sort().join("|");
      if (counted.has(pairKey)) continue;
      counted.add(pairKey);
    }

    if (wallObject.kind === "artwork") summary.artworks += 1;
    else if (wallObject.kind === "door") summary.doors += 1;
    else if (wallObject.kind === "window") summary.windows += 1;
    else if (wallObject.kind === "blocked-zone") summary.blockedZones += 1;
    else if (wallObject.kind === "wall-text") summary.wallTexts += 1;
    else if (wallObject.kind === "case") summary.cases += 1;
  }

  summary.isEmpty =
    summary.artworks +
      summary.doors +
      summary.windows +
      summary.blockedZones +
      summary.wallTexts +
      summary.cases +
      summary.measurements ===
    0;

  return {
    wallId,
    wallName,
    roomName,
    summary,
    sharedRoomNames: scope.sharedRoomNames,
    willSplit: scope.willSplit
  };
}

// Same list grammar as describeRoomContents: "a", "a and b", "a, b, and c".
function joinNaturally(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

// The works that go back to the checklist, unplaced.
export function describeUnhungWorks(summary: WallContentsSummary): string {
  if (summary.artworks === 0) return "";
  return summary.artworks === 1
    ? "1 work hung here goes back to the checklist, unplaced."
    : `${summary.artworks} works hung here go back to the checklist, unplaced.`;
}

// Everything that is deleted outright — deliberately a different sentence with
// a different verb, so a reader skimming cannot conflate the two fates.
export function describeDeletedFixtures(summary: WallContentsSummary): string {
  const parts: string[] = [];
  const push = (count: number, singular: string, plural = `${singular}s`) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  };
  push(summary.doors, "door");
  push(summary.windows, "window");
  push(summary.blockedZones, "blocked zone");
  push(summary.wallTexts, "wall label");
  push(summary.cases, "display case");
  push(summary.measurements, "measurement");

  if (parts.length === 0) return "";
  const total =
    summary.doors +
    summary.windows +
    summary.blockedZones +
    summary.wallTexts +
    summary.cases +
    summary.measurements;
  return `${joinNaturally(parts)} on this wall ${total === 1 ? "is" : "are"} deleted.`;
}

// The consequence for the OTHER side of the boundary.
//
// Two shapes, because the two directions genuinely differ. When the
// counterpart is fully behind this wall it simply opens too. When it runs
// past — an alcove's wall against a long gallery wall — it is split first so
// only the matching segment opens, and saying so matters: the neighbour's wall
// count changes, and its room stops reading as a plain rectangle.
export function describeSharedRooms(roomNames: string[], willSplit: boolean): string {
  if (roomNames.length === 0) return "";
  const rooms = joinNaturally(roomNames);
  const plural = roomNames.length > 1;

  if (willSplit) {
    return `This wall backs ${rooms}. That ${
      plural ? "walls are" : "wall is"
    } longer, so it will be split and only the part behind this wall opens — creating an open connection between the rooms.`;
  }
  return `This wall is shared with ${rooms} — opening it opens both sides, creating an open connection between the rooms.`;
}
