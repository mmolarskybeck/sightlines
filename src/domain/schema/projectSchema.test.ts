import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { parseProject } from "./projectSchema";

describe("projectSchema", () => {
  it("accepts the sample project", () => {
    expect(parseProject(createSampleProject()).title).toBe("Untitled Exhibition");
  });

  it("defaults wall objects for older v1 project documents", () => {
    const { wallObjects, ...olderProject } = createSampleProject();

    expect(parseProject(olderProject).wallObjects).toEqual([]);
    expect(wallObjects).toEqual([]);
  });

  it("rejects walls with missing vertex references", () => {
    const project = createSampleProject();
    project.floor.rooms[0].room.walls[0].startVertexId = "missing";

    expect(() => parseProject(project)).toThrow(/missing start vertex/);
  });

  it("rejects rooms whose walls do not form a closed loop", () => {
    const project = createSampleProject();
    const room = project.floor.rooms[0].room;
    // Break the chain: wall 1 no longer starts where wall 0 ends.
    room.walls[1].startVertexId = room.walls[1].endVertexId;

    expect(() => parseProject(project)).toThrow(/closed loop/);
  });

  it("rejects non-zero room rotation until rotation is implemented", () => {
    const project = createSampleProject();
    project.floor.rooms[0].rotationDeg = 45;

    expect(() => parseProject(project)).toThrow(/rotation is not supported/i);
  });

  it("rejects a placement whose roomId disagrees with the embedded room", () => {
    const project = createSampleProject();
    project.floor.rooms[0].roomId = "some-other-room";

    expect(() => parseProject(project)).toThrow(/contains room/);
  });

  it("rejects a wall whose roomId disagrees with its containing room", () => {
    const project = createSampleProject();
    project.floor.rooms[0].room.walls[0].roomId = "some-other-room";

    expect(() => parseProject(project)).toThrow(/declares roomId/);
  });
});
