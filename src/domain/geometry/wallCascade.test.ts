import { describe, expect, it } from "vitest";
import type {
  ElevationReferenceMeasurement,
  Project,
  RoomPlacement,
  WallObject
} from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import { createRectangularRoomPlacement } from "./createRoom";
import { getWallsWithGeometry } from "./walls";
import { parseProject } from "../schema/projectSchema";
import { validateChangedWallPlacements } from "../placement/validatePlacement";
import {
  getCounterpartBackings,
  getWallOpenEligibility,
  isHangableWall,
  isWallOpen,
  openWallInProject,
  restoreWallInProject
} from "./wallCascade";

// Same abutting-rooms geometry as sharedWalls.test.ts: room-b flush to the
// right of room-a makes room-a's east wall and room-b's west wall a coincident
// twin pair.
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

function project(rooms: RoomPlacement[], overrides: Partial<Project> = {}): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Open walls",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: { rooms },
    checklistArtworkIds: [],
    wallObjects: [],
    floorObjects: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    ...overrides
  };
}

const A_EAST = "room-a-wall-east";
const A_NORTH = "room-a-wall-north";
const B_WEST = "room-b-wall-west";

function artwork(id: string, wallId: string): WallObject {
  return {
    id,
    kind: "artwork",
    artworkId: `${id}-work`,
    wallId,
    xMm: 1000,
    yMm: 1450,
    widthMm: 600,
    heightMm: 800
  } as WallObject;
}

function door(id: string, wallId: string, connectsToObjectId?: string): WallObject {
  return {
    id,
    kind: "door",
    blocksPlacement: true,
    wallId,
    xMm: 1500,
    yMm: 1000,
    widthMm: 900,
    heightMm: 2000,
    ...(connectsToObjectId ? { connectsToObjectId } : {})
  } as WallObject;
}

function wallText(id: string, wallId: string): WallObject {
  return {
    id,
    kind: "wall-text",
    wallId,
    xMm: 500,
    yMm: 1400,
    widthMm: 400,
    heightMm: 300,
    text: "Label"
  } as WallObject;
}

function measurementBase(id: string) {
  return {
    id,
    visible: true,
    locked: false,
    start: { xMm: 0, yMm: 0 },
    end: { xMm: 500, yMm: 0 }
  };
}

function measurement(id: string, wallId: string): ElevationReferenceMeasurement {
  return { ...measurementBase(id), kind: "elevation", wallId };
}

function readyScope(result: ReturnType<typeof getWallOpenEligibility>) {
  if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
  return result.scope;
}

function openedProject(result: ReturnType<typeof openWallInProject>) {
  if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
  return result;
}

describe("getCounterpartBackings", () => {
  it("reports a full mutual twin as covering the whole wall", () => {
    const p = project([room("room-a", 0), room("room-b", 4000)]);
    const backings = getCounterpartBackings(p, A_EAST);

    expect(backings).toHaveLength(1);
    expect(backings[0].wallId).toBe(B_WEST);
    expect(backings[0].coversWholeWall).toBe(true);
  });

  it("returns nothing for an exterior wall", () => {
    const p = project([room("room-a", 0), room("room-b", 4000)]);
    expect(getCounterpartBackings(p, A_NORTH)).toEqual([]);
  });

  // The alcove case: the SHORT wall is fully backed by a LONGER counterpart.
  // Reported in the counterpart's own local x, which is the only frame that
  // can say where to split it.
  it("reports the backed run of a counterpart that outruns the wall", () => {
    const p = project([room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })]);
    const backings = getCounterpartBackings(p, B_WEST);

    expect(backings).toHaveLength(1);
    expect(backings[0].wallId).toBe(A_EAST);
    expect(backings[0].coversWholeWall).toBe(false);
    expect(backings[0].lengthMm).toBeCloseTo(3000);
    // room-b is 1500 deep and flush with room-a's top, so it backs one end.
    expect(backings[0].hiMm - backings[0].loMm).toBeCloseTo(1500);
  });

  it("reports a short counterpart as fully covered when the long wall is selected", () => {
    const p = project([room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })]);
    const backings = getCounterpartBackings(p, A_EAST);

    expect(backings).toHaveLength(1);
    expect(backings[0].wallId).toBe(B_WEST);
    // The whole of room-b's west wall sits behind room-a's east wall.
    expect(backings[0].coversWholeWall).toBe(true);
  });
});

