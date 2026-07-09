import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import { createPolygonRoomPlacement } from "./createRoom";
import {
  getFloorBounds,
  getOrthogonalQuadWallPair,
  getRectangleRoomDimensions,
  isRectangleRoom
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
