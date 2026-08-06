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
  SharedOpeningConflictReason,
  SharedOpeningTarget
} from "../../../domain/placement/sharedOpeningAnalysis";
import {
  describeSharedConnection,
  describeSharedOpeningConflict,
  describeSharedOpeningDrift,
  describeSharedOpeningTarget
} from "./sharedOpeningIssueCopy";
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

// The rest of the Stage 7 copy. Same fixtures, because the inspector and the
// issues rail must name the same wall in the same room the same way.

// A healthy shared pair: door-a in Gallery 1 joined to door-b in Gallery 2.
const PAIRED = FIXTURES["paired-overhang"];

// Every room stripped of its name — the shape a project has while a curator is
// still laying it out.
function unnamedRooms(fixture: Project): Project {
  return {
    ...fixture,
    floor: {
      rooms: fixture.floor.rooms.map((placement) => ({
        ...placement,
        room: { ...placement.room, name: "  " }
      }))
    }
  };
}

// Every room gone, the wall objects left behind: the shape a stale reference
// held across a room deletion would have.
function withoutRooms(fixture: Project): Project {
  return { ...fixture, floor: { rooms: [] } };
}

function idsIn(fixture: Project): string[] {
  return [
    fixture.id,
    ...fixture.floor.rooms.flatMap((placement) => [
      placement.roomId,
      placement.room.id,
      ...placement.room.walls.map((wall) => wall.id),
      ...placement.room.vertices.map((vertex) => vertex.id)
    ]),
    ...fixture.wallObjects.map((object) => object.id)
  ];
}

describe("describeSharedConnection", () => {
  it("names both rooms one physical opening joins", () => {
    expect(describeSharedConnection(PAIRED, "door-a", "door-b")).toBe(
      "Connects Gallery 1 ↔ Gallery 2"
    );
  });

  it("reads from the selected half, so the room the user is in leads", () => {
    expect(describeSharedConnection(PAIRED, "door-b", "door-a")).toBe(
      "Connects Gallery 2 ↔ Gallery 1"
    );
  });

  it("is a label, not a sentence, so it carries no terminal period", () => {
    expect(describeSharedConnection(PAIRED, "door-a", "door-b")).not.toMatch(/[.!?]$/);
  });

  it("names the far room alone when the near one has no name", () => {
    const nearRoomGone: Project = {
      ...PAIRED,
      floor: {
        rooms: PAIRED.floor.rooms.filter((placement) => placement.roomId !== "room-a")
      }
    };

    expect(describeSharedConnection(nearRoomGone, "door-a", "door-b")).toBe(
      "Connects to Gallery 2"
    );
  });

  it("degrades to the plainest true statement when the far room has no name", () => {
    expect(describeSharedConnection(unnamedRooms(PAIRED), "door-a", "door-b")).toBe(
      "Connects both sides of this wall"
    );
    expect(describeSharedConnection(withoutRooms(PAIRED), "door-a", "door-b")).toBe(
      "Connects both sides of this wall"
    );
  });

  it("degrades when the partner cannot be found at all", () => {
    expect(describeSharedConnection(PAIRED, "door-a", "door-gone")).toBe(
      "Connects both sides of this wall"
    );
  });

  // "Connects Gallery 1 ↔ Gallery 1" tells a curator nothing, whether that is
  // one room facing itself or two rooms they gave the same name.
  it("degrades when both sides carry the same room name", () => {
    const sameName: Project = {
      ...PAIRED,
      floor: {
        rooms: PAIRED.floor.rooms.map((placement) => ({
          ...placement,
          room: { ...placement.room, name: "Gallery 1" }
        }))
      }
    };

    expect(describeSharedConnection(sameName, "door-a", "door-b")).toBe(
      "Connects both sides of this wall"
    );
  });

  it("never prints an id or the word undefined", () => {
    for (const fixture of [PAIRED, unnamedRooms(PAIRED), withoutRooms(PAIRED)]) {
      for (const partnerId of ["door-b", "door-gone"]) {
        const line = describeSharedConnection(fixture, "door-a", partnerId);

        expect(line).not.toMatch(/undefined|null/i);
        for (const id of idsIn(fixture)) expect(line).not.toContain(id);
      }
    }
  });
});

describe("describeSharedOpeningDrift", () => {
  // Not a conflict — the analyzer expresses drift as a `realign` action — so
  // this sentence exists nowhere else.
  const DRIFTED = FIXTURES["paired-geometry-mismatch"];

  it("says what drift means for the plan, in both rooms' names", () => {
    expect(describeSharedOpeningDrift(DRIFTED, "door-a")).toBe(
      "This door sits at a different point on the wall in Gallery 1 than in Gallery 2, so its two sides no longer line up."
    );
  });

  it("reads from the selected half", () => {
    expect(describeSharedOpeningDrift(DRIFTED, "door-b")).toBe(
      "This door sits at a different point on the wall in Gallery 2 than in Gallery 1, so its two sides no longer line up."
    );
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
          heightMm: 1200,
          connectsToObjectId: "window-b"
        },
        {
          id: "window-b",
          kind: "window",
          blocksPlacement: true,
          wallId: B_WEST,
          xMm: 1500,
          yMm: 1450,
          widthMm: 1200,
          heightMm: 1200,
          connectsToObjectId: "window-a"
        }
      ]
    );

    const message = describeSharedOpeningDrift(windows, "window-a");

    expect(message).toContain("This window");
    expect(message).not.toContain("door");
  });

  it("does not say wall twice when neither room can be named", () => {
    const message = describeSharedOpeningDrift(withoutRooms(DRIFTED), "door-a");

    expect(message).toBe(
      "This door sits at a different point on each side of the wall, so its two sides no longer line up."
    );
  });

  it("still reads when the opening has no partner recorded", () => {
    const message = describeSharedOpeningDrift(FIXTURES["missing-twin"], "door-a");

    expect(message).toBe(
      "This door sits at a different point on each side of the wall, so its two sides no longer line up."
    );
  });

  it("stays one sentence and never prints an id", () => {
    for (const fixture of [DRIFTED, unnamedRooms(DRIFTED), withoutRooms(DRIFTED)]) {
      for (const openingId of ["door-a", "door-gone"]) {
        const message = describeSharedOpeningDrift(fixture, openingId);

        expect(message).toMatch(/^[^.!?]+\.$/);
        expect(message).not.toMatch(/undefined|null/i);
        for (const id of idsIn(fixture)) expect(message).not.toContain(id);
      }
    }
  });
});

