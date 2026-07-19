import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type {
  Artwork,
  Asset,
  SavedView
} from "../../domain/project";
import { createSampleProject } from "../../domain/sample/sampleProject";
import { createFloorCase, createWallCase } from "../../domain/placement/createCase";
import { createWallTextPlacement } from "../../domain/placement/createWallText";
import { DEFAULT_WALL_CASE_CENTER_Y_MM } from "../../domain/project";
import {
  caseElevationGlyph,
  casePlanGlyph
} from "../../domain/geometry/caseGlyphs";
import {
  reconcileDocumentExportPreferences,
  type EffectiveDocumentSettings
} from "../../domain/export/documentSettings";
import { createPolygonRoomPlacement } from "../../domain/geometry/createRoom";
import { buildPlanScene } from "../../domain/scene2d/planScene";
import {
  artworkPlaceholderLabel,
  createDocumentPdf,
  formatDocumentDimension,
  resolveWallDimensionOutwardMm,
  type RenderSavedView
} from "./createDocumentPdf";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const binary = atob(ONE_PIXEL_PNG_BASE64);
  return new Blob(
    [Uint8Array.from(binary, (character) => character.charCodeAt(0))],
    { type: "image/png" }
  );
}

function settingsFor(project = createSampleProject()): EffectiveDocumentSettings {
  return reconcileDocumentExportPreferences(project, undefined, "en-US")
    .settings;
}

