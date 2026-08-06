import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../geometry/createRoom";
import type { ConnectableOpeningWallObject, Project, RoomPlacement, WallObject } from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import { DOOR_HEIGHT_MM, DOOR_WIDTH_MM } from "./createOpening";
import { selectSharedOpeningConflicts } from "./sharedOpeningIssues";

// Same fixture shape as sharedOpeningAnalysis.test.ts / store.test.ts's
// setupSharedWallRooms and setupAmbiguousRooms: room-a's east wall and room-b's
// west wall are coincident anti-parallel twins, so x mirrors to (3000 - x).
function room(
  roomId: string,
  offsetXMm: number,
  offsetYMm = 0,
  overrides: { widthMm?: number; depthMm?: number } = {}
): RoomPlacement {
  return createRectangularRoomPlacement({
    roomId,
    name: roomId,
    widthMm: overrides.widthMm ?? 4000,
    depthMm: overrides.depthMm ?? 3000,
    heightMm: 2500,
    offsetXMm,
    offsetYMm
  });
}

function project(rooms: RoomPlacement[], wallObjects: WallObject[] = []): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Shared opening issues",
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
const B_WEST = "room-b-wall-west";
const C_WEST = "room-c-wall-west";

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

// The two-room layout from setupSharedWallRooms: A_EAST and B_WEST coincide.
const twoRooms = [room("room-a", 0), room("room-b", 4000)];

// The setupAmbiguousRooms layout: room-c overlaps room-b, so A_EAST's
// discovery is genuinely ambiguous between two facing walls.
const ambiguousRooms = [room("room-a", 0), room("room-b", 4000), room("room-c", 4100)];

describe("selectSharedOpeningConflicts", () => {
  it("surfaces a declined create-twin as a missing-twin conflict naming the opening", () => {
    // Same fixture as sharedOpeningAnalysis.test.ts's "creates the twin when
    // the one empty opposite face is unambiguous" — analyzeSharedOpenings
    // alone would propose a create-twin action, never a conflict. The load
    // pass never applies that action, so this selector is what makes it
    // visible.
    const conflicts = selectSharedOpeningConflicts(
      project(twoRooms, [door("door-a", A_EAST, 1200)])
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      id: "door-a:missing-twin",
      reason: "missing-twin",
      openingId: "door-a",
      wallIds: [A_EAST, B_WEST]
    });
  });

  it("reports nothing for a correctly paired shared opening", () => {
    const conflicts = selectSharedOpeningConflicts(
      project(twoRooms, [
        door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
        door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a" })
      ])
    );

    expect(conflicts).toEqual([]);
  });

  // The false-positive that would make the issues rail useless: most doors in a
  // real project are exterior and have no facing wall at all. If those read as
  // "missing twin", every ordinary document opens covered in issues.
  it.each([
    ["an isolated room", [room("room-a", 0)], "room-a-wall-north"],
    ["an outside wall of an abutting pair", twoRooms, "room-a-wall-west"],
    ["a wall facing a room too far away to abut", [room("room-a", 0), room("room-b", 40000)], A_EAST]
  ])("reports nothing for a door on %s", (_label, rooms, wallId) => {
    expect(selectSharedOpeningConflicts(project(rooms, [door("door-a", wallId, 1200)]))).toEqual(
      []
    );
  });

  it("passes through an ambiguous boundary's own conflict from the analyzer", () => {
    const conflicts = selectSharedOpeningConflicts(
      project(ambiguousRooms, [door("door-a", A_EAST, 1500)])
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe("ambiguous-boundary-wall");
    expect(conflicts[0].id).toBe("door-a:ambiguous-boundary-wall");
    expect(conflicts[0].wallIds).toEqual([A_EAST, B_WEST, C_WEST]);
  });

  it("orders output deterministically across two calls on equivalent projects", () => {
    // Three independent conflicts at once — one ambiguous boundary plus two
    // missing twins on two unrelated shared-wall pairs — so a real sort has
    // something to do, not just a single-element list.
    const built = () =>
      project(
        [
          ...ambiguousRooms,
          room("room-d", 8200),
          room("room-e", 12200),
          room("room-f", 8200, 3200),
          room("room-g", 12200, 3200)
        ],
        [
          door("door-a", A_EAST, 1500),
          door("door-z", "room-d-wall-east", 1200),
          door("door-m", "room-f-wall-east", 1200)
        ]
      );

    const first = selectSharedOpeningConflicts(built());
    const second = selectSharedOpeningConflicts(built());

    expect(first.map((conflict) => conflict.id)).toEqual(second.map((conflict) => conflict.id));
    const ids = first.map((conflict) => conflict.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    expect(ids).toEqual([
      "door-a:ambiguous-boundary-wall",
      "door-m:missing-twin",
      "door-z:missing-twin"
    ]);
  });

  it("never emits duplicate conflict ids", () => {
    const conflicts = selectSharedOpeningConflicts(
      project(ambiguousRooms, [door("door-a", A_EAST, 1500)])
    );

    const ids = conflicts.map((conflict) => conflict.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not mutate the input project", () => {
    const input = project(twoRooms, [door("door-a", A_EAST, 1200)]);
    const before = JSON.parse(JSON.stringify(input));

    selectSharedOpeningConflicts(input);

    expect(input).toEqual(before);
  });
});