describe("describeSharedOpeningTarget", () => {
  it("names where an existing opening is", () => {
    expect(describeSharedOpeningTarget(PAIRED, { kind: "opening", openingId: "door-b" })).toBe(
      "Door on West wall in Gallery 2"
    );
  });

  it("uses the target's own noun", () => {
    const windows = project(
      [galleryOne(), galleryTwo()],
      [
        {
          id: "window-b",
          kind: "window",
          blocksPlacement: true,
          wallId: B_WEST,
          xMm: 1500,
          yMm: 1450,
          widthMm: 1200,
          heightMm: 1200
        }
      ]
    );

    expect(describeSharedOpeningTarget(windows, { kind: "opening", openingId: "window-b" })).toBe(
      "Window on West wall in Gallery 2"
    );
  });

  // A bare wall has nothing on it: picking it CREATES the other face, so the
  // row must not read as an object that already exists.
  it("reads a bare wall as creating the other side, not as an existing object", () => {
    const label = describeSharedOpeningTarget(PAIRED, { kind: "wall", wallId: B_WEST });

    expect(label).toBe("Add the other side on West wall in Gallery 2");
    expect(label).not.toMatch(/^Door\b|^Window\b|^Opening\b/);
  });

  it("keeps the two kinds of row visibly different", () => {
    const opening = describeSharedOpeningTarget(PAIRED, {
      kind: "opening",
      openingId: "door-b"
    });
    const wall = describeSharedOpeningTarget(PAIRED, { kind: "wall", wallId: B_WEST });

    expect(wall.startsWith("Add ")).toBe(true);
    expect(opening.startsWith("Add ")).toBe(false);
    expect(opening).not.toBe(wall);
  });

  it("falls back to the room when the wall has no name", () => {
    const unnamedWalls: Project = {
      ...PAIRED,
      floor: {
        rooms: PAIRED.floor.rooms.map((placement) => ({
          ...placement,
          room: {
            ...placement.room,
            walls: placement.room.walls.map((wall) => ({ ...wall, name: "  " }))
          }
        }))
      }
    };

    expect(
      describeSharedOpeningTarget(unnamedWalls, { kind: "opening", openingId: "door-b" })
    ).toBe("Door in Gallery 2");
    expect(describeSharedOpeningTarget(unnamedWalls, { kind: "wall", wallId: B_WEST })).toBe(
      "Add the other side in Gallery 2"
    );
  });

  it("falls back to the wall alone when the room has no name", () => {
    const unnamed = unnamedRooms(PAIRED);

    expect(describeSharedOpeningTarget(unnamed, { kind: "opening", openingId: "door-b" })).toBe(
      "Door on West wall"
    );
    expect(describeSharedOpeningTarget(unnamed, { kind: "wall", wallId: B_WEST })).toBe(
      "Add the other side on West wall"
    );
  });

  it("still reads when nothing about the place resolves", () => {
    const roomless = withoutRooms(PAIRED);

    expect(describeSharedOpeningTarget(roomless, { kind: "opening", openingId: "door-b" })).toBe(
      "Door on the facing wall"
    );
    expect(describeSharedOpeningTarget(roomless, { kind: "wall", wallId: B_WEST })).toBe(
      "Add the other side on the facing wall"
    );
  });

  it("still reads when the target itself is gone", () => {
    expect(describeSharedOpeningTarget(PAIRED, { kind: "opening", openingId: "door-gone" })).toBe(
      "Opening on the facing wall"
    );
    expect(describeSharedOpeningTarget(PAIRED, { kind: "wall", wallId: "wall-gone" })).toBe(
      "Add the other side on the facing wall"
    );
  });

  it("never prints an id or the word undefined", () => {
    const targets: SharedOpeningTarget[] = [
      { kind: "opening", openingId: "door-b" },
      { kind: "opening", openingId: "door-gone" },
      { kind: "wall", wallId: B_WEST },
      { kind: "wall", wallId: "wall-gone" }
    ];

    for (const fixture of [PAIRED, unnamedRooms(PAIRED), withoutRooms(PAIRED)]) {
      for (const target of targets) {
        const label = describeSharedOpeningTarget(fixture, target);

        expect(label).not.toMatch(/undefined|null/i);
        for (const id of idsIn(fixture)) expect(label).not.toContain(id);
      }
    }
  });
});
