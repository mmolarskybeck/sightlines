import { describe, expect, it } from "vitest";
import { getPlaceableFloorWalls, type FloorWall } from "../../../domain/geometry/planObjects";
import type { Floor, Room } from "../../../domain/project";
import {
  DROP_TARGET_USER_DATA_KEY,
  dropGhostTransform,
  findDropSurfaceTag,
  pickDropSurface,
  resolveThreeDrop,
  worldToFloorMm,
  type DropDimsMm,
  type TaggedObject3d
} from "./dropTarget";
import { MM_TO_WORLD } from "./coordinates";

const ROOM_HEIGHT_MM = 3000;

// A 4m x 3m room. `winding` flips the vertex order so the SAME four physical
// walls are authored in the opposite direction — the case scene3d.ts's
// `toPanelLocalX` remaps (and which this module must handle without any remap
// at all, because it reads the authored geometry directly).
function boxRoom(winding: "ccw" | "cw"): Room {
  const corners = [
    { id: "v-a", xMm: 0, yMm: 0 },
    { id: "v-b", xMm: 4000, yMm: 0 },
    { id: "v-c", xMm: 4000, yMm: 3000 },
    { id: "v-d", xMm: 0, yMm: 3000 }
  ];
  const vertices = winding === "ccw" ? corners : corners.slice().reverse();

  return {
    id: "room-1",
    name: "Room",
    heightMm: ROOM_HEIGHT_MM,
    freestandingWalls: [],
    vertices,
    walls: vertices.map((vertex, index) => ({
      id: `wall-${index}`,
      roomId: "room-1",
      name: `Wall ${index}`,
      startVertexId: vertex.id,
      endVertexId: vertices[(index + 1) % vertices.length].id,
      heightMm: ROOM_HEIGHT_MM
    }))
  };
}

function floorOf(room: Room, offsetXMm = 0, offsetYMm = 0): Floor {
  return { rooms: [{ roomId: room.id, offsetXMm, offsetYMm, rotationDeg: 0, room }] };
}

function wallsFor(room: Room, offsetXMm = 0, offsetYMm = 0): FloorWall[] {
  return getPlaceableFloorWalls(floorOf(room, offsetXMm, offsetYMm));
}

// Millimetre point on a wall/floor, expressed as a three world hit.
function worldHit(xMm: number, heightMm: number, yMm: number) {
  return { x: xMm * MM_TO_WORLD, y: heightMm * MM_TO_WORLD, z: yMm * MM_TO_WORLD };
}

const dims: DropDimsMm = {
  wallWidthMm: 600,
  wallHeightMm: 800,
  floorWidthMm: 600,
  floorDepthMm: 400
};

describe("worldToFloorMm", () => {
  it("maps three world (x, z) to floor-space mm", () => {
    expect(worldToFloorMm({ x: 1.5, y: 1.2, z: -0.25 })).toEqual({ xMm: 1500, yMm: -250 });
  });
});

describe("findDropSurfaceTag / pickDropSurface", () => {
  const wallTag = { [DROP_TARGET_USER_DATA_KEY]: { kind: "wall", wallId: "wall-0" } };

  it("finds the tag on an ancestor (wall meshes sit inside a rotated group)", () => {
    const group: TaggedObject3d = { userData: wallTag, parent: null };
    const mesh: TaggedObject3d = { userData: {}, parent: group };

    expect(findDropSurfaceTag(mesh)).toEqual({ kind: "wall", wallId: "wall-0" });
  });

  it("ignores untagged and malformed userData", () => {
    expect(findDropSurfaceTag({ userData: {}, parent: null })).toBeNull();
    expect(
      findDropSurfaceTag({
        userData: { [DROP_TARGET_USER_DATA_KEY]: { kind: "wall" } },
        parent: null
      })
    ).toBeNull();
    expect(findDropSurfaceTag(null)).toBeNull();
  });

  it("falls through artwork planes and pick bands to the surface behind", () => {
    const artworkPlane: TaggedObject3d = { userData: {}, parent: null };
    const wallGroup: TaggedObject3d = { userData: wallTag, parent: null };

    const picked = pickDropSurface([
      { object: artworkPlane, point: { x: 0, y: 0, z: 0 } },
      { object: wallGroup, point: { x: 1, y: 2, z: 3 } }
    ]);

    expect(picked).toEqual({
      tag: { kind: "wall", wallId: "wall-0" },
      point: { x: 1, y: 2, z: 3 }
    });
  });

  it("returns null when nothing under the cursor is a placement surface", () => {
    expect(pickDropSurface([{ object: { userData: {} }, point: { x: 0, y: 0, z: 0 } }])).toBeNull();
    expect(pickDropSurface([])).toBeNull();
  });
});

