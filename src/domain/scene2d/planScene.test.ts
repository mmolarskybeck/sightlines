import { describe, expect, it } from "vitest";
import { WALL_OBJECT_PLAN_DEPTH_MM } from "../geometry/planObjects";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  CaseFloorObject,
  CaseWallObject,
  ConnectableOpeningWallObject,
  Project
} from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import {
  buildPlanScene,
  getPlanSceneObjectIdsIntersectingRect,
  getRenderedWallObjectPlanRect,
  planScenePaintOrder,
  svgPolygonPoints
} from "./planScene";

function artworkRecord(overrides: Partial<Artwork> = {}): Artwork {
  return {
    id: "art-1",
    schemaVersion: 1,
    dimensions: { widthMm: 1000, heightMm: 800, status: "known" },
    metadata: {},
    ...overrides
  };
}

function placedArtwork(overrides: Partial<ArtworkWallObject> = {}): ArtworkWallObject {
  return {
    id: "wo-artwork",
    kind: "artwork",
    artworkId: "art-1",
    wallId: "wall-north",
    xMm: 2000,
    yMm: 1450,
    widthMm: 1000,
    heightMm: 800,
    ...overrides
  };
}

function door(overrides: Partial<ConnectableOpeningWallObject> = {}): ConnectableOpeningWallObject {
  return {
    id: "wo-door",
    kind: "door",
    blocksPlacement: true,
    wallId: "wall-north",
    xMm: 5000,
    yMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    ...overrides
  };
}

describe("svgPolygonPoints", () => {
  it("encodes a loop exactly like the view's old inline formatter (x,y pairs space-joined)", () => {
    expect(
      svgPolygonPoints([
        { xMm: 0, yMm: 0 },
        { xMm: 100, yMm: 0 },
        { xMm: 100, yMm: 250.5 }
      ])
    ).toBe("0,0 100,0 100,250.5");
  });
});

describe("buildPlanScene rooms", () => {
  it("lifts each room's vertex loop and walls into floor space by the placement offset", () => {
    const project = createSampleProject();
    const placement = project.floor.rooms[0]!;
    placement.offsetXMm = 1000;
    placement.offsetYMm = 2000;

    const scene = buildPlanScene(project);

    expect(scene.rooms).toHaveLength(1);
    const room = scene.rooms[0]!;
    expect(room.roomId).toBe(placement.roomId);
    expect(room.placement).toBe(placement);
    expect(room.polygonMm[0]).toEqual({ xMm: 1000, yMm: 2000 });
    expect(room.polygonMm[2]).toEqual({
      xMm: 1000 + feetToMm(28),
      yMm: 2000 + feetToMm(18)
    });

    const north = room.walls.find((wall) => wall.wallId === "wall-north")!;
    expect(north.startMm).toEqual({ xMm: 1000, yMm: 2000 });
    expect(north.endMm).toEqual({ xMm: 1000 + feetToMm(28), yMm: 2000 });
    expect(room.walls.map((wall) => wall.wallId)).toEqual([
      "wall-north",
      "wall-east",
      "wall-south",
      "wall-west"
    ]);
  });

});

describe("buildPlanScene partitions", () => {
  it("lifts each free-standing wall's centerline to a floor-space slab rect at its own thickness", () => {
    const project = createSampleProject();
    const placement = project.floor.rooms[0]!;
    placement.offsetXMm = 500;
    placement.room.freestandingWalls.push({
      id: "fw-1",
      roomId: placement.roomId,
      name: "Partition 1",
      startXMm: 1000,
      startYMm: 1000,
      endXMm: 3000,
      endYMm: 1000,
      heightMm: 3000,
      thicknessMm: 100
    });

    const scene = buildPlanScene(project);

    expect(scene.partitions).toHaveLength(1);
    const { partition, rect } = scene.partitions[0]!;
    expect(partition.wallId).toBe("fw-1");
    expect(rect).toEqual({
      centerXMm: 2500,
      centerYMm: 1000,
      widthMm: 2000,
      depthMm: 100,
      angleDeg: 0
    });
  });
});

