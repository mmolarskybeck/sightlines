import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../../../domain/geometry/createRoom";
import type { ConnectableOpeningWallObject, Project, RoomPlacement, WallObject } from "../../../domain/project";
import { CURRENT_SCHEMA_VERSION } from "../../../domain/project";
import {
  BLOCKED_ZONE_HEIGHT_MM,
  BLOCKED_ZONE_WIDTH_MM,
  DOOR_HEIGHT_MM,
  DOOR_WIDTH_MM
} from "../../../domain/placement/createOpening";
import type {
  SharedOpeningConflict,
  SharedOpeningConflictReason
} from "../../../domain/placement/sharedOpeningAnalysis";
import { describeSharedOpeningConflict } from "./sharedOpeningIssueCopy";
import { selectSharedOpeningConflicts } from "../../../domain/placement/sharedOpeningIssues";

// Same fixture shape as sharedOpeningIssues.test.ts (room-a's east wall and
// room-b's west wall are coincident anti-parallel twins, so x mirrors to
// 3000 − x) with ONE deliberate difference: the room NAME is never the room id.
// The leak test below asserts no message contains a raw id, and a fixture whose
// display name happened to equal its id could not tell the two apart.
function room(
  roomId: string,
  name: string,
  offsetXMm: number,
  offsetYMm = 0,
  overrides: { widthMm?: number; depthMm?: number } = {}
): RoomPlacement {
  return createRectangularRoomPlacement({
    roomId,
    name,
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
    title: "Shared opening issue copy",
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
const B_EAST = "room-b-wall-east";

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

function blockedZone(id: string, wallId: string, xMm: number): WallObject {
  return {
    id,
    kind: "blocked-zone",
    blocksPlacement: true,
    wallId,
    xMm,
    yMm: 1450,
    widthMm: BLOCKED_ZONE_WIDTH_MM,
    heightMm: BLOCKED_ZONE_HEIGHT_MM
  };
}

const galleryOne = (offsetXMm = 0) => room("room-a", "Gallery 1", offsetXMm);
const galleryTwo = (offsetXMm = 4000, overrides: { depthMm?: number } = {}) =>
  room("room-b", "Gallery 2", offsetXMm, 0, overrides);

// Every reason, built from a REAL layout run through the real selector rather
// than a hand-written conflict object — so the copy is exercised against the
// wallIds/blockerId shapes the analyzer actually emits. Typed as a total Record
// over the reason union: a new reason fails the typecheck here as well as in
// the module's `never` branch.
const FIXTURES: Record<SharedOpeningConflictReason, Project> = {
  // room-c overlaps room-b, so both rooms back the whole of room-a's east wall.
  "ambiguous-boundary-wall": project(
    [galleryOne(), galleryTwo(), room("room-c", "Gallery 3", 4100)],
    [door("door-a", A_EAST, 1500)]
  ),
  // Two doors opposite one — a cluster of three, none of them the obvious pair.
  "ambiguous-counterpart-opening": project(
    [galleryOne(), galleryTwo()],
    [door("door-a", A_EAST, 1200), door("door-b1", B_WEST, 1400), door("door-b2", B_WEST, 1750)]
  ),
  // Gallery 2 is only 1500 deep, so a door centred at 1500 straddles the end of
  // the run the two walls share.
  "overhangs-common-span": project(
    [galleryOne(), galleryTwo(4000, { depthMm: 1500 })],
    [door("door-a", A_EAST, 1500)]
  ),
  // A perfectly mirrored pair that still runs past where the rooms now meet.
  "paired-overhang": project(
    [galleryOne(), galleryTwo(4000, { depthMm: 2000 })],
    [
      door("door-a", A_EAST, 1800, { connectsToObjectId: "door-b" }),
      door("door-b", B_WEST, 200, { connectsToObjectId: "door-a" })
    ]
  ),
  "paired-geometry-mismatch": project(
    [galleryOne(), galleryTwo()],
    [
      door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
      door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a", widthMm: 1800 })
    ]
  ),
  // door-b already belongs to another pair and stands exactly where door-a's
  // other face would go.
  "counterpart-occupied": project(
    [galleryOne(), galleryTwo()],
    [
      door("door-a", A_EAST, 1200),
      door("door-b", B_WEST, 1800, { connectsToObjectId: "door-b2" }),
      door("door-b2", B_EAST, 500, { connectsToObjectId: "door-b" })
    ]
  ),
  "blocked-mirror-slot": project(
    [galleryOne(), galleryTwo()],
    [door("door-a", A_EAST, 1200), blockedZone("zone-b", B_WEST, 1800)]
  ),
  "missing-twin": project([galleryOne(), galleryTwo()], [door("door-a", A_EAST, 1200)]),
  "boundary-lost": project(
    [galleryOne(), galleryTwo(8000)],
    [
      door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
      door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a" })
    ]
  )
};

const REASONS = Object.keys(FIXTURES) as SharedOpeningConflictReason[];

function conflictFor(reason: SharedOpeningConflictReason): {
  conflict: SharedOpeningConflict;
  project: Project;
} {
  const fixture = FIXTURES[reason];
  const conflict = selectSharedOpeningConflicts(fixture).find(
    (candidate) => candidate.reason === reason
  );
  if (!conflict) throw new Error(`fixture for ${reason} produced no such conflict`);
  return { conflict, project: fixture };
}

function describeFor(reason: SharedOpeningConflictReason) {
  const { conflict, project: fixture } = conflictFor(reason);
  return describeSharedOpeningConflict(conflict, fixture);
}

describe("describeSharedOpeningConflict", () => {
  it.each(REASONS)("says something for %s", (reason) => {
    const { conflict } = conflictFor(reason);
    const display = describeFor(reason);

    expect(display.id).toBe(conflict.id);
    expect(display.openingId).toBe(conflict.openingId);
    expect(display.subject.length).toBeGreaterThan(0);
    expect(display.message.length).toBeGreaterThan(0);
  });

  it.each(REASONS)("keeps %s to one sentence", (reason) => {
    // The panel renders these in a compact side rail beside placement warnings,
    // where a second sentence wraps out of the visible row.
    expect(describeFor(reason).message).toMatch(/^[^.!?]+\.$/);
  });

  // The guard that stops internals leaking later. Every id in the document and
  // every reason slug is forbidden in both the subject and the message.
  it("never prints a reason slug, an id, or schema vocabulary", () => {
    const banned = /counterpart|twin|mirror|slot|boundary|span|wallobject|schemaversion|undefined|null/i;

    for (const reason of REASONS) {
      const fixture = FIXTURES[reason];
      const ids = [
        fixture.id,
        ...fixture.floor.rooms.flatMap((placement) => [
          placement.roomId,
          placement.room.id,
          ...placement.room.walls.map((wall) => wall.id),
          ...placement.room.vertices.map((vertex) => vertex.id)
        ]),
        ...fixture.wallObjects.map((object) => object.id),
        ...REASONS
      ];

      const display = describeFor(reason);
      const text = `${display.subject} ${display.message}`;

      for (const id of ids) expect(text).not.toContain(id);
      expect(text).not.toMatch(banned);
      // Kind strings are schema vocabulary too — "blocked-zone" must reach the
      // reader as "blocked zone".
      expect(text).not.toContain("blocked-zone");
      expect(text).not.toContain("wall-text");
    }
  });

  it("names the object and the room it sits in as the subject", () => {
    expect(describeFor("missing-twin").subject).toBe("Door in Gallery 1");
  });

  it("names both rooms behind an ambiguous stretch of wall", () => {
    const { message } = describeFor("ambiguous-boundary-wall");

    expect(message).toContain("Gallery 2");
    expect(message).toContain("Gallery 3");
    expect(message).toContain("East wall");
    expect(message).toContain("this door");
  });

  it("names the room that is missing the other half of the opening", () => {
    expect(describeFor("missing-twin").message).toBe(
      "This door appears on the Gallery 1 side of the wall but not on the Gallery 2 side."
    );
  });

  it("says what a lost boundary means for the plan, not what the data lost", () => {
    expect(describeFor("boundary-lost").message).toBe(
      "Gallery 1 and Gallery 2 no longer share a wall here, so this door no longer opens between them."
    );
  });

  it("names the wall and the thing standing in the way of a blocked position", () => {
    const { message } = describeFor("blocked-mirror-slot");

    expect(message).toContain("blocked zone");
    expect(message).toContain("West wall in Gallery 2");
  });

  it("names the room that already has something in the facing position", () => {
    expect(describeFor("counterpart-occupied").message).toContain("Gallery 2 already has");
  });

  it("uses the object's own noun, so a window never reads as a door", () => {
    const windows = project(
      [galleryOne(), galleryTwo()],
      [
        {
          id: "window-a",
          kind: "window",
          blocksPlacement: true,
          wallId: A_EAST,
          xMm: 1200,
          yMm: 1450,
          widthMm: 1200,
          heightMm: 1200
        }
      ]
    );
    const conflict = selectSharedOpeningConflicts(windows)[0];
    const display = describeSharedOpeningConflict(conflict, windows);

    expect(display.subject).toBe("Window in Gallery 1");
    expect(display.message).toContain("This window");
    expect(display.message).not.toContain("door");
  });

  describe("when a name cannot be resolved", () => {
    it("falls back to the wall alone when the room has no name", () => {
      const fixture = FIXTURES["missing-twin"];
      const unnamed: Project = {
        ...fixture,
        floor: {
          rooms: fixture.floor.rooms.map((placement) => ({
            ...placement,
            room: { ...placement.room, name: "  " }
          }))
        }
      };
      const conflict = selectSharedOpeningConflicts(unnamed)[0];
      const display = describeSharedOpeningConflict(conflict, unnamed);

      expect(display.subject).toBe("Door on East wall");
      expect(display.message).toBe(
        "This door appears on one side of the wall but not on the facing side."
      );
    });

    it.each(REASONS)("still reads for %s when no wall resolves at all", (reason) => {
      const { conflict, project: fixture } = conflictFor(reason);
      // Every room gone, the wall objects left behind: the shape a stale
      // conflict held across a room deletion would have.
      const emptied: Project = { ...fixture, floor: { rooms: [] } };
      const display = describeSharedOpeningConflict(conflict, emptied);

      expect(display.subject).toBe("Door");
      expect(display.message).toMatch(/^[^.!?]+\.$/);
      expect(display.message).not.toMatch(/undefined|null/i);
      for (const wallId of conflict.wallIds) {
        expect(display.message).not.toContain(wallId);
      }
    });

    it("still names the object when the opening itself is gone", () => {
      const { conflict, project: fixture } = conflictFor("missing-twin");
      const withoutOpening: Project = { ...fixture, wallObjects: [] };
      const display = describeSharedOpeningConflict(conflict, withoutOpening);

      expect(display.subject).toBe("Opening in Gallery 1");
      expect(display.message).toContain("This opening");
      expect(display.message).not.toContain(conflict.openingId);
    });
  });
});