describe("resolveThreeDrop on a wall", () => {
  it("reads authored wall-local x from a counter-clockwise room", () => {
    const walls = wallsFor(boxRoom("ccw"));
    const south = walls.find((wall) => wall.id === "wall-0")!;
    expect(south.startFloorMm).toEqual({ xMm: 0, yMm: 0 });

    const result = resolveThreeDrop({
      point: worldHit(3000, 1500, 0),
      tag: { kind: "wall", wallId: "wall-0" },
      walls,
      dims
    });

    expect(result).toMatchObject({ anchor: "wall", wallId: "wall-0" });
    expect(result!.xMm).toBeCloseTo(3000);
    expect(result!.yMm).toBeCloseTo(1500);
  });

  it("measures from the AUTHORED start when the room is wound clockwise", () => {
    // The same physical wall, authored in the opposite direction: the hit is
    // 3000mm from the world origin but only 1000mm from this wall's own start.
    const walls = wallsFor(boxRoom("cw"));
    const south = walls.find(
      (wall) =>
        wall.startFloorMm.yMm === 0 &&
        wall.endFloorMm.yMm === 0 &&
        wall.startFloorMm.xMm === 4000
    )!;

    const result = resolveThreeDrop({
      point: worldHit(3000, 1500, 0),
      tag: { kind: "wall", wallId: south.id },
      walls,
      dims
    });

    expect(result!.xMm).toBeCloseTo(1000);
    // Ghost still lands at the physical hit point, whichever way the wall runs.
    expect(result!.ghost.centerXMm).toBeCloseTo(3000);
    expect(result!.ghost.centerYMm).toBeCloseTo(0);
  });

  it("honours the room's floor offset", () => {
    const walls = wallsFor(boxRoom("ccw"), 5000, 2000);
    const south = walls.find((wall) => wall.id === "wall-0")!;

    const result = resolveThreeDrop({
      point: worldHit(6000, 1200, 2000),
      tag: { kind: "wall", wallId: south.id },
      walls,
      dims
    });

    expect(result!.xMm).toBeCloseTo(1000);
    expect(result!.ghost.centerXMm).toBeCloseTo(6000);
    expect(result!.ghost.centerYMm).toBeCloseTo(2000);
  });

  it("clamps x so the work's full width stays on the wall", () => {
    const walls = wallsFor(boxRoom("ccw"));

    const atStart = resolveThreeDrop({
      point: worldHit(-500, 1500, 0),
      tag: { kind: "wall", wallId: "wall-0" },
      walls,
      dims
    });
    const atEnd = resolveThreeDrop({
      point: worldHit(9000, 1500, 0),
      tag: { kind: "wall", wallId: "wall-0" },
      walls,
      dims
    });

    expect(atStart!.xMm).toBeCloseTo(300);
    expect(atEnd!.xMm).toBeCloseTo(3700);
  });

  it("centers a work wider than the wall instead of clamping to an empty range", () => {
    const walls = wallsFor(boxRoom("ccw"));

    const result = resolveThreeDrop({
      point: worldHit(200, 1500, 0),
      tag: { kind: "wall", wallId: "wall-0" },
      walls,
      dims: { ...dims, wallWidthMm: 6000 }
    });

    expect(result!.xMm).toBeCloseTo(2000);
  });

  it("clamps y so the work stays within the wall height", () => {
    const walls = wallsFor(boxRoom("ccw"));

    const low = resolveThreeDrop({
      point: worldHit(2000, 10, 0),
      tag: { kind: "wall", wallId: "wall-0" },
      walls,
      dims
    });
    const high = resolveThreeDrop({
      point: worldHit(2000, 2990, 0),
      tag: { kind: "wall", wallId: "wall-0" },
      walls,
      dims
    });

    // Center-based y: half the 800mm height above the floor / below the ceiling.
    expect(low!.yMm).toBeCloseTo(400);
    expect(high!.yMm).toBeCloseTo(2600);
  });

  it("centers a work taller than the wall", () => {
    const walls = wallsFor(boxRoom("ccw"));

    const result = resolveThreeDrop({
      point: worldHit(2000, 100, 0),
      tag: { kind: "wall", wallId: "wall-0" },
      walls,
      dims: { ...dims, wallHeightMm: 4000 }
    });

    expect(result!.yMm).toBeCloseTo(1500);
  });

  it("refuses a wall that isn't in the placeable set (open wall, stale id)", () => {
    const room = boxRoom("ccw");
    room.walls[0].isOpenSide = true;
    const walls = wallsFor(room);

    expect(
      resolveThreeDrop({
        point: worldHit(2000, 1500, 0),
        tag: { kind: "wall", wallId: "wall-0" },
        walls,
        dims
      })
    ).toBeNull();
    expect(
      resolveThreeDrop({
        point: worldHit(2000, 1500, 0),
        tag: { kind: "wall", wallId: "wall-nope" },
        walls,
        dims
      })
    ).toBeNull();
  });

  it("places on a partition FACE, using the face's own offset centerline", () => {
    const room = boxRoom("ccw");
    room.freestandingWalls = [
      {
        id: "part-1",
        roomId: "room-1",
        name: "Partition",
        startXMm: 1000,
        startYMm: 1500,
        endXMm: 3000,
        endYMm: 1500,
        heightMm: 2400,
        thicknessMm: 100
      }
    ];
    const walls = wallsFor(room);

    const faceA = walls.find((wall) => wall.id === "part-1#a")!;
    const faceB = walls.find((wall) => wall.id === "part-1#b")!;
    // Face A runs start->end (+50mm on the left normal); face B runs back the
    // other way on the opposite side.
    expect(faceA.startFloorMm.xMm).toBeCloseTo(1000);
    expect(faceB.startFloorMm.xMm).toBeCloseTo(3000);

    const onA = resolveThreeDrop({
      point: worldHit(2500, 1200, faceA.startFloorMm.yMm),
      tag: { kind: "wall", wallId: "part-1#a" },
      walls,
      dims
    });
    const onB = resolveThreeDrop({
      point: worldHit(2500, 1200, faceB.startFloorMm.yMm),
      tag: { kind: "wall", wallId: "part-1#b" },
      walls,
      dims
    });

    expect(onA).toMatchObject({ anchor: "wall", wallId: "part-1#a" });
    expect(onA!.xMm).toBeCloseTo(1500);
    // Same physical spot, measured from the other face's own start.
    expect(onB).toMatchObject({ anchor: "wall", wallId: "part-1#b" });
    expect(onB!.xMm).toBeCloseTo(500);
    // The partition is only 2400mm tall — the y clamp uses the FACE's height,
    // not the room's.
    const high = resolveThreeDrop({
      point: worldHit(2500, 2390, faceA.startFloorMm.yMm),
      tag: { kind: "wall", wallId: "part-1#a" },
      walls,
      dims
    });
    expect(high!.yMm).toBeCloseTo(2000);
  });
});