describe("getRenderedWallObjectPlanRect", () => {
  const restRect = {
    centerXMm: 2000,
    centerYMm: 0,
    widthMm: 1000,
    depthMm: WALL_OBJECT_PLAN_DEPTH_MM,
    angleDeg: 0
  };

  it("widens an artwork to its mat+frame outer width and shifts it to the viewer's side", () => {
    const rendered = getRenderedWallObjectPlanRect(
      restRect,
      "artwork",
      { matWidthMm: 50, frame: { widthMm: 25, finish: "black" } },
      0
    );

    // 50mm mat + 25mm frame per side → +150mm along the wall; the left
    // normal of an angle-0 wall is (0, 1), so the center shifts +depth/2 in y.
    expect(rendered.widthMm).toBe(1150);
    expect(rendered.centerXMm).toBe(2000);
    expect(rendered.centerYMm).toBeCloseTo(WALL_OBJECT_PLAN_DEPTH_MM / 2);
    expect(rendered.depthMm).toBe(WALL_OBJECT_PLAN_DEPTH_MM);
  });

  it("keeps doors centered on the wall line and applies the min-depth floor to every kind", () => {
    const renderedDoor = getRenderedWallObjectPlanRect(restRect, "door", undefined, 400);
    expect(renderedDoor.centerYMm).toBe(0);
    expect(renderedDoor.widthMm).toBe(1000);
    expect(renderedDoor.depthMm).toBe(400);

    // The viewer-side shift stays at the PRE-clamp half-depth: zoom (which is
    // what drives minDepthMm) must never move an artwork's center.
    const renderedArtwork = getRenderedWallObjectPlanRect(restRect, "artwork", undefined, 400);
    expect(renderedArtwork.centerYMm).toBeCloseTo(WALL_OBJECT_PLAN_DEPTH_MM / 2);
    expect(renderedArtwork.depthMm).toBe(400);
  });

  // The rect's provenance is a fact independent of whether the artwork is
  // framed: an already-outer rect (what resolvePlanPlacement hands a single-drag
  // preview) must not be widened a second time, but it still needs the
  // viewer-side offset and the min-depth clamp — so it cannot simply skip this
  // transform.
  it("widens an image-sized rect but not an already-outer one, offsetting and clamping both", () => {
    const artwork = { matWidthMm: 50, frame: { widthMm: 25, finish: "black" as const } };

    const fromImage = getRenderedWallObjectPlanRect(restRect, "artwork", artwork, 400, "image");
    const fromOuter = getRenderedWallObjectPlanRect(restRect, "artwork", artwork, 400, "outer");

    // Same framed artwork, same rect: only the provenance differs.
    expect(fromImage.widthMm).toBe(restRect.widthMm + 2 * (50 + 25));
    expect(fromOuter.widthMm).toBe(restRect.widthMm);

    // Both still get the viewer-side shift (pre-clamp half-depth) and the floor.
    expect(fromImage.centerYMm).toBeCloseTo(WALL_OBJECT_PLAN_DEPTH_MM / 2);
    expect(fromOuter.centerYMm).toBeCloseTo(WALL_OBJECT_PLAN_DEPTH_MM / 2);
    expect(fromImage.depthMm).toBe(400);
    expect(fromOuter.depthMm).toBe(400);
  });
});

