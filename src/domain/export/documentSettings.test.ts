import { describe, expect, it } from "vitest";
import { faceWallId } from "../geometry/freestandingWalls";
import { getRoomPlaceableWalls } from "../geometry/placeableWalls";
import { createSampleProject } from "../sample/sampleProject";
import type { SavedView } from "../project";
import {
  countDocumentPages,
  defaultDocumentPaperSize,
  reconcileDocumentExportPreferences,
  resolveDocumentExportUnit,
  sanitizeDocumentExportPreferences,
  selectionState
} from "./documentSettings";

const VALID_VIEW: SavedView = {
  id: "view-1",
  ordinal: 1,
  title: "Entrance",
  roomId: "room-main",
  pose: {
    position: { x: 1, y: 1.5, z: 2 },
    target: { x: 1, y: 1.5, z: 0 }
  },
  createdAt: "2026-07-16T00:00:00.000Z"
};

describe("open walls in the export tree", () => {
  function withOpenNorthWall() {
    const project = createSampleProject();
    project.floor.rooms[0].room.walls = project.floor.rooms[0].room.walls.map((wall) =>
      wall.id === "wall-north" ? { ...wall, isOpenSide: true } : wall
    );
    return project;
  }

  it("is listed but never included — there is no surface to elevate", () => {
    const { settings } = reconcileDocumentExportPreferences(
      withOpenNorthWall(),
      undefined,
      "en-US"
    );

    const wall = settings.rooms[0].walls.find((choice) => choice.wallId === "wall-north");
    expect(wall).toBeDefined();
    expect(wall!.isOpenSide).toBe(true);
    expect(wall!.included).toBe(false);
    expect(wall!.hasWork).toBe(false);
  });

  // The stale-preference trap: `included` defaults to hasWork, but an explicit
  // stored `true` from before the wall was opened would otherwise win and
  // resurrect a blank elevation page.
  it("overrides a stored explicit true rather than honouring it", () => {
    const { settings } = reconcileDocumentExportPreferences(
      withOpenNorthWall(),
      { sections: {}, roomPlans: {}, savedViews: {}, elevations: { "wall-north": true } },
      "en-US"
    );

    expect(
      settings.rooms[0].walls.find((choice) => choice.wallId === "wall-north")!.included
    ).toBe(false);
  });

  it("gives the stored choice straight back once the wall is restored", () => {
    // Preferences are never rewritten for an open wall, so restore is lossless.
    const { settings } = reconcileDocumentExportPreferences(
      createSampleProject(),
      { sections: {}, roomPlans: {}, savedViews: {}, elevations: { "wall-north": true } },
      "en-US"
    );

    expect(
      settings.rooms[0].walls.find((choice) => choice.wallId === "wall-north")!.included
    ).toBe(true);
  });
});

