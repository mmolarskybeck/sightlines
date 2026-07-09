import { describe, expect, it } from "vitest";
import { parseProject } from "../schema/projectSchema";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import {
  createNextPolygonRoom,
  createNextRectangleRoom,
  createPolygonRoomPlacement,
  createRectangularRoomPlacement
} from "./createRoom";
import { getFloorBounds, getWallsWithGeometry } from "./walls";

// Twice the signed area — > 0 is CCW in deriveScene3d's convention.
function signedAreaMm2(points: { xMm: number; yMm: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return sum / 2;
}

// A clockwise (signed area < 0) L-shape in floor space — the constructor
// should reverse it to CCW at creation.
const L_SHAPE = [
  { xMm: 1000, yMm: 1000 },
  { xMm: 1000, yMm: 4000 },
  { xMm: 3000, yMm: 4000 },
  { xMm: 3000, yMm: 2000 },
  { xMm: 5000, yMm: 2000 },
  { xMm: 5000, yMm: 1000 }
];

describe("createRectangularRoomPlacement", () => {
  it("creates a rectangle with stable vertex and wall ids", () => {
    const placement = createRectangularRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      widthMm: feetToMm(20),
      depthMm: feetToMm(14),
      heightMm: feetToMm(12),
      offsetXMm: feetToMm(36),
      offsetYMm: 0
    });

    expect(placement.room.vertices.map((vertex) => vertex.id)).toEqual([
      "room-2-v-nw",
      "room-2-v-ne",
      "room-2-v-se",
      "room-2-v-sw"
    ]);
    expect(placement.room.walls.map((wall) => wall.id)).toEqual([
      "room-2-wall-north",
      "room-2-wall-east",
      "room-2-wall-south",
      "room-2-wall-west"
    ]);
    expect(getWallsWithGeometry(placement.room)[0].lengthMm).toBeCloseTo(
      feetToMm(20)
    );
  });

  it("rejects non-positive dimensions", () => {
    expect(() =>
      createRectangularRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        widthMm: 0,
        depthMm: feetToMm(14),
        heightMm: feetToMm(12),
        offsetXMm: 0,
        offsetYMm: 0
      })
    ).toThrow(/greater than zero/);
  });
});

describe("createPolygonRoomPlacement", () => {
  it("creates an L-shaped room that round-trips parseProject validation", () => {
    const placement = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: L_SHAPE
    });

    expect(placement.room.vertices).toHaveLength(6);
    expect(placement.room.walls).toHaveLength(6);
    expect(placement.room.walls.map((wall) => wall.name)).toEqual([
      "Wall 1",
      "Wall 2",
      "Wall 3",
      "Wall 4",
      "Wall 5",
      "Wall 6"
    ]);
    // Offset is the bbox min; vertices are room-local.
    expect(placement.offsetXMm).toBe(1000);
    expect(placement.offsetYMm).toBe(1000);

    const project = createSampleProject();
    const withRoom: typeof project = {
      ...project,
      floor: { rooms: [...project.floor.rooms, placement] }
    };
    // The closed-loop invariant (schema superRefine) holds.
    expect(() => parseProject(withRoom)).not.toThrow();
  });

  it("normalises clockwise input to counter-clockwise", () => {
    const placement = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: L_SHAPE
    });

    // Stored vertices wind CCW (signed area > 0) regardless of input winding.
    expect(signedAreaMm2(placement.room.vertices)).toBeGreaterThan(0);
    // CW input was reversed: the first stored vertex is the last input point
    // (offset-adjusted), not the first.
    expect(placement.room.vertices[0]).toMatchObject({
      xMm: L_SHAPE[L_SHAPE.length - 1].xMm - 1000,
      yMm: L_SHAPE[L_SHAPE.length - 1].yMm - 1000
    });
  });

  it("leaves counter-clockwise input in place", () => {
    const ccw = L_SHAPE.slice().reverse();
    const placement = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: ccw
    });

    expect(signedAreaMm2(placement.room.vertices)).toBeGreaterThan(0);
    // Already CCW: order preserved, first vertex is the first input point.
    expect(placement.room.vertices[0]).toMatchObject({
      xMm: ccw[0].xMm - 1000,
      yMm: ccw[0].yMm - 1000
    });
  });

  it("rejects fewer than three points", () => {
    expect(() =>
      createPolygonRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        heightMm: feetToMm(12),
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 1000, yMm: 0 }
        ]
      })
    ).toThrow(/at least three/);
  });

  it("rejects near-coincident consecutive points", () => {
    expect(() =>
      createPolygonRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        heightMm: feetToMm(12),
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 3, yMm: 0 }, // < 10 mm from the previous point
          { xMm: 1000, yMm: 1000 }
        ]
      })
    ).toThrow(/too close/);
  });

  it("rejects a self-intersecting outline", () => {
    expect(() =>
      createPolygonRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        heightMm: feetToMm(12),
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 1000, yMm: 1000 },
          { xMm: 1000, yMm: 0 },
          { xMm: 0, yMm: 1000 }
        ]
      })
    ).toThrow(/cross itself/);
  });
});

describe("createNextPolygonRoom", () => {
  it("names and numbers the next room off the existing floor", () => {
    const project = createSampleProject();
    const placement = createNextPolygonRoom(
      project.floor,
      project.defaultWallHeightMm,
      L_SHAPE
    );

    expect(placement.roomId).toBe("room-2");
    expect(placement.room.name).toBe("Gallery 2");
    expect(placement.room.walls[0].id).toBe("room-2-wall-0");
  });
});

describe("createNextRectangleRoom", () => {
  it("places a new rectangle to the right of the existing floor", () => {
    const project = createSampleProject();
    const room = createNextRectangleRoom(
      project.floor,
      project.defaultWallHeightMm
    );
    const nextFloor = { rooms: [...project.floor.rooms, room] };

    expect(room.roomId).toBe("room-2");
    expect(room.room.name).toBe("Gallery 2");
    expect(room.offsetXMm).toBeCloseTo(feetToMm(36));
    expect(getFloorBounds(nextFloor).width).toBeCloseTo(feetToMm(56));
  });
});