describe("buildPlanScene wall objects", () => {
  it("joins the artwork record and precomputes rest + rendered rects", () => {
    const project = createSampleProject();
    project.wallObjects.push(placedArtwork(), door());
    const artwork = artworkRecord({ matWidthMm: 50, frame: { widthMm: 25, finish: "black" } });

    const scene = buildPlanScene(project, {
      artworksById: new Map([[artwork.id, artwork]]),
      minWallObjectDepthMm: 300
    });

    expect(scene.wallObjects).toHaveLength(2);
    const [artEntry, doorEntry] = scene.wallObjects;
    expect(artEntry!.object.id).toBe("wo-artwork");
    expect(artEntry!.artwork).toBe(artwork);
    expect(artEntry!.restRect).toEqual({
      centerXMm: 2000,
      centerYMm: 0,
      widthMm: 1000,
      depthMm: WALL_OBJECT_PLAN_DEPTH_MM,
      angleDeg: 0
    });
    expect(artEntry!.renderedRect.widthMm).toBe(1150);
    expect(artEntry!.renderedRect.centerYMm).toBeCloseTo(WALL_OBJECT_PLAN_DEPTH_MM / 2);
    expect(artEntry!.renderedRect.depthMm).toBe(300);

    expect(doorEntry!.artwork).toBeUndefined();
    expect(doorEntry!.renderedRect.centerYMm).toBe(0);
    expect(doorEntry!.renderedRect.depthMm).toBe(300);
  });

  it("defaults to true model depth (no clamp) and leaves objects on dangling walls out of the scene", () => {
    const project = createSampleProject();
    project.wallObjects.push(door(), door({ id: "wo-dangling", wallId: "wall-gone" }));

    const scene = buildPlanScene(project);

    expect(scene.wallObjects.map((entry) => entry.object.id)).toEqual(["wo-door"]);
    expect(scene.wallObjects[0]!.renderedRect.depthMm).toBe(WALL_OBJECT_PLAN_DEPTH_MM);
  });

  it("emits a wall case with its real protrusion depth rather than the nominal plan depth", () => {
    const project = createSampleProject();
    const wallCase: CaseWallObject = {
      id: "wo-case",
      kind: "case",
      wallId: "wall-north",
      xMm: 2000,
      yMm: 950,
      widthMm: 1500,
      heightMm: 180,
      depthMm: 450
    };
    project.wallObjects.push(wallCase);

    const scene = buildPlanScene(project);

    const caseEntry = scene.wallObjects.find((entry) => entry.object.id === "wo-case");
    expect(caseEntry).toBeDefined();
    expect(caseEntry!.restRect.widthMm).toBe(1500);
    // The case's depthMm (protrusion), not WALL_OBJECT_PLAN_DEPTH_MM.
    expect(caseEntry!.restRect.depthMm).toBe(450);
  });

  it("offsets a wall case's rendered rect to the viewer side (flush against the wall), keeping the anchor centered", () => {
    const project = createSampleProject();
    const wallCase: CaseWallObject = {
      id: "wo-case",
      kind: "case",
      wallId: "wall-north",
      xMm: 2000,
      yMm: 950,
      widthMm: 1500,
      heightMm: 180,
      depthMm: 450
    };
    project.wallObjects.push(wallCase);

    const scene = buildPlanScene(project);
    const caseEntry = scene.wallObjects.find((entry) => entry.object.id === "wo-case")!;

    // Width/depth are unchanged (no mat/frame widening for a case)...
    expect(caseEntry.renderedRect.widthMm).toBe(1500);
    expect(caseEntry.renderedRect.depthMm).toBe(450);
    // ...but the rendered center is shifted off the wall-centered anchor by
    // exactly half the protrusion depth (the box now sits flush ON the wall
    // line, protruding into the room), unlike a door which stays centered.
    const shiftMm = Math.hypot(
      caseEntry.renderedRect.centerXMm - caseEntry.restRect.centerXMm,
      caseEntry.renderedRect.centerYMm - caseEntry.restRect.centerYMm
    );
    expect(shiftMm).toBeCloseTo(225, 6);
  });
});

describe("getPlanSceneObjectIdsIntersectingRect", () => {
  it("selects a wall artwork when the marquee grazes only its frame band", () => {
    const project = createSampleProject();
    project.wallObjects.push(placedArtwork());
    const artwork = artworkRecord({
      matWidthMm: 50,
      frame: { widthMm: 25, finish: "black" }
    });
    const scene = buildPlanScene(project, {
      artworksById: new Map([[artwork.id, artwork]])
    });

    // Stored image width spans x [1500, 2500], while the rendered framed
    // width spans [1425, 2575]. This marquee touches only the right frame band.
    expect(
      getPlanSceneObjectIdsIntersectingRect(scene, {
        minXMm: 2520,
        maxXMm: 2560,
        minYMm: 1,
        maxYMm: 100
      })
    ).toEqual(["wo-artwork"]);

    // A marquee just beyond the rendered outer edge must not select it.
    expect(
      getPlanSceneObjectIdsIntersectingRect(scene, {
        minXMm: 2576,
        maxXMm: 2600,
        minYMm: 1,
        maxYMm: 100
      })
    ).toEqual([]);
  });
});