describe("document export settings", () => {
  it("uses §7.3 defaults for a single-room project", () => {
    const project = createSampleProject();
    project.wallObjects = [
      {
        id: "work-1",
        kind: "artwork",
        artworkId: "art-1",
        wallId: "wall-north",
        xMm: 1000,
        yMm: 1500,
        widthMm: 500,
        heightMm: 700
      }
    ];

    const { settings } = reconcileDocumentExportPreferences(
      project,
      undefined,
      "en-US"
    );

    expect(settings.sections).toEqual({
      overview: true,
      roomPlans: false,
      elevations: true,
      threeDViews: false
    });
    expect(settings.rooms[0].planIncluded).toBe(false);
    expect(
      settings.rooms[0].walls.find((wall) => wall.wallId === "wall-north")
        ?.included
    ).toBe(true);
    expect(
      settings.rooms[0].walls.find((wall) => wall.wallId === "wall-east")
        ?.included
    ).toBe(false);
    expect(settings.dimensions).toBe(true);
    expect(settings.grid).toBe(false);
    expect(settings.paperSize).toBe("letter");
  });

  it("lists partition faces and defaults only faces holding work to included", () => {
    const project = createSampleProject();
    project.floor.rooms[0].room.freestandingWalls.push({
      id: "partition-1",
      roomId: "room-main",
      name: "Partition 1",
      startXMm: 1000,
      startYMm: 1000,
      endXMm: 3000,
      endYMm: 1000,
      heightMm: 3000,
      thicknessMm: 100
    });
    const faceA = faceWallId("partition-1", "a");
    const faceB = faceWallId("partition-1", "b");
    project.wallObjects.push({
      id: "work-face",
      kind: "artwork",
      artworkId: "art-1",
      wallId: faceB,
      xMm: 1000,
      yMm: 1500,
      widthMm: 500,
      heightMm: 700
    });

    const { settings } = reconcileDocumentExportPreferences(project, undefined);
    const choices = settings.rooms[0].walls;

    expect(choices.find((wall) => wall.wallId === faceA)?.included).toBe(false);
    expect(choices.find((wall) => wall.wallId === faceB)?.included).toBe(true);
  });

  it("preserves explicit choices, drops deleted ids, and defaults genuinely new ids", () => {
    const project = createSampleProject();
    project.savedViews = [VALID_VIEW];
    const first = reconcileDocumentExportPreferences(project, {
      sections: { elevations: false },
      roomPlans: { "room-main": true, "deleted-room": false },
      elevations: { "wall-north": false, "deleted-wall": true },
      savedViews: { "view-1": false, "deleted-view": true },
      dimensions: false,
      grid: true,
      paperSize: "a3"
    });

    project.floor.rooms[0].room.freestandingWalls.push({
      id: "partition-new",
      roomId: "room-main",
      name: "New partition",
      startXMm: 1000,
      startYMm: 1000,
      endXMm: 3000,
      endYMm: 1000,
      heightMm: 3000,
      thicknessMm: 100
    });
    const newFace = faceWallId("partition-new", "a");
    project.wallObjects.push({
      id: "work-new",
      kind: "artwork",
      artworkId: "art-new",
      wallId: newFace,
      xMm: 1000,
      yMm: 1500,
      widthMm: 500,
      heightMm: 700
    });

    const second = reconcileDocumentExportPreferences(
      project,
      first.preferences
    );

    expect(second.preferences.roomPlans).toEqual({ "room-main": true });
    expect(second.preferences.elevations).toEqual({ "wall-north": false });
    expect(second.preferences.savedViews).toEqual({ "view-1": false });
    // "Elevations" is derived from its children, not from the stored
    // (now-legacy) sections.elevations flag. The reconciled project gained
    // a new partition face that defaults to included (it holds work), so
    // the section reads on even though it was stored disabled.
    expect(second.settings.sections.elevations).toBe(true);
    expect(
      second.settings.rooms[0].walls.find(
        (wall) => wall.wallId === "wall-north"
      )?.included
    ).toBe(false);
    expect(
      second.settings.rooms[0].walls.find((wall) => wall.wallId === newFace)
        ?.included
    ).toBe(true);
    expect(second.settings.savedViews[0].included).toBe(false);
    expect(second.settings.dimensions).toBe(false);
    expect(second.settings.grid).toBe(true);
    expect(second.settings.paperSize).toBe("a3");
  });

  it("excludes a degenerate Saved view even when a stored override includes it", () => {
    const project = createSampleProject();
    project.savedViews = [
      {
        ...VALID_VIEW,
        pose: {
          position: { x: 1, y: 1, z: 1 },
          target: { x: 1, y: 1, z: 1 }
        }
      }
    ];

    const { settings } = reconcileDocumentExportPreferences(project, {
      sections: {},
      roomPlans: {},
      elevations: {},
      savedViews: { "view-1": true }
    });

    expect(settings.savedViews[0]).toMatchObject({
      included: false,
      valid: false
    });
  });

  it("counts only enabled sections and selected valid children", () => {
    const project = createSampleProject();
    project.savedViews = [VALID_VIEW];
    const { settings } = reconcileDocumentExportPreferences(project, {
      sections: {
        overview: true,
        roomPlans: true,
        elevations: true,
        threeDViews: true
      },
      roomPlans: { "room-main": true },
      elevations: { "wall-north": true },
      savedViews: { "view-1": true }
    });

    expect(countDocumentPages(settings)).toBe(4);
    settings.sections.elevations = false;
    expect(countDocumentPages(settings)).toBe(3);
  });

  it("sanitizes malformed storage and reports standard tri-state values", () => {
    expect(
      sanitizeDocumentExportPreferences({
        sections: { overview: true, nope: true, elevations: "yes" },
        roomPlans: { a: true, b: "yes" },
        elevations: [],
        savedViews: null,
        dimensions: "yes",
        grid: false,
        paperSize: "legal"
      })
    ).toEqual({
      sections: { overview: true },
      roomPlans: { a: true },
      elevations: {},
      savedViews: {},
      grid: false
    });

    expect(selectionState([])).toBe(false);
    expect(selectionState([false, false])).toBe(false);
    expect(selectionState([true, true])).toBe(true);
    expect(selectionState([true, false])).toBe("indeterminate");
  });

  it("uses Letter for US/Canada and A4 elsewhere", () => {
    expect(defaultDocumentPaperSize("en-US")).toBe("letter");
    expect(defaultDocumentPaperSize("en-CA")).toBe("letter");
    expect(defaultDocumentPaperSize("en-GB")).toBe("a4");
    expect(defaultDocumentPaperSize("fr-FR")).toBe("a4");
  });

  describe("export dimension units", () => {
    it("resolves Auto to project unit for plans and the elevation-view convention for elevations", () => {
      // Imperial project: plan follows the project unit; elevation follows the
      // in-app elevation view (imperial → inches).
      expect(resolveDocumentExportUnit("auto", "ft", "plan")).toBe("ft");
      expect(resolveDocumentExportUnit("auto", "ft", "elevation")).toBe("in");
      expect(resolveDocumentExportUnit("auto", "in", "elevation")).toBe("in");
      // Metric project: plan follows the project unit; elevation → cm.
      expect(resolveDocumentExportUnit("auto", "cm", "plan")).toBe("cm");
      expect(resolveDocumentExportUnit("auto", "cm", "elevation")).toBe("cm");
      expect(resolveDocumentExportUnit("auto", "m", "elevation")).toBe("cm");
      // An explicit choice is honored on either surface, including mm.
      expect(resolveDocumentExportUnit("mm", "ft", "plan")).toBe("mm");
      expect(resolveDocumentExportUnit("m", "ft", "elevation")).toBe("m");
    });

    it("defaults missing unit prefs to Auto and exposes the resolved units", () => {
      const project = createSampleProject(); // unit: "ft"
      const { preferences, settings } = reconcileDocumentExportPreferences(
        project,
        undefined
      );

      expect(settings.planUnit).toBe("auto");
      expect(settings.elevationUnit).toBe("auto");
      expect(settings.resolvedPlanUnit).toBe("ft");
      expect(settings.resolvedElevationUnit).toBe("in");
      // Auto is not materialized into stored prefs (missing = auto).
      expect(preferences.planUnit).toBeUndefined();
      expect(preferences.elevationUnit).toBeUndefined();
    });

    it("round-trips an explicit mm override through sanitize and reconcile", () => {
      const project = createSampleProject();
      const sanitized = sanitizeDocumentExportPreferences({
        sections: {},
        roomPlans: {},
        elevations: {},
        savedViews: {},
        planUnit: "mm",
        elevationUnit: "cm"
      });
      expect(sanitized.planUnit).toBe("mm");
      expect(sanitized.elevationUnit).toBe("cm");

      const { preferences, settings } = reconcileDocumentExportPreferences(
        project,
        sanitized
      );
      expect(preferences.planUnit).toBe("mm");
      expect(preferences.elevationUnit).toBe("cm");
      expect(settings.resolvedPlanUnit).toBe("mm");
      expect(settings.resolvedElevationUnit).toBe("cm");
    });

    it("drops malformed unit prefs and treats legacy prefs (no unit keys) as Auto", () => {
      // Malformed values are stripped by sanitize.
      const sanitized = sanitizeDocumentExportPreferences({
        sections: {},
        roomPlans: {},
        elevations: {},
        savedViews: {},
        planUnit: "furlong",
        elevationUnit: 5
      });
      expect(sanitized.planUnit).toBeUndefined();
      expect(sanitized.elevationUnit).toBeUndefined();

      // A legacy stored blob predating unit prefs reconciles to Auto.
      const project = createSampleProject();
      const { settings } = reconcileDocumentExportPreferences(project, {
        sections: {},
        roomPlans: {},
        elevations: {},
        savedViews: {}
      });
      expect(settings.planUnit).toBe("auto");
      expect(settings.elevationUnit).toBe("auto");
      expect(settings.resolvedPlanUnit).toBe("ft");
      expect(settings.resolvedElevationUnit).toBe("in");
    });
  });

  describe("derived section state (parent/child checkbox model)", () => {
    it("clearing every child (as the UI does when a section checkbox is unchecked) reads the section as off", () => {
      const project = createSampleProject();
      const allWallIds = getRoomPlaceableWalls(
        project.floor.rooms[0].room
      ).map((wall) => wall.id);

      const { settings } = reconcileDocumentExportPreferences(project, {
        sections: { elevations: true },
        roomPlans: {},
        elevations: Object.fromEntries(allWallIds.map((id) => [id, false])),
        savedViews: {}
      });

      expect(settings.sections.elevations).toBe(false);
      expect(
        settings.rooms.flatMap((room) => room.walls).every((wall) => !wall.included)
      ).toBe(true);
      expect(countDocumentPages(settings)).toBe(1); // overview only
    });

    it("checking a single child while the section was stored off exports exactly that child", () => {
      const project = createSampleProject();

      const { settings } = reconcileDocumentExportPreferences(project, {
        sections: { overview: false, elevations: false },
        roomPlans: {},
        elevations: { "wall-north": true },
        savedViews: {}
      });

      // The section reads on because at least one child is included, even
      // though the legacy `sections.elevations` flag was stored as false.
      expect(settings.sections.elevations).toBe(true);
      const included = settings.rooms
        .flatMap((room) => room.walls)
        .filter((wall) => wall.included)
        .map((wall) => wall.wallId);
      expect(included).toEqual(["wall-north"]);
      expect(countDocumentPages(settings)).toBe(1); // just that one elevation
    });

    it("reconciles persisted prefs with a legacy enabled=false flag plus real selections without crashing", () => {
      const project = createSampleProject();
      project.savedViews = [VALID_VIEW];

      const legacyStored = {
        sections: {
          overview: false,
          roomPlans: false,
          elevations: false,
          threeDViews: false
        },
        roomPlans: { "room-main": true },
        elevations: { "wall-north": true },
        savedViews: { "view-1": true }
      };

      expect(() =>
        reconcileDocumentExportPreferences(project, legacyStored)
      ).not.toThrow();

      const { settings } = reconcileDocumentExportPreferences(
        project,
        legacyStored
      );

      // Overview keeps its own explicit flag (no children), so the legacy
      // false is honored there. The composite sections derive from their
      // now-selected children and read on despite the legacy false flag.
      expect(settings.sections.overview).toBe(false);
      expect(settings.sections.roomPlans).toBe(true);
      expect(settings.sections.elevations).toBe(true);
      expect(settings.sections.threeDViews).toBe(true);
    });
  });
});
