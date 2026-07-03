import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import {
  MAX_IMPORT_JSON_LENGTH,
  migrateProject,
  migrateProjectJson,
  parseProject
} from "./projectSchema";

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

describe("migrateProject", () => {
  it("rejects input with no recognizable schemaVersion as not a Sightlines project", () => {
    expect(() => migrateProject({ hello: 1 })).toThrow(/not a Sightlines project/);
    expect(() => migrateProject("just a string")).toThrow(/not a Sightlines project/);
    expect(() => migrateProject(null)).toThrow(/not a Sightlines project/);
  });

  it("distinguishes a newer schema version from a generally unrecognized file", () => {
    const fromTheFuture = { ...createSampleProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };

    expect(() => migrateProject(fromTheFuture)).toThrow(/newer version of Sightlines/);
    expect(() => migrateProject(fromTheFuture)).toThrow(
      new RegExp(`schema version ${CURRENT_SCHEMA_VERSION + 1}`)
    );
  });

  it("reports a readable reason for a same-version document that fails validation", () => {
    const project = createSampleProject();
    project.floor.rooms[0].room.walls[0].startVertexId = "missing";

    expect(() => migrateProject(project)).toThrow(/doesn't match the Sightlines format/);
    expect(() => migrateProject(project)).toThrow(/missing start vertex/);
  });

  it("defaults wall objects for older v1 project documents (via migrateProject too)", () => {
    const { wallObjects: _wallObjects, ...olderProject } = createSampleProject();

    expect(migrateProject(olderProject).wallObjects).toEqual([]);
  });
});

describe("migrateProjectJson", () => {
  it("rejects text over the size cap before attempting to parse it", () => {
    const oversized = "a".repeat(MAX_IMPORT_JSON_LENGTH + 1);

    expect(() => migrateProjectJson(oversized)).toThrow(/too large/);
    expect(() => migrateProjectJson(oversized)).toThrow(/20\.0 MB/);
  });

  it("accepts text right at the size cap (rejects strictly over, not at)", () => {
    // Padding a real, valid project's JSON out to exactly the cap proves the
    // boundary is ">" not ">=" without hand-rolling a second parser.
    const json = JSON.stringify(createSampleProject());
    const padded = json.slice(0, -1) + " ".repeat(MAX_IMPORT_JSON_LENGTH - json.length) + json.slice(-1);

    expect(padded.length).toBe(MAX_IMPORT_JSON_LENGTH);
    expect(() => migrateProjectJson(padded)).not.toThrow();
  });

  it("rejects text that is not valid JSON, distinctly from a bad shape", () => {
    expect(() => migrateProjectJson("not json at all")).toThrow(/not valid JSON/);
  });

  it("rejects non-string input instead of throwing an opaque runtime error", () => {
    // TS forbids this at the call sites we own, but a file-reading callback
    // gone wrong could still hand this function something that isn't a string.
    expect(() => migrateProjectJson(null as unknown as string)).toThrow(
      /no file content was provided/
    );
    expect(() => migrateProjectJson(undefined as unknown as string)).toThrow(
      /no file content was provided/
    );
  });

  it("round-trips a project through export-shaped JSON without loss", () => {
    const project = createSampleProject();
    const json = JSON.stringify(project, null, 2);

    expect(migrateProjectJson(json)).toEqual(project);
  });
});
