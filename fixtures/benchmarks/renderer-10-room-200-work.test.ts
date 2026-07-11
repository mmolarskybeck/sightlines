import { describe, expect, it } from "vitest";
import { parseProject } from "../../src/domain/schema/projectSchema";
import {
  rendererBenchmarkArtworks,
  rendererBenchmarkProject,
  rendererBenchmarkWallObjects
} from "./renderer-10-room-200-work";

describe("renderer benchmark fixture", () => {
  it("is a valid 10-room, 200-work project", () => {
    expect(rendererBenchmarkProject.floor.rooms).toHaveLength(10);
    expect(rendererBenchmarkArtworks).toHaveLength(200);
    expect(rendererBenchmarkWallObjects).toHaveLength(200);
    expect(parseProject(rendererBenchmarkProject)).toEqual(rendererBenchmarkProject);
  });
});