describe("getWallOpenEligibility", () => {
  it("is ready with no counterpart for an exterior wall", () => {
    const p = project([room("room-a", 0)]);
    const scope = readyScope(getWallOpenEligibility(p, A_NORTH));

    expect(scope.backings).toEqual([]);
    expect(scope.willSplit).toBe(false);
    expect([...scope.wallIds]).toEqual([A_NORTH]);
  });

  it("scopes both twins for a fully shared wall, with no split", () => {
    const p = project([room("room-a", 0), room("room-b", 4000)]);
    const scope = readyScope(getWallOpenEligibility(p, A_EAST));

    expect(scope.willSplit).toBe(false);
    expect([...scope.wallIds].sort()).toEqual([A_EAST, B_WEST].sort());
    expect(scope.sharedRoomNames).toEqual(["room-b"]);
  });

  // The whole point of the rule: opening a wall opens exactly that wall.
  it("is ready — not blocked — when a counterpart outruns the wall", () => {
    const p = project([room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })]);
    const scope = readyScope(getWallOpenEligibility(p, B_WEST));

    expect(scope.willSplit).toBe(true);
    // The long counterpart is NOT named up front — its middle segment has no
    // id until the split happens.
    expect([...scope.wallIds]).toEqual([B_WEST]);
    expect(scope.sharedRoomNames).toEqual(["room-a"]);
  });

  it("is ready with no split when the SHORT counterpart is fully behind it", () => {
    const p = project([room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })]);
    const scope = readyScope(getWallOpenEligibility(p, A_EAST));

    expect(scope.willSplit).toBe(false);
    expect([...scope.wallIds].sort()).toEqual([A_EAST, B_WEST].sort());
  });

  it("handles two half-covering neighbours without refusing", () => {
    // Two 1500-deep rooms stacked along room-a's 3000 east wall. Opening
    // room-a's east wall opens the whole side, so both neighbours' walls —
    // each fully behind it — open too.
    const p = project([
      room("room-a", 0),
      room("room-b", 4000, 0, { depthMm: 1500 }),
      room("room-c", 4000, 1500, { depthMm: 1500 })
    ]);
    const scope = readyScope(getWallOpenEligibility(p, A_EAST));

    expect(scope.willSplit).toBe(false);
    expect(scope.backings).toHaveLength(2);
    expect([...scope.wallIds].sort()).toEqual(
      [A_EAST, B_WEST, "room-c-wall-west"].sort()
    );
  });

  it("blocks a partition face and an already-open wall", () => {
    const p = project([room("room-a", 0)]);
    expect(getWallOpenEligibility(p, "partition-1#a")).toEqual({
      status: "blocked",
      reason: "partition-face"
    });

    const opened = openedProject(openWallInProject(p, A_NORTH)).project;
    expect(getWallOpenEligibility(opened, A_NORTH)).toEqual({
      status: "blocked",
      reason: "already-open"
    });
  });

  it("separates unhung artworks from deleted fixtures", () => {
    const p = project([room("room-a", 0)], {
      wallObjects: [
        artwork("art-1", A_NORTH),
        wallText("text-1", A_NORTH),
        door("door-1", A_NORTH),
        artwork("art-elsewhere", A_EAST)
      ],
      checklistArtworkIds: ["art-1-work", "art-elsewhere-work"]
    });
    const scope = readyScope(getWallOpenEligibility(p, A_NORTH));

    expect([...scope.unhungArtworkObjectIds]).toEqual(["art-1"]);
    expect([...scope.deletedFixtureObjectIds].sort()).toEqual(["door-1", "text-1"]);
  });
});

