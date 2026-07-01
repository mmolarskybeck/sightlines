import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import { getFloorBounds, getOrthogonalQuadWallPair } from "./walls";

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
