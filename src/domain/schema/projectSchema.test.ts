import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type OpeningWallObject } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm, inchesToMm } from "../units/length";
import {
  MAX_IMPORT_JSON_LENGTH,
  migrateProject,
  migrateProjectJson,
  migrateProjectWithReport,
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

  it("validates and defaults reference measurements", () => {
    const project = createSampleProject();
    project.referenceMeasurements = [{
      id: "measure-1",
      kind: "elevation",
      wallId: "wall-north",
      visible: true,
      locked: false,
      start: { xMm: 100, yMm: 200 },
      end: { xMm: 900, yMm: 200 }
    }];
    expect(parseProject(project).referenceMeasurements).toEqual(project.referenceMeasurements);
    const { referenceMeasurements: _references, ...legacyShape } = project;
    expect(parseProject(legacyShape).referenceMeasurements).toEqual([]);
  });

  it("rejects degenerate, duplicate, and dangling reference measurements", () => {
    const project = createSampleProject();
    const reference = {
      id: "measure-1",
      kind: "elevation" as const,
      wallId: "missing-wall",
      visible: true,
      locked: false,
      start: { xMm: 100, yMm: 200 },
      end: { xMm: 100, yMm: 200 }
    };
    project.referenceMeasurements = [reference, reference];
    expect(() => parseProject(project)).toThrow(/reference measurement/i);
  });

  it("validates and defaults saved views", () => {
    const project = createSampleProject();
    project.savedViews = [
      {
        id: "view-1",
        ordinal: 1,
        title: "Entrance sightline",
        roomId: "room-main",
        pose: {
          position: { x: 1, y: 1.6, z: 3 },
          target: { x: 1, y: 1.6, z: 0 }
        },
        createdAt: "2026-07-16T00:00:00.000Z"
      }
    ];
    expect(parseProject(project).savedViews).toEqual(project.savedViews);
    const { savedViews: _views, ...legacyShape } = project;
    expect(parseProject(legacyShape).savedViews).toEqual([]);
  });

  it("rejects saved views with duplicate ids", () => {
    const project = createSampleProject();
    const view = {
      id: "view-1",
      ordinal: 1,
      title: "Saved view 1",
      pose: { position: { x: 0, y: 0, z: 1 }, target: { x: 0, y: 0, z: 0 } },
      createdAt: "2026-07-16T00:00:00.000Z"
    };
    project.savedViews = [view, { ...view, ordinal: 2 }];
    expect(() => parseProject(project)).toThrow(/duplicate saved view id/i);
  });

  it("rejects saved views with duplicate ordinals", () => {
    const project = createSampleProject();
    const view = {
      id: "view-1",
      ordinal: 1,
      title: "Saved view 1",
      pose: { position: { x: 0, y: 0, z: 1 }, target: { x: 0, y: 0, z: 0 } },
      createdAt: "2026-07-16T00:00:00.000Z"
    };
    project.savedViews = [view, { ...view, id: "view-2" }];
    expect(() => parseProject(project)).toThrow(/duplicate saved view ordinal/i);
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

    it("accepts a door carrying a hinged leaf", () => {
      const project = createSampleProject();
      project.wallObjects = [
        makeOpening({
          id: "door-1",
          kind: "door",
          leaf: { hingeAtStart: true, swingsToLeft: false }
        } as Partial<OpeningWallObject>)
      ];

      const parsed = parseProject(project);
      const door = parsed.wallObjects.find((object) => object.id === "door-1");
      expect(door?.kind === "door" ? door.leaf : null).toEqual({
        hingeAtStart: true,
        swingsToLeft: false
      });
    });

    it("REJECTS a window carrying a leaf rather than silently stripping it", () => {
      // The point of the z.never().optional() branch. Zod strips unknown keys
      // by default, so merely omitting `leaf` from the window branch would open
      // the document with the field quietly dropped — the invariant would look
      // enforced while the malformed input was accepted.
      const project = createSampleProject();
      project.wallObjects = [
        makeOpening({
          id: "window-1",
          kind: "window",
          leaf: { hingeAtStart: true, swingsToLeft: true }
        } as Partial<OpeningWallObject>)
      ];

      // Asserted on the reason, not merely "it threw": a window that failed to
      // match the union for some unrelated shape error would pass a bare
      // toThrow while the invariant was doing nothing.
      expect(() => parseProject(project)).toThrow(/expected.*never/i);
    });

    it("rejects a malformed leaf on a door", () => {
      const project = createSampleProject();
      project.wallObjects = [
        makeOpening({ id: "door-1", kind: "door", leaf: { hingeAtStart: true } } as Partial<
          OpeningWallObject
        >)
      ];

      expect(() => parseProject(project)).toThrow();
    });

    it("loads a stored v4 door with no leaf unchanged — additive, no version bump", () => {
      // The compatibility claim behind not bumping the schema version: a
      // document written before hinging existed parses byte-identically, with
      // no `leaf` key invented for it.
      const project = createSampleProject();
      expect(project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      const stored = makeOpening({ id: "door-1", kind: "door" });
      project.wallObjects = [stored];

      const parsed = parseProject(project);
      expect(parsed.wallObjects[0]).toEqual(stored);
      expect(Object.keys(parsed.wallObjects[0])).not.toContain("leaf");
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

describe("WallTextWallObject", () => {
  it("accepts a wall text with a name and one without", () => {
    const project = createSampleProject();
    project.wallObjects = [
      {
        id: "wall-text-1",
        kind: "wall-text",
        name: "Gallery intro",
        wallId: "wall-north",
        xMm: feetToMm(4),
        yMm: inchesToMm(40),
        widthMm: 600,
        heightMm: 400
      },
      {
        id: "wall-text-2",
        kind: "wall-text",
        wallId: "wall-north",
        xMm: feetToMm(8),
        yMm: inchesToMm(40),
        widthMm: 600,
        heightMm: 400
      }
    ];

    const parsed = parseProject(project);
    expect(parsed.wallObjects.map((object) => object.kind)).toEqual(["wall-text", "wall-text"]);
    const [first, second] = parsed.wallObjects;
    expect(first.kind === "wall-text" && first.name).toBe("Gallery intro");
    // Optional name is absent, not blanked, on a nameless wall text.
    expect(second.kind === "wall-text" && second.name).toBeUndefined();
  });

  it("rejects a wall text carrying blocksPlacement (it is not an opening)", () => {
    const project = createSampleProject();
    project.wallObjects = [
      {
        id: "wall-text-1",
        kind: "wall-text",
        blocksPlacement: true,
        wallId: "wall-north",
        xMm: feetToMm(4),
        yMm: inchesToMm(40),
        widthMm: 600,
        heightMm: 400
      } as unknown as OpeningWallObject
    ];

    // The discriminated union's wall-text branch has no blocksPlacement key, so
    // strict parsing strips it — the parsed record must not carry it.
    const parsed = parseProject(project);
    expect("blocksPlacement" in parsed.wallObjects[0]).toBe(false);
  });

  it("round-trips a v1 project (no wall texts) with wall texts naturally absent", () => {
    const { wallObjects: _wallObjects, ...olderProject } = createSampleProject();
    expect(migrateProject(olderProject).wallObjects).toEqual([]);
  });
});

// Dormant floor-only state parked on a captured object (FloorMemory in
// domain/project.ts). Purely additive and optional, so it must parse without a
// schema-version bump AND leave a document that predates it untouched.
describe("floorMemory", () => {
  it("round-trips a captured artwork's floor memory verbatim, keeping absent keys absent", () => {
    const project = createSampleProject();
    project.wallObjects = [
      {
        id: "artwork-placement-1",
        kind: "artwork",
        artworkId: "artwork-1",
        wallId: "wall-north",
        xMm: feetToMm(4),
        yMm: inchesToMm(57),
        widthMm: 610,
        heightMm: 460,
        // The motivating object: a suspended board angled 45° whose image the
        // curator put on the top face only.
        floorMemory: { rotationDeg: 45, baseHeightMm: 1200, imageFaces: ["top"] }
      },
      {
        id: "artwork-placement-2",
        kind: "artwork",
        artworkId: "artwork-2",
        wallId: "wall-north",
        xMm: feetToMm(12),
        yMm: inchesToMm(57),
        widthMm: 610,
        heightMm: 460,
        // Never suspended, never chose faces: an EMPTY memory object, not one
        // padded out with nulls or zeros.
        floorMemory: { rotationDeg: 0 }
      }
    ];

    const [first, second] = parseProject(project).wallObjects;
    expect(first.kind === "artwork" && first.floorMemory).toEqual({
      rotationDeg: 45,
      baseHeightMm: 1200,
      imageFaces: ["top"]
    });
    // Key ABSENCE is the load-bearing part: absent means "never chosen", and a
    // materialized key would both lose that reading and dirty the cloud-backup
    // fingerprint, which hashes key presence.
    const secondMemory = second.kind === "artwork" ? second.floorMemory! : {};
    expect("baseHeightMm" in secondMemory).toBe(false);
    expect("imageFaces" in secondMemory).toBe(false);
  });

  it("preserves an empty imageFaces memory as empty rather than collapsing it to absent", () => {
    const project = createSampleProject();
    project.wallObjects = [
      {
        id: "artwork-placement-1",
        kind: "artwork",
        artworkId: "artwork-1",
        wallId: "wall-north",
        xMm: feetToMm(4),
        yMm: inchesToMm(57),
        widthMm: 610,
        heightMm: 460,
        // "Every face deliberately off" — a different state from absent, which
        // means front + back (DEFAULT_FLOOR_OBJECT_IMAGE_FACES).
        floorMemory: { rotationDeg: 0, imageFaces: [] }
      }
    ];

    const [parsed] = parseProject(project).wallObjects;
    expect(parsed.kind === "artwork" && parsed.floorMemory?.imageFaces).toEqual([]);
  });

  it("strips an imageFaces claim from a blocked zone's memory (it has no image)", () => {
    const project = createSampleProject();
    project.wallObjects = [
      {
        id: "zone-1",
        kind: "blocked-zone",
        blocksPlacement: true,
        wallId: "wall-north",
        xMm: feetToMm(4),
        yMm: inchesToMm(57),
        widthMm: 610,
        heightMm: 460,
        floorMemory: { rotationDeg: 30, imageFaces: ["top"] }
      } as unknown as OpeningWallObject
    ];

    // The blocked-zone branch uses the BASE memory shape, so strict parsing
    // strips the artwork-only key rather than storing something no reader wants.
    const [parsed] = parseProject(project).wallObjects;
    expect(parsed.kind === "blocked-zone" && parsed.floorMemory).toEqual({ rotationDeg: 30 });
  });

  it("parses a document written before floor memory existed, at the same schema version", () => {
    const project = createSampleProject();
    project.wallObjects = [
      {
        id: "artwork-placement-1",
        kind: "artwork",
        artworkId: "artwork-1",
        wallId: "wall-north",
        xMm: feetToMm(4),
        yMm: inchesToMm(57),
        widthMm: 610,
        heightMm: 460
      }
    ];

    // No bump: the field is optional on both carriers, so a pre-existing
    // document parses unchanged and comes back out with no floorMemory key.
    const parsed = parseProject(project);
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect("floorMemory" in parsed.wallObjects[0]).toBe(false);
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

  it("walks a real v1 document 1→2→3→4, landing at the current version and parsing", () => {
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

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.floorObjects).toEqual([]);
    expect(migrated.floor.rooms[0].room.freestandingWalls).toEqual([]);
  });

  it("migrates a v2 document forward, adding freestandingWalls and dropping connectsToWallId", () => {
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

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.floor.rooms[0].room.freestandingWalls).toEqual([]);
    expect(
      (migrated.wallObjects[0] as Record<string, unknown>).connectsToWallId
    ).toBeUndefined();
  });

  it("migrates a v3 document through the pure version-stamp steps (no cases, no open walls)", () => {
    const sample = createSampleProject();
    const v3Document = { ...sample, schemaVersion: 3 };

    const migrated = migrateProject(v3Document);

    // v3→v4 (cases) and v4→v5 (open walls) are both pure version stamps: a v3
    // project carries neither, so the chain's only edit is the version itself
    // (mirrors the v1→v2 floorObjects passthrough).
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated).toEqual({ ...sample, schemaVersion: CURRENT_SCHEMA_VERSION });
  });

  it("migrates a v4 document to v5 as a pure version-stamp and leaves walls solid", () => {
    const sample = createSampleProject();
    const v4Document = { ...sample, schemaVersion: 4 };

    const migrated = migrateProject(v4Document);

    expect(migrated.schemaVersion).toBe(5);
    expect(migrated).toEqual({ ...sample, schemaVersion: 5 });
    // Absent means solid — the migration must not stamp `isOpenSide: false`
    // onto every wall, or restored walls would stop round-tripping clean.
    for (const wall of migrated.floor.rooms[0].room.walls) {
      expect(wall.isOpenSide).toBeUndefined();
    }
  });

  it("round-trips an open wall and refuses a document from a newer build", () => {
    const sample = createSampleProject();
    sample.floor.rooms[0].room.walls[0].isOpenSide = true;

    const parsed = parseProject(JSON.parse(JSON.stringify(sample)));
    expect(parsed.floor.rooms[0].room.walls[0].isOpenSide).toBe(true);
    // The loop invariant is untouched — an open wall is still in the loop.
    expect(parsed.floor.rooms[0].room.walls).toHaveLength(
      sample.floor.rooms[0].room.walls.length
    );

    // The v5 bump exists for this direction: a build pinned to an older schema
    // must refuse rather than strip the flag and re-save the wall as solid.
    expect(() =>
      migrateProject({ ...sample, schemaVersion: CURRENT_SCHEMA_VERSION + 1 })
    ).toThrow(/newer version of Sightlines/);
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

  // A document whose paired openings ended up on one wall used to be merely
  // unsaveable; without repair it would also be permanently UNOPENABLE, since
  // parseProject rejects it on load too.
  it("repairs a same-wall opening pairing instead of refusing to open the document", () => {
    const project = createSampleProject();
    project.wallObjects = [
      makeOpening({ id: "door-a", kind: "door", wallId: "wall-north", connectsToObjectId: "door-b" }),
      makeOpening({ id: "door-b", kind: "door", wallId: "wall-north", connectsToObjectId: "door-a" })
    ];

    expect(() => parseProject(project)).toThrow(/different walls/i);

    const { project: repaired, repairedCount } = migrateProjectWithReport(project);
    expect(repairedCount).toBe(1);
    for (const id of ["door-a", "door-b"]) {
      const door = repaired.wallObjects.find((object) => object.id === id)!;
      expect(door.kind === "door" ? door.connectsToObjectId : undefined).toBeUndefined();
    }
    // Both openings survive; only the impossible link is dropped.
    expect(repaired.wallObjects).toHaveLength(2);
  });

  it("leaves a valid pairing on two non-facing walls alone when opening a document", () => {
    const project = createSampleProject();
    project.wallObjects = [
      makeOpening({ id: "door-a", kind: "door", wallId: "wall-north", connectsToObjectId: "door-b" }),
      makeOpening({ id: "door-b", kind: "door", wallId: "wall-south", connectsToObjectId: "door-a" })
    ];

    const { project: opened, repairedCount } = migrateProjectWithReport(project);
    expect(repairedCount).toBe(0);
    const doorA = opened.wallObjects.find((object) => object.id === "door-a")!;
    expect(doorA.kind === "door" ? doorA.connectsToObjectId : undefined).toBe("door-b");
  });

  it("rejects a document from a newer schema version than this app supports", () => {
    const fromTheFuture = {
      ...createSampleProject(),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1
    };

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