describe("openWallInProject", () => {
  it("flags the wall, drops its objects, and leaves the checklist alone", () => {
    const p = project([room("room-a", 0)], {
      wallObjects: [artwork("art-1", A_NORTH), door("door-1", A_NORTH)],
      checklistArtworkIds: ["art-1-work"]
    });
    const { project: next } = openedProject(openWallInProject(p, A_NORTH));

    expect(isWallOpen(next, A_NORTH)).toBe(true);
    expect(next.wallObjects).toEqual([]);
    // The unhang: the placement is gone, the work is still on the checklist.
    expect(next.checklistArtworkIds).toEqual(["art-1-work"]);
    // The loop is untouched — the wall record stays in room.walls.
    expect(next.floor.rooms[0].room.walls).toHaveLength(4);
  });

  it("leaves other walls' objects and floor objects untouched", () => {
    const p = project([room("room-a", 0)], {
      wallObjects: [artwork("art-1", A_NORTH), artwork("art-2", A_EAST)],
      floorObjects: [
        {
          id: "floor-1",
          kind: "blocked-zone",
          xMm: 500,
          yMm: 500,
          widthMm: 300,
          depthMm: 300,
          rotationDeg: 0,
          heightMm: 900
        } as Project["floorObjects"][number]
      ]
    });
    const { project: next } = openedProject(openWallInProject(p, A_NORTH));

    expect(next.wallObjects.map((o) => o.id)).toEqual(["art-2"]);
    expect(next.floorObjects).toHaveLength(1);
  });

  it("opens both twins and deletes both halves of a shared door", () => {
    const p = project([room("room-a", 0), room("room-b", 4000)], {
      wallObjects: [door("door-a", A_EAST, "door-b"), door("door-b", B_WEST, "door-a")]
    });
    const { project: next, scope } = openedProject(openWallInProject(p, A_EAST));

    expect([...scope.wallIds].sort()).toEqual([A_EAST, B_WEST].sort());
    expect(isWallOpen(next, A_EAST)).toBe(true);
    expect(isWallOpen(next, B_WEST)).toBe(true);
    expect(next.wallObjects).toEqual([]);
  });

  it("deletes a paired partner living on a wall that is not being opened", () => {
    // Contrived but reachable after geometry drift: the partner sits on a
    // third wall. includePairedOpenings must still reach it, and no survivor
    // may keep a dangling connectsToObjectId.
    const p = project([room("room-a", 0)], {
      wallObjects: [door("door-a", A_NORTH, "door-b"), door("door-b", A_EAST, "door-a")]
    });
    const { project: next } = openedProject(openWallInProject(p, A_NORTH));

    expect(next.wallObjects).toEqual([]);
  });

  it("clears a surviving opening's partner ref instead of leaving it dangling", () => {
    const p = project([room("room-a", 0)], {
      wallObjects: [
        artwork("art-1", A_NORTH),
        // A one-way ref: the survivor points at a doomed object but is not
        // itself a pair half, so includePairedOpenings does not remove it.
        door("door-survivor", A_EAST, "art-1")
      ]
    });
    const { project: next } = openedProject(openWallInProject(p, A_NORTH));

    const survivor = next.wallObjects.find((o) => o.id === "door-survivor");
    expect(survivor).toBeDefined();
    expect((survivor as { connectsToObjectId?: string }).connectsToObjectId).toBeUndefined();
  });

  it("drops elevation measurements on the opened wall but keeps plan ones", () => {
    const p = project([room("room-a", 0)], {
      referenceMeasurements: [
        measurement("m-elev", A_NORTH),
        measurement("m-other", A_EAST),
        { ...measurementBase("m-plan"), kind: "plan" }
      ]
    });
    const { project: next } = openedProject(openWallInProject(p, A_NORTH));

    expect((next.referenceMeasurements ?? []).map((m) => m.id).sort()).toEqual([
      "m-other",
      "m-plan"
    ]);
  });

  it("refuses to mutate an already-open wall", () => {
    const p = project([room("room-a", 0)]);
    const opened = openedProject(openWallInProject(p, A_NORTH)).project;

    expect(openWallInProject(opened, A_NORTH)).toEqual({
      status: "blocked",
      reason: "already-open"
    });
  });
});

