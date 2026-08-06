import { describe, expect, it, vi } from "vitest";
import { createRectangularRoomPlacement } from "../geometry/createRoom";
import type {
  ConnectableOpeningWallObject,
  Project,
  RoomPlacement,
  WallObject
} from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import { DOOR_HEIGHT_MM, DOOR_WIDTH_MM } from "./createOpening";
import { repairSharedOpeningsOnLoad } from "./sharedOpeningLoadRepair";

// Same fixture shape as sharedOpeningAnalysis.test.ts: room-b flush to the
// right of room-a makes room-a's east wall and room-b's west wall one
// coincident twin pair, mirroring opening x to (3000 − x).
function room(roomId: string, offsetXMm: number): RoomPlacement {
  return createRectangularRoomPlacement({
    roomId,
    name: roomId,
    widthMm: 4000,
    depthMm: 3000,
    heightMm: 2500,
    offsetXMm,
    offsetYMm: 0
  });
}

function project(rooms: RoomPlacement[], wallObjects: WallObject[] = []): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Shared openings",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: { rooms },
    checklistArtworkIds: [],
    wallObjects,
    floorObjects: [],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  };
}

const A_EAST = "room-a-wall-east";
const A_NORTH = "room-a-wall-north";
const A_SOUTH = "room-a-wall-south";
const B_WEST = "room-b-wall-west";

function door(
  id: string,
  wallId: string,
  xMm: number,
  overrides: Partial<ConnectableOpeningWallObject> = {}
): ConnectableOpeningWallObject {
  return {
    id,
    kind: "door",
    blocksPlacement: true,
    wallId,
    xMm,
    yMm: DOOR_HEIGHT_MM / 2,
    widthMm: DOOR_WIDTH_MM,
    heightMm: DOOR_HEIGHT_MM,
    ...overrides
  };
}

// A generator that fails the test if the pass ever mints an id: the load pass
// applies no create-twin, so it has nothing to name.
function forbiddenId(): string {
  throw new Error("the load pass must not allocate an object id");
}

function openingById(result: { project: Project }, id: string): ConnectableOpeningWallObject {
  const found = result.project.wallObjects.find((object) => object.id === id);
  if (!found || (found.kind !== "door" && found.kind !== "window")) {
    throw new Error(`no opening ${id}`);
  }
  return found;
}