describe("buildPlanScene floor objects", () => {
  it("carries the floor object's own center/footprint/rotation and joins the artwork record", () => {
    const project = createSampleProject();
    const floorArtwork: ArtworkFloorObject = {
      id: "fo-1",
      kind: "artwork",
      artworkId: "art-1",
      xMm: 1234,
      yMm: 2345,
      widthMm: 600,
      depthMm: 400,
      heightMm: 800,
      rotationDeg: 30,
      wallYMm: 1450
    };
    project.floorObjects.push(floorArtwork);
    const artwork = artworkRecord();

    const scene = buildPlanScene(project, { artworksById: new Map([[artwork.id, artwork]]) });

    expect(scene.floorObjects).toHaveLength(1);
    expect(scene.floorObjects[0]!.artwork).toBe(artwork);
    expect(scene.floorObjects[0]!.rect).toEqual({
      centerXMm: 1234,
      centerYMm: 2345,
      widthMm: 600,
      depthMm: 400,
      angleDeg: 30
    });
  });

  it("emits a freestanding floor case with its own center/footprint/rotation", () => {
    const project = createSampleProject();
    const floorCase: CaseFloorObject = {
      id: "fo-case",
      kind: "case",
      xMm: 3000,
      yMm: 2000,
      widthMm: 1800,
      depthMm: 600,
      heightMm: 950,
      rotationDeg: 0,
      wallYMm: 950
    };
    project.floorObjects.push(floorCase);

    const scene = buildPlanScene(project);

    const caseEntry = scene.floorObjects.find((entry) => entry.object.id === "fo-case");
    expect(caseEntry).toBeDefined();
    expect(caseEntry!.artwork).toBeUndefined();
    expect(caseEntry!.rect).toEqual({
      centerXMm: 3000,
      centerYMm: 2000,
      widthMm: 1800,
      depthMm: 600,
      angleDeg: 0
    });
  });
});

describe("buildPlanScene opening connections", () => {
  function projectWithConnectedPair(): Project {
    const project = createSampleProject();
    project.wallObjects.push(
      door({ id: "wo-a", wallId: "wall-north", connectsToObjectId: "wo-b" }),
      door({ id: "wo-b", wallId: "wall-south", connectsToObjectId: "wo-a" })
    );
    return project;
  }

  it("emits exactly one glyph per pair, owned by the lexically smaller id", () => {
    const scene = buildPlanScene(projectWithConnectedPair());

    expect(scene.openingConnections).toHaveLength(1);
    const connection = scene.openingConnections[0]!;
    expect(connection.id).toBe("wo-a:wo-b");
    // North wall runs +x from (0,0); south wall runs -x from (28ft,18ft) —
    // both doors sit at xMm=5000 along their own wall, so the midpoint's y is
    // the room's half-depth and its x averages the two centers.
    expect(connection.aCenterMm).toEqual({ xMm: 5000, yMm: 0 });
    expect(connection.bCenterMm).toEqual({ xMm: feetToMm(28) - 5000, yMm: feetToMm(18) });
    expect(connection.midMm.yMm).toBeCloseTo(feetToMm(18) / 2);
    expect(connection.status).toBe("misaligned");
  });

  it("drops a pair whose partner or wall no longer resolves", () => {
    const project = projectWithConnectedPair();
    project.wallObjects = project.wallObjects.filter((object) => object.id !== "wo-b");

    expect(buildPlanScene(project).openingConnections).toHaveLength(0);
  });
});

describe("planScenePaintOrder", () => {
  const wall = (id: string, kind: string) => ({ object: { id, kind } });
  const floor = (id: string, kind: string) => ({ object: { id, kind } });

  it("paints cases first across both groups, then everything else", () => {
    // Stored order deliberately interleaves: an artwork stored BEFORE the
    // case it overlaps must still paint after it (the artwork hangs above
    // the case's glass top, so its rect covers the case seen from above).
    const wallObjects = [wall("art-1", "artwork"), wall("case-w", "case"), wall("door-1", "door")];
    const floorObjects = [floor("ped-1", "pedestal"), floor("case-f", "case")];

    const order = planScenePaintOrder(wallObjects, floorObjects).map(
      (painted) => `${painted.group}:${painted.entry.object.id}`
    );

    expect(order).toEqual([
      "wall:case-w",
      "floor:case-f",
      "wall:art-1",
      "wall:door-1",
      "floor:ped-1"
    ]);
  });

  it("is stable within each phase and handles empty groups", () => {
    const wallObjects = [wall("a", "artwork"), wall("b", "artwork")];
    expect(
      planScenePaintOrder(wallObjects, []).map((painted) => painted.entry.object.id)
    ).toEqual(["a", "b"]);
    expect(planScenePaintOrder([], [])).toEqual([]);
  });
});
