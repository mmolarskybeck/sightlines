import { describe, expect, it } from "vitest";
import { createBlankProject } from "./newProject";
import { parseProject } from "./schema/projectSchema";

describe("createBlankProject", () => {
  it("creates a schema-valid project with no rooms and no checklist", () => {
    const project = createBlankProject("New Show");

    expect(project.title).toBe("New Show");
    expect(project.floor.rooms).toEqual([]);
    expect(project.checklistArtworkIds).toEqual([]);
    expect(project.wallObjects).toEqual([]);
    expect(() => parseProject(project)).not.toThrow();
  });

  it("gives each new project a distinct id", () => {
    const first = createBlankProject("A");
    const second = createBlankProject("B");

    expect(first.id).not.toBe(second.id);
  });
});
