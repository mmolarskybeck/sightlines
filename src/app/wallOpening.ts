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

// What happens to the things on the wall, in ONE sentence.
//
// Every fixture kind used to get its own count ("1 door, 2 windows, 1 wall
// label, and 1 measurement…"), which made the dialog read like an inventory
// report. The counts of doors and labels never change the decision — undo
// restores them and the wall is right there in elevation. The work count does
// change it, so that is the only number kept.
//
// The two fates still get their own clause with their own verb: works come
// back, everything else goes. A reader skimming must not think the works are
// being deleted.
export function describeWallContents(summary: WallContentsSummary): string {
  const fixtures =
    summary.doors +
    summary.windows +
    summary.blockedZones +
    summary.wallTexts +
    summary.cases +
    summary.measurements;

  if (summary.artworks === 0) {
    return fixtures === 0 ? "" : "Everything on the wall will be deleted.";
  }

  const works =
    summary.artworks === 1
      ? "1 work currently placed"
      : `${summary.artworks} works currently placed`;
  const unhung = `${works} will go back on the checklist, unplaced.`;
  // Two sentences, not one comma-spliced clause: the works survive and the
  // fixtures do not, and a sentence break is what keeps a skimmer from reading
  // the work count as part of "will be deleted".
  return fixtures === 0 ? unhung : `${unhung} Everything else on it will be deleted.`;
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
    return plural
      ? `The walls of ${rooms} run past this one. They will be split so only the shared parts open.`
      : `${rooms}’s wall runs past this one. It will be split so only the shared part opens.`;
  }
  return `${rooms} ${plural ? "share" : "shares"} this wall and will open too.`;
}
