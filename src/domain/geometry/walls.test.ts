import { describe, expect, it } from "vitest";
import type { Project, Room, RoomPlacement } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import { createPolygonRoomPlacement, createRectangularRoomPlacement } from "./createRoom";
import { moveRoomWall } from "./reshapeRoom";
import {
  changedWallLengthIds,
  getFloorBounds,
  getOrthogonalQuadWallPair,
  getRectangleRoomDimensions,
  getWallsWithGeometry,
  isRectangleRoom,
  outwardWallNormal
} from "./walls";

// A drawn quadrilateral with four walls and a valid loop, but slanted sides —
// exactly the shape that used to slip past the counts-only rectangle gates
// and get squared into a rectangle by resizeOrthogonalQuad.
function trapezoidRoom() {
  return createPolygonRoomPlacement({
    roomId: "room-trapezoid",
    name: "Trapezoid",
    heightMm: 3000,
    pointsFloorMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 9000, yMm: 0 },
      { xMm: 7000, yMm: 5000 },
      { xMm: 2000, yMm: 5000 }
    ]
  }).room;
}

// A concave L: the six-vertex loop bites a rectangular notch out of the
// bottom-right corner, so two of its walls (the notch's inner horizontal and
// vertical faces) meet at a reflex angle. This is exactly the shape a
// centroid-based heuristic mis-signs — the bbox center sits inside the
// rectangle the notch was cut from, on the wrong side of both inner walls.
function lShapeRoom(): Room {
  return createPolygonRoomPlacement({
    roomId: "room-l",
    name: "L Room",
    heightMm: 3000,
    pointsFloorMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 6000, yMm: 0 },
      { xMm: 6000, yMm: 3000 },
      { xMm: 3000, yMm: 3000 },
      { xMm: 3000, yMm: 6000 },
      { xMm: 0, yMm: 6000 }
    ]
  }).room;
}

describe("outwardWallNormal", () => {
  it("points away from the interior for every wall of a concave L, including the two inner-corner walls", () => {
    const room = lShapeRoom();
    const walls = getWallsWithGeometry(room);

    // Expected outward unit normal per wall, indexed to the pointsFloorMm
    // above (wall i runs vertex i -> vertex i+1). Walls 2 and 3 are the
    // notch's inner walls: a bbox-centroid heuristic (center at (3000,3000))
    // scores both with a zero-or-wrong-sign dot product and picks the side
    // that faces INTO the room instead of out of it.
    const expected: Record<number, { xMm: number; yMm: number }> = {
      0: { xMm: 0, yMm: -1 }, // bottom edge (0,0)->(6000,0)
      1: { xMm: 1, yMm: 0 }, // right edge (6000,0)->(6000,3000)
      2: { xMm: 0, yMm: 1 }, // inner horizontal wall (6000,3000)->(3000,3000)
      3: { xMm: 1, yMm: 0 }, // inner vertical wall (3000,3000)->(3000,6000)
      4: { xMm: 0, yMm: 1 }, // top edge (3000,6000)->(0,6000)
      5: { xMm: -1, yMm: 0 } // left edge (0,6000)->(0,0)
    };

    walls.forEach((wall, index) => {
      const normal = outwardWallNormal(room, wall);
      expect(normal.xMm).toBeCloseTo(expected[index].xMm);
      expect(normal.yMm).toBeCloseTo(expected[index].yMm);
    });
  });
});

describe("getOrthogonalQuadWallPair", () => {
  it("returns the opposing wall for a four-wall rectangle", () => {
    const project = createSampleProject();
    const room = project.floor.rooms[0].room;

    const northPair = getOrthogonalQuadWallPair(room, "wall-north");
    const eastPair = getOrthogonalQuadWallPair(room, "wall-east");

    expect(northPair?.selectedWall.name).toBe("North wall");
    expect(northPair?.pairedWall.name).toBe("South wall");
    expect(northPair?.pairedWall.lengthMm).toBeCloseTo(feetToMm(28));
    expect(eastPair?.selectedWall.name).toBe("East wall");
    expect(eastPair?.pairedWall.name).toBe("West wall");
    expect(eastPair?.pairedWall.lengthMm).toBeCloseTo(feetToMm(18));
  });

  it("does not infer a pair when wall order no longer forms a loop", () => {
    const project = createSampleProject();
    const room = {
      ...project.floor.rooms[0].room,
      walls: project.floor.rooms[0].room.walls.map((wall) =>
        wall.id === "wall-east" ? { ...wall, startVertexId: "v-sw" } : wall
      )
    };

    expect(getOrthogonalQuadWallPair(room, "wall-north")).toBeNull();
  });

  it("returns null for a four-wall trapezoid — corners must be right angles", () => {
    const room = trapezoidRoom();

    for (const wall of room.walls) {
      expect(getOrthogonalQuadWallPair(room, wall.id)).toBeNull();
    }
  });
});

describe("isRectangleRoom", () => {
  it("accepts the sample rectangle and rejects a trapezoid", () => {
    const project = createSampleProject();

    expect(isRectangleRoom(project.floor.rooms[0].room)).toBe(true);
    expect(isRectangleRoom(trapezoidRoom())).toBe(false);
  });
});

