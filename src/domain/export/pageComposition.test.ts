import { describe, expect, it } from "vitest";
import type { Artwork, DoorLeaf, Project, SavedView } from "../project";
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
  getRoomPlanBounds,
  planRectCorners
} from "./pageComposition";
import { buildPlanScene, type PlanScene } from "../scene2d/planScene";

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

  // A hinged door's swing is the one glyph that paints outside its own rect, so
  // PAINT bounds (page fit + room crop) have to grow for it while interaction
  // bounds and the grid extent deliberately do not.
  describe("hinged door swings", () => {
    const DOOR_WIDTH_MM = 915; // a 3'0" leaf, so the arc radius is 915 mm too
    // The sample room is wound counter-clockwise with the north wall running
    // +x along y = 0 and the interior at y > 0. The glyph's local +y is the
    // LEFT of the wall's authored start→end, so on this wall swingsToLeft
    // sweeps INTO the room and !swingsToLeft sweeps OUT through the exterior.
    const SWINGS_IN: DoorLeaf = { hingeAtStart: true, swingsToLeft: true };
    const SWINGS_OUT: DoorLeaf = { hingeAtStart: true, swingsToLeft: false };

    function projectWithDoor(
      leaf?: DoorLeaf,
      placement: { id?: string; wallId?: string; xMm?: number } = {},
      base: Project = createSampleProject()
    ): Project {
      base.wallObjects.push({
        id: placement.id ?? "door-1",
        kind: "door",
        blocksPlacement: true,
        wallId: placement.wallId ?? "wall-north",
        xMm: placement.xMm ?? 2_000,
        yMm: 1_016,
        widthMm: DOOR_WIDTH_MM,
        heightMm: 2_032,
        ...(leaf ? { leaf } : {})
      });
      return base;
    }

    const sceneWithDoor = (
      leaf?: DoorLeaf,
      placement?: { id?: string; wallId?: string; xMm?: number }
    ) => buildPlanScene(projectWithDoor(leaf, placement));

    const roomBounds = (scene: PlanScene) =>
      getRoomPlanBounds(scene.rooms[0]!, scene.wallObjects);

    it("grows overview bounds for a door swinging out through an exterior wall", () => {
      const doorway = getPlanSceneBounds(sceneWithDoor());
      const hinged = getPlanSceneBounds(sceneWithDoor(SWINGS_OUT));

      // The swing reaches a full door width past the wall it is cut into.
      expect(hinged.minYMm).toBeLessThan(doorway.minYMm - DOOR_WIDTH_MM * 0.98);
      // …but only across its own span along the wall: the arc is centered on a
      // jamb with radius = the clear width, so it never overhangs either jamb.
      expect(hinged.minXMm).toBeCloseTo(doorway.minXMm);
      expect(hinged.maxXMm).toBeCloseTo(doorway.maxXMm);
    });

    it("leaves bounds untouched for a plain doorway and for a swing inside the room", () => {
      const plain = getPlanSceneBounds(sceneWithDoor());
      const inward = getPlanSceneBounds(sceneWithDoor(SWINGS_IN));
      // An inward swing lands in open floor the room polygon already covers,
      // so unioning it must be a no-op — not merely "close enough".
      expect(inward).toEqual(plain);
      expect(roomBounds(sceneWithDoor(SWINGS_IN))).toEqual(
        roomBounds(sceneWithDoor())
      );
      // And a doorway (no leaf) carries no swing glyph at all to union.
      expect(sceneWithDoor().wallObjects[0]!.doorSwing).toBeUndefined();
    });

    it("grows the room page crop, past the fixed margin, for an outward swing", () => {
      const plain = roomBounds(sceneWithDoor());
      const hinged = roomBounds(sceneWithDoor(SWINGS_OUT));

      // 915 mm of swing against a 300 mm crop margin: without the union the
      // arc would print in the margin or off the sheet entirely.
      expect(hinged.minYMm).toBeLessThan(plain.minYMm - DOOR_WIDTH_MM * 0.98);
      // The margin still applies to the grown union, not just to the polygon.
      expect(plain.minYMm - hinged.minYMm).toBeGreaterThan(DOOR_WIDTH_MM * 0.98);
    });

    it("grows both axes for outward swings meeting at a room corner", () => {
      // Two doors near the north-west corner: one on the north wall (swings out
      // to −y) and one on the west wall, whose authored direction runs −y so
      // its exterior is −x. A corner is where a single-axis union would look
      // sufficient and isn't.
      const project = projectWithDoor(
        SWINGS_OUT,
        { id: "door-west", wallId: "wall-west", xMm: 4_800 },
        projectWithDoor(SWINGS_OUT, { xMm: 1_200 })
      );
      const scene = buildPlanScene(project);
      const bounds = roomBounds(scene);
      const plain = roomBounds(buildPlanScene(createSampleProject()));

      expect(bounds.minYMm).toBeLessThan(plain.minYMm - DOOR_WIDTH_MM * 0.98);
      expect(bounds.minXMm).toBeLessThan(plain.minXMm - DOOR_WIDTH_MM * 0.98);
    });

    it("keeps the swing out of the structure bounds the grid draws over", () => {
      const scene = sceneWithDoor(SWINGS_OUT);
      const structure = getPlanStructureBounds(scene);
      const roomPoints = scene.rooms.flatMap((room) => room.polygonMm);

      // Growing the grid extent is never the fix for a clipped arc: it would
      // trail a metre of cut-off grid past the exterior wall line.
      expect(structure.minYMm).toBeCloseTo(
        Math.min(...roomPoints.map((point) => point.yMm))
      );
      expect(structure.minXMm).toBeCloseTo(
        Math.min(...roomPoints.map((point) => point.xMm))
      );
    });

    it("fits every point the exports actually draw inside the room page", () => {
      // The fit-vs-paint contract end to end: each flattened arc point the PDF
      // writer strokes (and the preview polylines) mapped into floor space the
      // way planRectWorldPoint does, then checked against the page the
      // manifest hands those surfaces.
      const scene = sceneWithDoor(SWINGS_OUT);
      const entry = scene.wallObjects[0]!;
      const swing = entry.doorSwing!;
      const rect = entry.renderedRect;
      const angleRad = (rect.angleDeg * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const drawn = [
        { xMm: swing.leaf.x1Mm, yMm: swing.leaf.y1Mm },
        { xMm: swing.leaf.x2Mm, yMm: swing.leaf.y2Mm },
        ...swing.arcPolyline()
      ].map((point) => ({
        xMm: rect.centerXMm + point.xMm * cos - point.yMm * sin,
        yMm: rect.centerYMm + point.xMm * sin + point.yMm * cos
      }));

      for (const bounds of [roomBounds(scene), getPlanSceneBounds(scene)]) {
        for (const point of drawn) {
          expect(point.xMm).toBeGreaterThanOrEqual(bounds.minXMm);
          expect(point.xMm).toBeLessThanOrEqual(bounds.maxXMm);
          expect(point.yMm).toBeGreaterThanOrEqual(bounds.minYMm);
          expect(point.yMm).toBeLessThanOrEqual(bounds.maxYMm);
        }
      }
    });

    it("carries the grown room bounds through the page manifest", () => {
      // The manifest is what the PDF writer and ExportPdfPreview both fit room
      // pages from, so the union has to survive the derivation, not just the
      // helper.
      const project = projectWithDoor(SWINGS_OUT);
      const { settings } = reconcileDocumentExportPreferences(
        project,
        undefined,
        "en-US"
      );
      // A single-room project defaults its room plan OFF (the Overview already
      // shows the only room), so ask for the page explicitly.
      settings.sections.roomPlans = true;
      settings.rooms[0]!.planIncluded = true;
      const pages = deriveDocumentPageManifest(project, settings);
      const roomPage = pages.find((page) => page.kind === "room-plan");
      const scene = buildPlanScene(project);

      expect(roomPage).toBeDefined();
      expect(
        roomPage?.kind === "room-plan" ? roomPage.boundsMm : undefined
      ).toEqual(roomBounds(scene));
    });
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