describe("repairSharedOpeningsOnLoad", () => {
  it("adopts the one aligned unpaired opening opposite", () => {
    const input = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200), door("door-b", B_WEST, 1800)]
    );

    const result = repairSharedOpeningsOnLoad(input, forbiddenId);

    expect(result.linkedCount).toBe(1);
    expect(result.declinedTwinCount).toBe(0);
    expect(openingById(result, "door-a").connectsToObjectId).toBe("door-b");
    expect(openingById(result, "door-b").connectsToObjectId).toBe("door-a");
    // The input document is never mutated in place.
    expect(input.wallObjects.map((object) => object.id)).toEqual(["door-a", "door-b"]);
    expect(
      (input.wallObjects[0] as ConnectableOpeningWallObject).connectsToObjectId
    ).toBeUndefined();
    // adopt only rewrites connectsToObjectId pointers — neither half moves, so
    // neither can create a placement collision. realignedIds must stay empty.
    expect(result.realignedIds).toEqual([]);
  });

  it("realigns a drifted pair that still shares a boundary", () => {
    const input = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
        door("door-b", B_WEST, 1700, { connectsToObjectId: "door-a" })
      ]
    );

    const result = repairSharedOpeningsOnLoad(input, forbiddenId);

    expect(result.linkedCount).toBe(1);
    expect(result.declinedTwinCount).toBe(0);
    // The lexicographically smaller half is authoritative, so the partner moves
    // to the mirrored x (3000 − 1200).
    expect(openingById(result, "door-b").xMm).toBeCloseTo(1800);
    expect(openingById(result, "door-a").xMm).toBe(1200);
    // Only the half that actually moved is named — the authoritative half
    // (door-a) never appears even though it belongs to the same repaired pair.
    expect(result.realignedIds).toEqual(["door-b"]);
  });

  it("declines to create a twin on load, and counts the one it declined", () => {
    // The headline restraint: opening a document must not add a door to a room
    // that never had one. The analyzer proposes exactly this create-twin; the
    // issues rail is where it becomes visible, as `missing-twin`.
    const input = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200)]
    );

    const result = repairSharedOpeningsOnLoad(input, forbiddenId);

    expect(result.declinedTwinCount).toBe(1);
    expect(result.linkedCount).toBe(0);
    // Nothing changed at all — not even a new array.
    expect(result.project).toBe(input);
    expect(result.project.wallObjects).toHaveLength(1);
    expect(openingById(result, "door-a").connectsToObjectId).toBeUndefined();
  });

  it("never allocates an object id", () => {
    // Stronger than the fixture generator above: a spy proves the id function is
    // not called even on a document with a create-twin waiting.
    const newObjectId = vi.fn(() => "should-not-be-used");
    const input = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200)]
    );

    repairSharedOpeningsOnLoad(input, newObjectId);

    expect(newObjectId).not.toHaveBeenCalled();
  });

  it("counts a declined twin alongside a link applied elsewhere in the document", () => {
    // room-c/room-d are a second abutting pair, far from the first, so the two
    // ladders run independently in one pass.
    const input = project(
      [room("room-a", 0), room("room-b", 4000), room("room-c", 20_000), room("room-d", 24_000)],
      [
        door("door-a", A_EAST, 1200),
        door("door-c", "room-c-wall-east", 1200),
        door("door-d", "room-d-wall-west", 1800)
      ]
    );

    const result = repairSharedOpeningsOnLoad(input, forbiddenId);

    expect(result.linkedCount).toBe(1);
    expect(result.declinedTwinCount).toBe(1);
    expect(openingById(result, "door-c").connectsToObjectId).toBe("door-d");
    expect(openingById(result, "door-a").connectsToObjectId).toBeUndefined();
    expect(result.project.wallObjects).toHaveLength(3);
  });

  it("preserves a legacy non-boundary pair untouched", () => {
    // Settled decision 4: a door on wall-north paired with one on wall-south is
    // a user-created state no schema rule objects to. It is a caution reported
    // as `boundary-lost`, never something load repair severs.
    const input = project(
      [room("room-a", 0)],
      [
        door("door-a", A_NORTH, 1200, { connectsToObjectId: "door-b" }),
        door("door-b", A_SOUTH, 2400, { connectsToObjectId: "door-a" })
      ]
    );

    const result = repairSharedOpeningsOnLoad(input, forbiddenId);

    expect(result.project).toBe(input);
    expect(result.linkedCount).toBe(0);
    expect(result.declinedTwinCount).toBe(0);
    expect(openingById(result, "door-a")).toEqual(input.wallObjects[0]);
    expect(openingById(result, "door-b")).toEqual(input.wallObjects[1]);
  });

  it("returns the identical project reference when there is nothing to do", () => {
    // Callers memoize on project identity (openingPairs.ts:123 convention).
    const healthy = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
        door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a" })
      ]
    );

    const result = repairSharedOpeningsOnLoad(healthy, forbiddenId);

    expect(result.project).toBe(healthy);
    expect(result.linkedCount).toBe(0);
    expect(result.declinedTwinCount).toBe(0);
  });

  it("is idempotent: a second pass over a repaired document changes nothing", () => {
    const input = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200), door("door-b", B_WEST, 1800)]
    );

    const first = repairSharedOpeningsOnLoad(input, forbiddenId);
    const second = repairSharedOpeningsOnLoad(first.project, forbiddenId);

    expect(second.project).toBe(first.project);
    expect(second.linkedCount).toBe(0);
  });
});