describe("getRectangleRoomDimensions", () => {
  it("reads width from the north/south pair and depth from the east/west pair", () => {
    const project = createSampleProject();
    const room = project.floor.rooms[0].room;

    const dimensions = getRectangleRoomDimensions(room);

    expect(dimensions?.widthWallId).toBe("wall-north");
    expect(dimensions?.widthMm).toBeCloseTo(feetToMm(28));
    expect(dimensions?.depthWallId).toBe("wall-east");
    expect(dimensions?.depthMm).toBeCloseTo(feetToMm(18));
  });

  it("returns null when the room is not a four-wall loop", () => {
    const project = createSampleProject();
    const room = {
      ...project.floor.rooms[0].room,
      walls: project.floor.rooms[0].room.walls.slice(0, 3)
    };

    expect(getRectangleRoomDimensions(room)).toBeNull();
  });

  it("returns null when wall order no longer forms a loop", () => {
    const project = createSampleProject();
    const room = {
      ...project.floor.rooms[0].room,
      walls: project.floor.rooms[0].room.walls.map((wall) =>
        wall.id === "wall-east" ? { ...wall, startVertexId: "v-sw" } : wall
      )
    };

    expect(getRectangleRoomDimensions(room)).toBeNull();
  });

  it("returns null for a four-wall trapezoid, so rectangle-only UI never appears on it", () => {
    expect(getRectangleRoomDimensions(trapezoidRoom())).toBeNull();
  });
});

describe("getFloorBounds", () => {
  it("combines placed room bounds across a shared floor", () => {
    const project = createSampleProject();
    const room = project.floor.rooms[0];
    const floor = {
      rooms: [
        room,
        {
          ...room,
          roomId: "room-east",
          offsetXMm: feetToMm(40),
          offsetYMm: feetToMm(8),
          room: {
            ...room.room,
            id: "room-east",
            name: "East Gallery"
          }
        }
      ]
    };

    const bounds = getFloorBounds(floor);

    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBeCloseTo(feetToMm(68));
    expect(bounds.maxY).toBeCloseTo(feetToMm(26));
    expect(bounds.width).toBeCloseTo(feetToMm(68));
    expect(bounds.height).toBeCloseTo(feetToMm(26));
  });

  it("returns a zero-sized fallback for an empty floor", () => {
    expect(getFloorBounds({ rooms: [] })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0
    });
  });
});

// The drag-preview diff behind PlanView's live length labels: whatever the
// gesture, the walls it reports are exactly the ones whose lengths moved.
describe("changedWallLengthIds", () => {
  function wrapInProject(placement: RoomPlacement): Project {
    return {
      id: "p",
      schemaVersion: 3,
      title: "t",
      unit: "m",
      defaultWallHeightMm: 3000,
      defaultCenterlineHeightMm: 1450,
      checklistArtworkIds: [],
      wallObjects: [],
      floorObjects: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      floor: { rooms: [placement] }
    };
  }

  function rectangle(): RoomPlacement {
    return createRectangularRoomPlacement({
      roomId: "room-1",
      name: "Rect",
      widthMm: 6000,
      depthMm: 4000,
      heightMm: 3000,
      offsetXMm: 0,
      offsetYMm: 0
    });
  }

  function moveVertices(room: Room, vertexIds: string[], dxMm: number, dyMm: number): Room {
    const moving = new Set(vertexIds);
    return {
      ...room,
      vertices: room.vertices.map((vertex) =>
        moving.has(vertex.id)
          ? { ...vertex, xMm: vertex.xMm + dxMm, yMm: vertex.yMm + dyMm }
          : vertex
      )
    };
  }

  it("identical rooms diff to nothing", () => {
    const room = rectangle().room;
    expect(changedWallLengthIds(room, room)).toEqual([]);
  });

  it("a rectangle wall translation reports the two NEIGHBOURS, not the dragged wall", () => {
    const baseline = rectangle().room;
    // Slide the north wall up 500mm: its own length is constant; east and
    // west stretch.
    const preview = moveVertices(baseline, ["room-1-v-nw", "room-1-v-ne"], 0, -500);

    expect(changedWallLengthIds(baseline, preview)).toEqual([
      "room-1-wall-east",
      "room-1-wall-west"
    ]);
  });

  it("sliding a trapezoid wall between non-parallel neighbours reports the dragged wall too", () => {
    const baseline = createPolygonRoomPlacement({
      roomId: "room-trap",
      name: "Trapezoid",
      heightMm: 3000,
      pointsFloorMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 9000, yMm: 0 },
        { xMm: 7000, yMm: 5000 },
        { xMm: 2000, yMm: 5000 }
      ]
    });
    const bottomWall = baseline.room.walls[0];
    const preview = moveRoomWall(wrapInProject(baseline), "room-trap", bottomWall.id, 500)
      .project.floor.rooms[0].room;

    const changed = changedWallLengthIds(baseline.room, preview);
    // The slanted neighbours trim/extend AND re-intersect the dragged wall's
    // endpoints, so all three lengths move; the far parallel wall doesn't.
    expect(changed).toContain(bottomWall.id);
    expect(changed).toHaveLength(3);
  });

  it("a vertex move reports the two incident walls", () => {
    const baseline = rectangle().room;
    const preview = moveVertices(baseline, ["room-1-v-se"], 300, 400);

    expect(changedWallLengthIds(baseline, preview)).toEqual([
      "room-1-wall-east",
      "room-1-wall-south"
    ]);
  });

  it("absorbs sub-epsilon float noise", () => {
    const baseline = rectangle().room;
    const preview = moveVertices(baseline, ["room-1-v-se"], 0.0003, 0.0002);

    expect(changedWallLengthIds(baseline, preview)).toEqual([]);
  });
});
