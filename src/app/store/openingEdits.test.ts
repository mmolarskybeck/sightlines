import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../../domain/geometry/createRoom";
import { signedAreaMm2 } from "../../domain/geometry/polygon";
import { DOOR_HEIGHT_MM, DOOR_WIDTH_MM } from "../../domain/placement/createOpening";
import type {
  DoorLeaf,
  DoorWallObject,
  Project,
  RoomPlacement,
  WallObject
} from "../../domain/project";
import { CURRENT_SCHEMA_VERSION } from "../../domain/project";
import { defaultDoorLeaf, syncPartnerLeaf } from "./openingEdits";

// Same fixture shape as the domain shared-opening tests: room-b flush to the
// right of room-a makes room-a's east wall and room-b's west wall one
// coincident twin pair (both 3000 mm long, mirroring x to 3000 − x).
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

// An imported clockwise-wound room. Only the polygon's winding is reversed —
// the walls still reference the same vertex ids, so every wall's authored
// direction and length is untouched. This is the state deriveRoom
// (scene3d.ts) exists to cope with, and the reason DoorLeaf stores
// `swingsToLeft` rather than `swingsInward`.
function clockwise(placement: RoomPlacement): RoomPlacement {
  return {
    ...placement,
    room: { ...placement.room, vertices: [...placement.room.vertices].reverse() }
  };
}