describe("resolveThreeDrop on the floor", () => {
  it("maps the hit straight to a floor-space center", () => {
    const walls = wallsFor(boxRoom("ccw"));

    const result = resolveThreeDrop({
      point: worldHit(1800, 0, 900),
      tag: { kind: "floor", roomId: "room-1" },
      walls,
      dims
    });

    expect(result).toEqual({
      anchor: "floor",
      xMm: 1800,
      yMm: 900,
      ghost: {
        kind: "floor",
        centerXMm: 1800,
        centerYMm: 900,
        centerHeightMm: 0,
        rotationYRad: 0,
        widthMm: 600,
        heightMm: 400
      }
    });
  });

  it("places a wall-form work on the floor anyway (intent wins)", () => {
    // No form is passed in at all — the tag alone decides the anchor.
    const result = resolveThreeDrop({
      point: worldHit(100, 0, 100),
      tag: { kind: "floor", roomId: "room-1" },
      walls: [],
      dims
    });

    expect(result!.anchor).toBe("floor");
  });
});

describe("dropGhostTransform", () => {
  it("floats a wall ghost toward the camera and yaws it along the wall", () => {
    const walls = wallsFor(boxRoom("ccw"));
    const result = resolveThreeDrop({
      point: worldHit(2000, 1500, 0),
      tag: { kind: "wall", wallId: "wall-0" },
      walls,
      dims
    })!;

    // Camera inside the room, i.e. at +z from this wall.
    const transform = dropGhostTransform(result.ghost, { x: 2, y: 1.5, z: 4 });

    expect(transform.position[0]).toBeCloseTo(2);
    expect(transform.position[1]).toBeCloseTo(1.5);
    expect(transform.position[2]).toBeCloseTo(0.025);
    expect(transform.rotation[0]).toBe(0);
    expect(transform.rotation[1]).toBeCloseTo(0);
    expect(transform.rotation[2]).toBe(0);
    expect(transform.widthWorld).toBeCloseTo(0.6);
    expect(transform.heightWorld).toBeCloseTo(0.8);
  });

  it("lifts a floor ghost and lays it flat", () => {
    const transform = dropGhostTransform(
      {
        kind: "floor",
        centerXMm: 1000,
        centerYMm: 2000,
        centerHeightMm: 0,
        rotationYRad: 0,
        widthMm: 600,
        heightMm: 400
      },
      { x: 0, y: 5, z: 0 }
    );

    expect(transform.position).toEqual([1, 0.025, 2]);
    expect(transform.rotation).toEqual([Math.PI / 2, 0, 0]);
  });

  it("leaves the ghost flush when the camera sits on the surface point", () => {
    const transform = dropGhostTransform(
      {
        kind: "wall",
        centerXMm: 0,
        centerYMm: 0,
        centerHeightMm: 0,
        rotationYRad: 0,
        widthMm: 100,
        heightMm: 100
      },
      { x: 0, y: 0, z: 0 }
    );

    expect(transform.position).toEqual([0, 0, 0]);
  });
});