describe("createDocumentPdf", () => {
  it("uses document-friendly eighth-inch precision for imperial dimensions", () => {
    expect(formatDocumentDimension(41.0625 * 25.4, "ft")).toBe(
      "3' 5 1/8\""
    );
    expect(formatDocumentDimension(3.0625 * 25.4, "in")).toBe("3 1/8\"");
    expect(formatDocumentDimension(1_234, "cm")).toBe("123.4 cm");
  });

  it("uses deterministic page-local labels for metadata-free placeholders", () => {
    expect(artworkPlaceholderLabel(undefined, 1)).toBe("Untitled work 1");
    expect(
      artworkPlaceholderLabel(
        {
          id: "art-1",
          schemaVersion: 1,
          accessionNumber: "2026.4",
          dimensions: { status: "unknown" },
          metadata: {}
        },
        3
      )
    ).toBe("2026.4");
  });

  it("assembles ordered vector drawing pages with metadata and auto-oriented sizes", async () => {
    const project = createSampleProject();
    project.title = "Summer Rotation";
    const settings = settingsFor(project);
    settings.sections = {
      overview: true,
      roomPlans: false,
      elevations: true,
      threeDViews: false
    };
    settings.rooms[0]!.walls = settings.rooms[0]!.walls.map((wall, index) => ({
      ...wall,
      included: index === 0
    }));

    const result = await createDocumentPdf({
      project,
      settings,
      artworks: [],
      exportedAt: new Date("2026-07-16T12:00:00.000Z"),
      locale: "en-US"
    });
    const loaded = await PDFDocument.load(result.bytes);

    expect(result.pageCount).toBe(2);
    expect(result.manifest.map((page) => page.kind)).toEqual([
      "overview",
      "elevation"
    ]);
    expect(loaded.getPageCount()).toBe(2);
    expect(loaded.getTitle()).toBe("Summer Rotation");
    expect(loaded.getCreator()).toBe("Sightlines");
    for (const page of loaded.getPages()) {
      expect(page.getWidth()).toBeGreaterThan(page.getHeight());
    }
    expect(result.warnings).toEqual([]);
  });

  it("uses a vector placeholder and warning when a display image is missing", async () => {
    const project = createSampleProject();
    const artwork: Artwork = {
      id: "art-1",
      schemaVersion: 1,
      title: "Blue Field",
      dimensions: { widthMm: 1_000, heightMm: 800, status: "known" },
      assetId: "asset-missing",
      metadata: {}
    };
    project.wallObjects.push({
      id: "placed-1",
      kind: "artwork",
      artworkId: artwork.id,
      wallId: "wall-north",
      xMm: 2_000,
      yMm: 1_450,
      widthMm: 1_000,
      heightMm: 800
    });
    const settings = settingsFor(project);
    settings.sections = {
      overview: false,
      roomPlans: false,
      elevations: true,
      threeDViews: false
    };
    settings.rooms[0]!.walls = settings.rooms[0]!.walls.map((wall) => ({
      ...wall,
      included: wall.wallId === "wall-north"
    }));

    const result = await createDocumentPdf({
      project,
      settings,
      artworks: [artwork],
      getAsset: vi.fn(async () => {
        throw new Error("missing");
      }),
      getBlob: vi.fn(async () => pngBlob())
    });

    expect(result.pageCount).toBe(1);
    expect(result.warnings).toEqual(["Image unavailable for Blue Field."]);
    await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined();
  });

  it("does not warn for deliberately image-less artwork", async () => {
    const project = createSampleProject();
    const artwork: Artwork = {
      id: "art-1",
      schemaVersion: 1,
      artist: "Unknown maker",
      dimensions: { widthMm: 1_000, heightMm: 800, status: "known" },
      metadata: {}
    };
    project.wallObjects.push({
      id: "placed-1",
      kind: "artwork",
      artworkId: artwork.id,
      wallId: "wall-north",
      xMm: 2_000,
      yMm: 1_450,
      widthMm: 1_000,
      heightMm: 800
    });
    const settings = settingsFor(project);
    settings.sections = {
      overview: false,
      roomPlans: false,
      elevations: true,
      threeDViews: false
    };
    settings.rooms[0]!.walls = settings.rooms[0]!.walls.map((wall) => ({
      ...wall,
      included: wall.wallId === "wall-north"
    }));

    const result = await createDocumentPdf({
      project,
      settings,
      artworks: [artwork]
    });

    expect(result.warnings).toEqual([]);
  });

  it("renders selected Saved views at document resolution through the injected renderer", async () => {
    const project = createSampleProject();
    const view: SavedView = {
      id: "view-1",
      ordinal: 1,
      title: "Entrance",
      roomId: "room-main",
      pose: {
        position: { x: 4, y: 3, z: 4 },
        target: { x: 0, y: 1, z: 0 }
      },
      createdAt: "2026-07-16T00:00:00.000Z"
    };
    project.savedViews = [view];
    const settings = settingsFor(project);
    settings.sections = {
      overview: false,
      roomPlans: false,
      elevations: false,
      threeDViews: true
    };
    const renderSavedView = vi.fn<RenderSavedView>(async () => pngBlob());

    const result = await createDocumentPdf({
      project,
      settings,
      artworks: [],
      renderSavedView
    });

    expect(result.pageCount).toBe(1);
    expect(renderSavedView).toHaveBeenCalledWith(
      view,
      expect.objectContaining({
        widthPx: expect.any(Number),
        heightPx: expect.any(Number)
      })
    );
    const size = renderSavedView.mock.calls[0]![1];
    expect(size.widthPx).toBeGreaterThan(1_000);
    expect(size.heightPx).toBeGreaterThan(700);
  });

  it("keeps the document and warns when a Saved view fails to render", async () => {
    const project = createSampleProject();
    const view: SavedView = {
      id: "view-1",
      ordinal: 1,
      title: "Entrance",
      roomId: "room-main",
      pose: {
        position: { x: 4, y: 3, z: 4 },
        target: { x: 0, y: 1, z: 0 }
      },
      createdAt: "2026-07-16T00:00:00.000Z"
    };
    project.savedViews = [view];
    const settings = settingsFor(project);
    settings.sections = {
      overview: true,
      roomPlans: false,
      elevations: false,
      threeDViews: true
    };
    const renderSavedView = vi.fn<RenderSavedView>(async () => {
      throw new Error("The 3D renderer is not ready to render Saved views.");
    });

    const result = await createDocumentPdf({
      project,
      settings,
      artworks: [],
      renderSavedView
    });

    expect(result.pageCount).toBe(2);
    expect(result.warnings).toContain(
      'Saved view "Entrance" could not be rendered.'
    );
  });

  it("embeds a valid display PNG when repositories resolve it", async () => {
    const project = createSampleProject();
    const artwork: Artwork = {
      id: "art-1",
      schemaVersion: 1,
      title: "Red Square",
      dimensions: { widthMm: 1_000, heightMm: 1_000, status: "known" },
      assetId: "asset-1",
      metadata: {}
    };
    const asset: Asset = {
      id: "asset-1",
      schemaVersion: 1,
      mimeType: "image/png",
      originalKey: "asset-1:original",
      displayKey: "asset-1:display",
      thumbnailKey: "asset-1:thumbnail"
    };
    project.wallObjects.push({
      id: "placed-1",
      kind: "artwork",
      artworkId: artwork.id,
      wallId: "wall-north",
      xMm: 2_000,
      yMm: 1_450,
      widthMm: 1_000,
      heightMm: 1_000
    });
    const settings = settingsFor(project);
    settings.sections = {
      overview: false,
      roomPlans: false,
      elevations: true,
      threeDViews: false
    };
    settings.rooms[0]!.walls = settings.rooms[0]!.walls.map((wall) => ({
      ...wall,
      included: wall.wallId === "wall-north"
    }));

    const result = await createDocumentPdf({
      project,
      settings,
      artworks: [artwork],
      getAsset: async () => asset,
      getBlob: async () => pngBlob()
    });

    expect(result.warnings).toEqual([]);
    await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined();
  });

  it("substitutes unsupported standard-font glyphs without failing silently", async () => {
    const project = createSampleProject();
    project.title = "夏の展示";
    const settings = settingsFor(project);
    settings.sections = {
      overview: true,
      roomPlans: false,
      elevations: false,
      threeDViews: false
    };

    const result = await createDocumentPdf({
      project,
      settings,
      artworks: []
    });

    expect(result.warnings).toContain(
      "Some text used fallback characters because the PDF font did not include every glyph."
    );
    await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined();
  });

  describe("resolveWallDimensionOutwardMm", () => {
    // A concave L: the six-vertex loop bites a rectangular notch out of the
    // bottom-right corner, so the notch's two inner walls meet at a reflex
    // angle. A bbox/vertex-average centroid sits inside the rectangle the
    // notch was cut from — on the wrong side of both inner walls — which is
    // exactly the bug class this room shape catches (mirrors the fixture in
    // domain/geometry/walls.test.ts's outwardWallNormal coverage).
    function lShapeProject() {
      const project = createSampleProject();
      const placement = createPolygonRoomPlacement({
        roomId: "room-l",
        name: "L Room",
        heightMm: 3000,
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 6000, yMm: 0 },
          { xMm: 6000, yMm: 3000 },
          { xMm: 3000, yMm: 3000 },
          { xMm: 3000, yMm: 6000 },
          { xMm: 0, yMm: 6000 }
        ]
      });
      project.floor.rooms = [placement];
      return project;
    }

    it("puts the notch's inner walls on the true outward side, not the centroid side", () => {
      const project = lShapeProject();
      const scene = buildPlanScene(project);
      const room = scene.rooms[0]!;

      // Vertex-average centroid of the L is (3000, 3000) — sitting exactly on
      // the notch's inner corner and inside the rectangle the notch was cut
      // from. The old heuristic compared each wall's midpoint to that
      // centroid, which mis-signs both inner walls (indices 2 and 3, matching
      // pointsFloorMm above: wall i runs vertex i -> vertex i+1).
      const innerHorizontal = room.walls[2]!; // (6000,3000) -> (3000,3000)
      const innerVertical = room.walls[3]!; // (3000,3000) -> (3000,6000)

      const outwardHorizontal = resolveWallDimensionOutwardMm(room, innerHorizontal);
      const outwardVertical = resolveWallDimensionOutwardMm(room, innerVertical);

      expect(outwardHorizontal).not.toBeNull();
      expect(outwardVertical).not.toBeNull();
      // Outward from the inner horizontal wall is +y (away from the room,
      // toward the notch) — the centroid heuristic would instead pick -y,
      // pointing back into the room's interior.
      expect(outwardHorizontal!.xMm).toBeCloseTo(0);
      expect(outwardHorizontal!.yMm).toBeCloseTo(1);
      // Outward from the inner vertical wall is +x, for the same reason.
      expect(outwardVertical!.xMm).toBeCloseTo(1);
      expect(outwardVertical!.yMm).toBeCloseTo(0);
    });

    it("still renders an L-shaped room plan page without warnings", async () => {
      const project = lShapeProject();
      const settings = settingsFor(project);
      settings.sections = {
        overview: false,
        roomPlans: true,
        elevations: false,
        threeDViews: false
      };

      const result = await createDocumentPdf({
        project,
        settings,
        artworks: []
      });

      expect(result.warnings).toEqual([]);
      await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined();
    });
  });

  describe("display-case glyph parity", () => {
    it("exports a wall case, floor case, and wall text without warnings", async () => {
      const project = createSampleProject();
      project.wallObjects = [
        createWallCase("wall-north", 2000),
        createWallTextPlacement("wall-north", 5000, DEFAULT_WALL_CASE_CENTER_Y_MM)
      ];
      project.floorObjects = [createFloorCase(4000, 3000)];
      const settings = settingsFor(project);
      settings.sections = {
        overview: false,
        roomPlans: true,
        elevations: true,
        threeDViews: false
      };

      const result = await createDocumentPdf({
        project,
        settings,
        artworks: []
      });

      expect(result.warnings).toEqual([]);
      await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined();
    });

    it("derives its plan/elevation case marks from the shared glyph module", () => {
      // The export imports the exact glyph functions the screen uses, so parity
      // is by construction — pin the structure the PDF consumes so a drift back
      // to a generic inset (the old bug) would fail here.
      const plan = casePlanGlyph({ widthMm: 1800, depthMm: 600, includeLegs: true });
      expect(plan.glass).not.toBeNull();
      expect(plan.legs.length).toBe(4);
      const elevation = caseElevationGlyph({ widthMm: 1500, heightMm: 180 });
      expect(elevation.showMarks).toBe(true);
    });
  });
});