describe("openWallInProject — splitting a counterpart that outruns the wall", () => {
  // The alcove case. room-b (1500 deep) sits against the top half of room-a's
  // 3000-long east wall. Opening room-b's west wall must open exactly that
  // wall and split room-a's, opening only the matching segment.
  function alcove() {
    return project([room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })]);
  }

  it("splits the long counterpart and opens only the backing segment", () => {
    const p = alcove();
    const before = p.floor.rooms[0].room.walls.length;

    const { project: next } = openedProject(openWallInProject(p, B_WEST));

    // The selected wall opens whole.
    expect(isWallOpen(next, B_WEST)).toBe(true);

    // room-a's east wall became two: the backed segment (open) and the
    // remainder (still solid).
    const roomA = next.floor.rooms.find((r) => r.roomId === "room-a")!.room;
    expect(roomA.walls.length).toBe(before + 1);

    const open = roomA.walls.filter((w) => w.isOpenSide === true);
    const solid = roomA.walls.filter((w) => w.isOpenSide !== true);
    expect(open).toHaveLength(1);
    expect(solid).toHaveLength(before);

    // The open segment is 1500 long — exactly the run room-b backs.
    const geo = getWallsWithGeometry(roomA).find((w) => w.id === open[0].id)!;
    expect(geo.lengthMm).toBeCloseTo(1500);
  });

  it("leaves the rest of the long wall solid and still hangable", () => {
    const p = alcove();
    const { project: next } = openedProject(openWallInProject(p, B_WEST));

    const roomA = next.floor.rooms.find((r) => r.roomId === "room-a")!.room;
    // splitWall gives the far segment a fresh `-wall-split-` id, so identify
    // the remainder as the solid wall that is none of the other three sides.
    const otherSides = ["room-a-wall-north", "room-a-wall-south", "room-a-wall-west"];
    const remainder = roomA.walls.filter(
      (w) => w.isOpenSide !== true && !otherSides.includes(w.id)
    );
    expect(remainder).toHaveLength(1);
    expect(isHangableWall(next, remainder[0].id)).toBe(true);

    // It is the leftover 1500 of the original 3000 run.
    const geo = getWallsWithGeometry(roomA).find((w) => w.id === remainder[0].id)!;
    expect(geo.lengthMm).toBeCloseTo(1500);
  });

  it("keeps the result a valid closed loop", () => {
    const p = alcove();
    const { project: next } = openedProject(openWallInProject(p, B_WEST));

    expect(() => parseProject(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });

  it("only removes objects on the backed run, not the whole long wall", () => {
    // Two works on room-a's east wall: one inside the alcove's run, one below.
    const p = project([room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })], {
      wallObjects: [
        { ...artwork("inside", A_EAST), xMm: 700 } as WallObject,
        { ...artwork("outside", A_EAST), xMm: 2400 } as WallObject
      ]
    });

    const { project: next } = openedProject(openWallInProject(p, B_WEST));

    expect(next.wallObjects.map((o) => o.id)).toEqual(["outside"]);
  });

  it("opening the LONG wall instead takes the whole side and the short wall with it", () => {
    const p = alcove();
    const { project: next, scope } = openedProject(openWallInProject(p, A_EAST));

    expect(scope.willSplit).toBe(false);
    expect(isWallOpen(next, A_EAST)).toBe(true);
    expect(isWallOpen(next, B_WEST)).toBe(true);
    // No split: the long wall opened whole.
    expect(next.floor.rooms.find((r) => r.roomId === "room-a")!.room.walls).toHaveLength(4);
  });
});