function project(rooms: RoomPlacement[], wallObjects: WallObject[] = []): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Hinged doors",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: { rooms },
    checklistArtworkIds: [],
    wallObjects,
    floorObjects: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z"
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
  overrides: Partial<DoorWallObject> = {}
): DoorWallObject {
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

const HINGED: DoorLeaf = { hingeAtStart: true, swingsToLeft: true };

function leafOf(wallObjects: WallObject[], id: string): DoorLeaf | undefined {
  const found = wallObjects.find((object) => object.id === id);
  return found?.kind === "door" ? found.leaf : undefined;
}

describe("defaultDoorLeaf", () => {
  it("hinges at the jamb nearer the closer wall end", () => {
    // A_EAST is 3000 mm long. The leaf should sweep into the open middle of the
    // wall, not out of the corner the door is tucked against.
    const base = project([room("room-a", 0)]);
    expect(defaultDoorLeaf(base, door("door-a", A_EAST, 400)).hingeAtStart).toBe(true);
    expect(defaultDoorLeaf(base, door("door-a", A_EAST, 2600)).hingeAtStart).toBe(false);
  });

  it("swings toward the interior — left for a counter-clockwise room", () => {
    const placement = room("room-a", 0);
    expect(signedAreaMm2(placement.room.vertices)).toBeGreaterThan(0);
    expect(defaultDoorLeaf(project([placement]), door("door-a", A_EAST, 400)).swingsToLeft).toBe(
      true
    );
  });

  it("swings the other way for a clockwise-wound imported room", () => {
    // The whole reason the stored flag is wall-local: "interior" is only the
    // left normal for a CCW room, so the answer is resolved HERE, once, and
    // never re-derived at render time.
    const placement = clockwise(room("room-a", 0));
    expect(signedAreaMm2(placement.room.vertices)).toBeLessThan(0);
    expect(defaultDoorLeaf(project([placement]), door("door-a", A_EAST, 400)).swingsToLeft).toBe(
      false
    );
  });

  it("falls back to a hinge at the start when the wall cannot be resolved", () => {
    const base = project([room("room-a", 0)]);
    expect(defaultDoorLeaf(base, door("door-a", "wall-gone", 400))).toEqual({
      hingeAtStart: true,
      swingsToLeft: true
    });
  });
});

describe("syncPartnerLeaf", () => {
  it("mirrors BOTH flags across a real shared boundary", () => {
    const target = door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b", leaf: HINGED });
    const partner = door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a" });
    const base = project([room("room-a", 0), room("room-b", 4000)], [target, partner]);

    const synced = syncPartnerLeaf(base, base.wallObjects, target, HINGED);

    // Twin walls are anti-parallel AND face opposite interiors: inverting only
    // one flag would put the far half's arc in the wrong physical quadrant.
    expect(leafOf(synced, "door-b")).toEqual({ hingeAtStart: false, swingsToLeft: false });
    expect(leafOf(synced, "door-a")).toEqual(HINGED);
  });

  it("clears the partner's leaf when the door goes back to a plain doorway", () => {
    const target = door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" });
    const partner = door("door-b", B_WEST, 1800, {
      connectsToObjectId: "door-a",
      leaf: { hingeAtStart: false, swingsToLeft: false }
    });
    const base = project([room("room-a", 0), room("room-b", 4000)], [target, partner]);

    const synced = syncPartnerLeaf(base, base.wallObjects, target, undefined);

    expect(leafOf(synced, "door-b")).toBeUndefined();
    // Cleared by DELETING the key, so a doorway serializes as it always did.
    const cleared = synced.find((object) => object.id === "door-b");
    expect(Object.keys(cleared ?? {})).not.toContain("leaf");
  });

  it("leaves a legacy pair on unrelated walls INDEPENDENT", () => {
    // connectsToObjectId does not imply the walls face each other:
    // isStructurallyValidPair deliberately preserves these. Their halves are
    // not two faces of one physical door, so handing does not propagate.
    const target = door("door-a", A_NORTH, 1200, { connectsToObjectId: "door-b", leaf: HINGED });
    const partner = door("door-b", A_SOUTH, 2400, { connectsToObjectId: "door-a" });
    const base = project([room("room-a", 0)], [target, partner]);

    const synced = syncPartnerLeaf(base, base.wallObjects, target, HINGED);

    expect(synced).toBe(base.wallObjects);
    expect(leafOf(synced, "door-b")).toBeUndefined();
  });

  it("leaves a pair whose boundary has been LOST independent too", () => {
    // The rooms have moved apart: the pointers survive (nothing severs them),
    // but the two walls no longer face each other, so this is the legacy case.
    const target = door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b", leaf: HINGED });
    const partner = door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a" });
    const base = project([room("room-a", 0), room("room-b", 40_000)], [target, partner]);

    expect(syncPartnerLeaf(base, base.wallObjects, target, HINGED)).toBe(base.wallObjects);
  });

  it("does nothing for an unpaired door", () => {
    const target = door("door-a", A_EAST, 1200, { leaf: HINGED });
    const base = project([room("room-a", 0), room("room-b", 4000)], [target]);

    expect(syncPartnerLeaf(base, base.wallObjects, target, HINGED)).toBe(base.wallObjects);
  });

  it("returns the input array when the partner already matches", () => {
    // The equality guard: a no-op sync must not mint a new array and make the
    // commit path think something changed.
    const target = door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b", leaf: HINGED });
    const partner = door("door-b", B_WEST, 1800, {
      connectsToObjectId: "door-a",
      leaf: { hingeAtStart: false, swingsToLeft: false }
    });
    const base = project([room("room-a", 0), room("room-b", 4000)], [target, partner]);

    expect(syncPartnerLeaf(base, base.wallObjects, target, HINGED)).toBe(base.wallObjects);
  });

  it("does not follow a dangling or cross-kind pointer", () => {
    // resolveLivePartner's structural check, not the raw pointer: a broken
    // door→window reference must not write a leaf onto a window.
    const target = door("door-a", A_EAST, 1200, { connectsToObjectId: "window-b", leaf: HINGED });
    const partner: WallObject = {
      id: "window-b",
      kind: "window",
      blocksPlacement: true,
      wallId: B_WEST,
      xMm: 1800,
      yMm: 1450,
      widthMm: 1200,
      heightMm: 1200,
      connectsToObjectId: "door-a"
    };
    const base = project([room("room-a", 0), room("room-b", 4000)], [target, partner]);

    expect(syncPartnerLeaf(base, base.wallObjects, target, HINGED)).toBe(base.wallObjects);
  });
});
