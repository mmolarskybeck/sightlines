import { describe, expect, it } from "vitest";
import type { Artwork, SavedView } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { reconcileDocumentExportPreferences } from "./documentSettings";
import {
  chooseDocumentOrientation,
  chooseScaleBarLengthMm,
  deriveDocumentPageManifest,
  fitBoundsToRect,
  getPageDrawingRectPt,
  getPageSizePt,
  getPlanSceneBounds,
  getPlanStructureBounds,
  planRectCorners
} from "./pageComposition";
import { buildPlanScene } from "../scene2d/planScene";

describe("page composition", () => {
  it("chooses the orientation that gives a wide drawing more usable scale", () => {
    expect(chooseDocumentOrientation("letter", 4)).toBe("landscape");
    expect(chooseDocumentOrientation("letter", 0.25)).toBe("portrait");
  });

  it("fits uniformly and centers without stretching", () => {
    const rect = getPageDrawingRectPt("letter", "portrait");
    const fit = fitBoundsToRect(
      {
        minXMm: 0,
        minYMm: 0,
        maxXMm: 2_000,
        maxYMm: 1_000,
        widthMm: 2_000,
        heightMm: 1_000
      },
      rect
    );

    expect(fit.widthPt / fit.heightPt).toBeCloseTo(2);
    expect(fit.xPt).toBeGreaterThanOrEqual(rect.xPt);
    expect(fit.yPt).toBeGreaterThanOrEqual(rect.yPt);
  });

  it("includes rotated object corners in overview bounds", () => {
    const project = createSampleProject();
    project.floorObjects.push({
      id: "floor-1",
      kind: "blocked-zone",
      xMm: -1_000,
      yMm: -1_000,
      widthMm: 2_000,
      depthMm: 500,
      rotationDeg: 45,
      heightMm: 1_000,
      wallYMm: 1_450
    });
    const scene = buildPlanScene(project);
    const bounds = getPlanSceneBounds(scene);
    const corners = planRectCorners(scene.floorObjects[0]!.rect);

    expect(bounds.minXMm).toBeLessThanOrEqual(
      Math.min(...corners.map((point) => point.xMm))
    );
    expect(bounds.minYMm).toBeLessThanOrEqual(
      Math.min(...corners.map((point) => point.yMm))
    );
  });

  it("structure bounds ignore wall-object rects that protrude past room polygons", () => {
    const project = createSampleProject();
    project.wallObjects.push({
      id: "placed-1",
      kind: "door",
      blocksPlacement: true,
      wallId: "wall-north",
      xMm: 2_000,
      yMm: 1_450,
      widthMm: 1_000,
      heightMm: 800
    });
    const scene = buildPlanScene(project);
    const sceneBounds = getPlanSceneBounds(scene);
    const structureBounds = getPlanStructureBounds(scene);
    const roomPoints = scene.rooms.flatMap((room) => room.polygonMm);

    // Wall-mounted objects that straddle the wall centerline (e.g. doors)
    // push the object-inflated scene bounds past the room polygon on that wall.
    expect(sceneBounds.minYMm).toBeLessThan(structureBounds.minYMm);
    // Structure bounds track the room polygons exactly.
    expect(structureBounds.minXMm).toBeCloseTo(
      Math.min(...roomPoints.map((point) => point.xMm))
    );
    expect(structureBounds.minYMm).toBeCloseTo(
      Math.min(...roomPoints.map((point) => point.yMm))
    );
  });

  it("derives pages in document order and excludes invalid Saved views", () => {
    const project = createSampleProject();
    project.title = "Summer Rotation";
    project.floor.rooms.push({
      ...structuredClone(project.floor.rooms[0]!),
      roomId: "room-second",
      offsetXMm: 10_000,
      room: {
        ...structuredClone(project.floor.rooms[0]!.room),
        id: "room-second",
        name: "Gallery 2",
        walls: structuredClone(project.floor.rooms[0]!.room.walls).map(
          (wall, index) => ({
            ...wall,
            id: `second-wall-${index}`,
            roomId: "room-second"
          })
        )
      }
    });
    const views: SavedView[] = [
      {
        id: "view-1",
        ordinal: 1,
        title: "Entrance",
        roomId: "room-second",
        pose: {
          position: { x: 1, y: 1, z: 1 },
          target: { x: 0, y: 0, z: 0 }
        },
        createdAt: "2026-07-16T00:00:00.000Z"
      },
      {
        id: "view-invalid",
        ordinal: 2,
        title: "Invalid",
        pose: {
          position: { x: 1, y: 1, z: 1 },
          target: { x: 1, y: 1, z: 1 }
        },
        createdAt: "2026-07-16T00:00:00.000Z"
      }
    ];
    project.savedViews = views;
    project.wallObjects.push({
      id: "placed-1",
      kind: "artwork",
      artworkId: "art-1",
      wallId: "wall-north",
      xMm: 2_000,
      yMm: 1_450,
      widthMm: 1_000,
      heightMm: 800
    });
    const artwork: Artwork = {
      id: "art-1",
      schemaVersion: 1,
      dimensions: { widthMm: 1_000, heightMm: 800, status: "known" },
      metadata: {}
    };
    const { settings } = reconcileDocumentExportPreferences(project, undefined, "en-US");
    const pages = deriveDocumentPageManifest(
      project,
      settings,
      new Map([[artwork.id, artwork]])
    );

    expect(pages.map((page) => page.kind)).toEqual([
      "overview",
      "room-plan",
      "room-plan",
      "elevation",
      "three-d"
    ]);
    expect(pages.at(-1)?.title).toBe("Gallery 2 · Entrance");
  });

  it("selects round, unit-native scale-bar lengths", () => {
    expect(chooseScaleBarLengthMm(0.1, "m")).toBe(500);
    expect(chooseScaleBarLengthMm(0.1, "ft")).toBeCloseTo(609.6);
  });

  it("supports all specified paper sizes in both orientations", () => {
    for (const paperSize of ["a4", "letter", "a3", "tabloid"] as const) {
      const portrait = getPageSizePt(paperSize, "portrait");
      const landscape = getPageSizePt(paperSize, "landscape");
      expect(portrait.heightPt).toBeGreaterThan(portrait.widthPt);
      expect(landscape.widthPt).toBe(portrait.heightPt);
      expect(landscape.heightPt).toBe(portrait.widthPt);
    }
  });
});