describe("restoreWallInProject", () => {
  it("closes both twins while they are still coincident", () => {
    const p = project([room("room-a", 0), room("room-b", 4000)]);
    const opened = openedProject(openWallInProject(p, A_EAST)).project;

    const { project: restored, wallIds } = restoreWallInProject(opened, A_EAST);

    expect([...wallIds].sort()).toEqual([A_EAST, B_WEST].sort());
    expect(isWallOpen(restored, A_EAST)).toBe(false);
    expect(isWallOpen(restored, B_WEST)).toBe(false);
  });

  it("closes only this wall once the rooms have moved apart", () => {
    const p = project([room("room-a", 0), room("room-b", 4000)]);
    const opened = openedProject(openWallInProject(p, A_EAST)).project;
    // Slide room-b away: the former twins are no longer coincident.
    const separated: Project = {
      ...opened,
      floor: {
        rooms: opened.floor.rooms.map((placement) =>
          placement.roomId === "room-b" ? { ...placement, offsetXMm: 20000 } : placement
        )
      }
    };

    const { project: restored } = restoreWallInProject(separated, A_EAST);

    expect(isWallOpen(restored, A_EAST)).toBe(false);
    // A wall left open alone is a valid state.
    expect(isWallOpen(restored, B_WEST)).toBe(true);
  });

  it("does not bring contents back — only undo does", () => {
    const p = project([room("room-a", 0)], {
      wallObjects: [artwork("art-1", A_NORTH), door("door-1", A_NORTH)]
    });
    const opened = openedProject(openWallInProject(p, A_NORTH)).project;

    const { project: restored } = restoreWallInProject(opened, A_NORTH);

    expect(isWallOpen(restored, A_NORTH)).toBe(false);
    expect(restored.wallObjects).toEqual([]);
  });

  it("deletes the flag rather than writing false, so the wall round-trips clean", () => {
    const p = project([room("room-a", 0)]);
    const opened = openedProject(openWallInProject(p, A_NORTH)).project;
    const { project: restored } = restoreWallInProject(opened, A_NORTH);

    const wall = restored.floor.rooms[0].room.walls.find((w) => w.id === A_NORTH);
    expect(wall).toBeDefined();
    expect("isOpenSide" in (wall as object)).toBe(false);
  });

  it("is a no-op for a wall that is not open", () => {
    const p = project([room("room-a", 0)]);
    const { project: restored, wallIds } = restoreWallInProject(p, A_NORTH);

    expect(wallIds.size).toBe(0);
    expect(restored).toBe(p);
  });
});

describe("open-wall placement advisory", () => {
  it("flags an object stranded on an open wall, distinctly from a missing wall", () => {
    // A safety net for a hand-edited document, or one written by a build that
    // predates the flag — the cascade clears the wall, so this is not a normal
    // path. Deliberately a runtime advisory rather than a schema refusal, which
    // would make such a document permanently unopenable.
    const p = project([room("room-a", 0)]);
    const opened = openedProject(openWallInProject(p, A_NORTH)).project;
    const stranded: Project = {
      ...opened,
      wallObjects: [artwork("art-1", A_NORTH)]
    };

    // The same entry point the store's openWall calls.
    const warnings = validateChangedWallPlacements(stranded, [A_NORTH]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].id).toBe("art-1:open-wall");
    expect(warnings[0].message).toMatch(/open/i);
  });
});

describe("isHangableWall", () => {
  it("is false only for an open perimeter wall", () => {
    const p = project([room("room-a", 0)]);
    const opened = openedProject(openWallInProject(p, A_NORTH)).project;

    expect(isHangableWall(opened, A_NORTH)).toBe(false);
    expect(isHangableWall(opened, A_EAST)).toBe(true);
    // Partition faces are never openable, so they are always hangable.
    expect(isHangableWall(opened, "partition-1#a")).toBe(true);
    // An unknown id is not an open wall; placement guards reject it elsewhere.
    expect(isHangableWall(opened, "nope")).toBe(true);
  });
});
