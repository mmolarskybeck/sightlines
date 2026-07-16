import { describe, expect, it } from "vitest";
import { faceWallId } from "../geometry/freestandingWalls";
import { createSampleProject } from "../sample/sampleProject";
import type { SavedView } from "../project";
import {
  countDocumentPages,
  defaultDocumentPaperSize,
  reconcileDocumentExportPreferences,
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
    expect(second.settings.sections.elevations).toBe(false);
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
});
