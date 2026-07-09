import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type OpeningWallObject } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm, inchesToMm } from "../units/length";
import {
  MAX_IMPORT_JSON_LENGTH,
  migrateProject,
  migrateProjectJson,
  parseProject
} from "./projectSchema";

function makeOpening(
  overrides: Partial<OpeningWallObject & { connectsToObjectId?: string }> = {}
): OpeningWallObject {
  return {
    id: "opening-1",
    kind: "door",
    blocksPlacement: true,
    wallId: "wall-north",
    xMm: feetToMm(5),
    yMm: inchesToMm(40),
    widthMm: feetToMm(3),
    heightMm: inchesToMm(80),
    ...overrides
  } as OpeningWallObject;
}

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

  describe("OpeningWallObject", () => {
    it("accepts a door, a window, and a blocked zone", () => {
      const project = createSampleProject();
      project.wallObjects = [
        makeOpening({ id: "door-1", kind: "door" }),
        makeOpening({ id: "window-1", kind: "window" }),
        makeOpening({ id: "zone-1", kind: "blocked-zone" })
      ];

      const parsed = parseProject(project);
      expect(parsed.wallObjects.map((wallObject) => wallObject.kind)).toEqual([
        "door",
        "window",
        "blocked-zone"
      ]);
    });

    it("accepts a symmetric door↔door pairing via connectsToObjectId", () => {
      const project = createSampleProject();
      project.wallObjects = [
        makeOpening({ id: "door-a", kind: "door", wallId: "wall-north", connectsToObjectId: "door-b" }),
        makeOpening({ id: "door-b", kind: "door", wallId: "wall-south", connectsToObjectId: "door-a" })
      ];

      const parsed = parseProject(project);
      const doorA = parsed.wallObjects.find((object) => object.id === "door-a");
      expect(doorA?.kind === "door" ? doorA.connectsToObjectId : null).toBe("door-b");
    });

    it("rejects an asymmetric (one-sided) pairing", () => {
      const project = createSampleProject();
      project.wallObjects = [
        makeOpening({ id: "door-a", kind: "door", wallId: "wall-north", connectsToObjectId: "door-b" }),
        makeOpening({ id: "door-b", kind: "door", wallId: "wall-south" })
      ];

      expect(() => parseProject(project)).toThrow(/not symmetric/i);
    });

    it("rejects an opening kind outside door/window/blocked-zone", () => {
      const project = createSampleProject();
      project.wallObjects = [makeOpening({ kind: "skylight" as OpeningWallObject["kind"] })];

      expect(() => parseProject(project)).toThrow();
    });

    it("rejects an opening whose wallId references a wall that doesn't exist — same invariant as artwork placements", () => {
      // Note: wallId isn't cross-checked against the room's walls at parse
      // time for either artwork or opening placements today (that check
      // happens at validatePlacement time, via a "missing wall" warning,
      // not at schema time) — this test documents that an opening still
      // parses structurally even with a dangling wallId, the same as an
      // artwork wall object does.
      const project = createSampleProject();
      project.wallObjects = [makeOpening({ wallId: "wall-does-not-exist" })];

      expect(() => parseProject(project)).not.toThrow();
    });

    it("rejects blocksPlacement: false — the schema pins it to the literal true", () => {
      const project = createSampleProject();
      project.wallObjects = [
        { ...makeOpening(), blocksPlacement: false as unknown as true }
      ];

      expect(() => parseProject(project)).toThrow();
    });

    it("keeps existing artwork-only projects valid — additive, no schema version bump", () => {
      const project = createSampleProject();
      expect(project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      project.wallObjects = [
        {
          id: "artwork-placement-1",
          kind: "artwork",
          artworkId: "artwork-1",
          wallId: "wall-north",
          xMm: feetToMm(5),
          yMm: inchesToMm(57),
          widthMm: feetToMm(2),
          heightMm: feetToMm(3)
        }
      ];

      expect(() => parseProject(project)).not.toThrow();
    });
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

  it("walks a real v1 document 1→2→3, landing at v3 and parsing", () => {
    // A genuine v1 doc predates BOTH floorObjects (v2) and freestandingWalls
    // (v3), so strip them from the current-shape sample before stamping v1.
    const { floorObjects: _floorObjects, ...currentShape } = createSampleProject();
    const v1Document = {
      ...currentShape,
      schemaVersion: 1,
      floor: {
        rooms: currentShape.floor.rooms.map((placement) => {
          const { freestandingWalls: _drop, ...room } = placement.room;
          return { ...placement, room };
        })
      }
    };

    const migrated = migrateProject(v1Document);

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.floorObjects).toEqual([]);
    expect(migrated.floor.rooms[0].room.freestandingWalls).toEqual([]);
  });

  it("migrates a v2 document to v3, adding freestandingWalls and dropping connectsToWallId", () => {
    const sample = createSampleProject();
    const v2Document = {
      ...sample,
      schemaVersion: 2,
      floor: {
        rooms: sample.floor.rooms.map((placement) => {
          const { freestandingWalls: _drop, ...room } = placement.room;
          return { ...placement, room };
        })
      },
      // A never-written legacy field the migration must discard.
      wallObjects: [
        {
          id: "door-legacy",
          kind: "door",
          blocksPlacement: true,
          wallId: "wall-north",
          xMm: 1000,
          yMm: 1000,
          widthMm: 900,
          heightMm: 2000,
          connectsToWallId: "wall-south"
        }
      ]
    };

    const migrated = migrateProject(v2Document);

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.floor.rooms[0].room.freestandingWalls).toEqual([]);
    expect(
      (migrated.wallObjects[0] as Record<string, unknown>).connectsToWallId
    ).toBeUndefined();
  });

  it("round-trips a v2 document that already has floor objects", () => {
    const project = createSampleProject();
    project.floorObjects = [
      {
        id: "floor-artwork-1",
        kind: "artwork",
        artworkId: "artwork-1",
        xMm: feetToMm(10),
        yMm: feetToMm(5),
        widthMm: feetToMm(2),
        depthMm: 400,
        rotationDeg: 0,
        heightMm: feetToMm(3),
        wallYMm: inchesToMm(57)
      }
    ];

    expect(migrateProject(project)).toEqual(project);
  });

  it("rejects a document from a newer schema version than this app supports", () => {
    const fromTheFuture = { ...createSampleProject(), schemaVersion: 4 };

    expect(() => migrateProject(fromTheFuture)).toThrow(/newer version of Sightlines/);
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
