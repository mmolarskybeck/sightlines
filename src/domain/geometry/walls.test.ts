import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import { getOrthogonalQuadWallPair } from "./walls";

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
