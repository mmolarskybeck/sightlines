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
});
