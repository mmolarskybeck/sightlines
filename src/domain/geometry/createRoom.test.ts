import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import {
  createNextRectangleRoom,
  createRectangularRoomPlacement
} from "./createRoom";
import { getFloorBounds, getWallsWithGeometry } from "./walls";

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
