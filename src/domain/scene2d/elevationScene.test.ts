import { describe, expect, it } from "vitest";
import type {
  Artwork,
  ArtworkWallObject,
  CaseFloorObject,
  CaseWallObject,
  ConnectableOpeningWallObject,
  WallObject
} from "../project";
import {
  buildElevationScene,
  projectFloorCaseOntoWall,
  wallLocalYToSvgY
} from "./elevationScene";

// wallLocalYToSvgY / getArtworkRectSvg / isArtworkOutOfWallBounds moved here
// from app/components/elevation/elevationArtworkGeometry.ts, which still owns their
// characterization tests via its re-exports — this file covers only the
// scene builder itself.

const WALL = {
  wallId: "wall-north",
  wallLengthMm: 8000,
  wallHeightMm: 3000,
  centerlineMm: 1450
};

function artworkRecord(): Artwork {
  return {
    id: "art-1",
    schemaVersion: 1,
    dimensions: { widthMm: 1000, heightMm: 800, status: "known" },
    assetId: "asset-1",
    metadata: {}
  };
}

function placement(overrides: Partial<ArtworkWallObject> = {}): ArtworkWallObject {
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
    yMm: 1050,
    widthMm: 900,
    heightMm: 2100,
    ...overrides
  };
}

describe("buildElevationScene", () => {
  it("derives the floor and centerline rules in SVG space", () => {
    const scene = buildElevationScene([], WALL);

    expect(scene.floorLineSvgY).toBe(3000);
    expect(scene.centerlineSvgY).toBe(wallLocalYToSvgY(3000, 1450));
    expect(scene.wallLengthMm).toBe(8000);
    expect(scene.wallHeightMm).toBe(3000);
  });

  it("keeps only this wall's objects, split by kind in stored order", () => {
    const objects: WallObject[] = [
      placement(),
      door(),
      placement({ id: "wo-elsewhere", wallId: "wall-south" }),
      placement({ id: "wo-artwork-2", xMm: 6000 })
    ];

    const scene = buildElevationScene(objects, WALL);

    expect(scene.artworks.map((entry) => entry.object.id)).toEqual([
      "wo-artwork",
      "wo-artwork-2"
    ]);
    expect(scene.openings.map((entry) => entry.object.id)).toEqual(["wo-door"]);
  });

  it("matches nothing when no wall is selected (unwired view renders a bare wall)", () => {
    const scene = buildElevationScene([placement()], { ...WALL, wallId: undefined });

    expect(scene.artworks).toHaveLength(0);
    expect(scene.openings).toHaveLength(0);
  });

  it("carries wall-local center/size and flags placements that extend past the wall", () => {
    const scene = buildElevationScene(
      [placement(), placement({ id: "wo-overhang", xMm: 7800 }), door()],
      WALL
    );

    const [inside, overhang] = scene.artworks;
    expect(inside!.centerMm).toEqual({ xMm: 2000, yMm: 1450 });
    expect(inside!.sizeMm).toEqual({ widthMm: 1000, heightMm: 800 });
    expect(inside!.outOfBounds).toBe(false);
    // 7800 + 500 half-width = 8300 > 8000 → past the wall end.
    expect(overhang!.outOfBounds).toBe(true);
    expect(scene.openings[0]!.outOfBounds).toBe(false);
  });

  it("flags a framed footprint past the wall edge while keeping scene size image-sized", () => {
    const artwork = {
      ...artworkRecord(),
      matWidthMm: 75,
      frame: { widthMm: 25, finish: "black" as const }
    };
    const scene = buildElevationScene(
      [placement({ xMm: 550 })],
      { ...WALL, artworksById: new Map([[artwork.id, artwork]]) }
    );

    expect(scene.artworks[0]!.sizeMm).toEqual({ widthMm: 1000, heightMm: 800 });
    expect(scene.artworks[0]!.outOfBounds).toBe(true);
  });

  it("joins the artwork record when it resolves and leaves it undefined when dangling", () => {
    const artwork = artworkRecord();
    const scene = buildElevationScene(
      [placement(), placement({ id: "wo-dangling", artworkId: "art-gone" })],
      { ...WALL, artworksById: new Map([[artwork.id, artwork]]) }
    );

    expect(scene.artworks[0]!.artwork).toBe(artwork);
    expect(scene.artworks[1]!.artwork).toBeUndefined();
  });

  it("emits a wall case as its own entry with wall-local center + size", () => {
    const wallCase: CaseWallObject = {
      id: "wo-case",
      kind: "case",
      wallId: "wall-north",
      xMm: 3000,
      yMm: 950,
      widthMm: 1500,
      heightMm: 180,
      depthMm: 450
    };

    const scene = buildElevationScene([wallCase], WALL);

    expect(scene.cases).toHaveLength(1);
    expect(scene.cases[0]!.object.id).toBe("wo-case");
    expect(scene.cases[0]!.centerMm).toEqual({ xMm: 3000, yMm: 950 });
    expect(scene.cases[0]!.sizeMm).toEqual({ widthMm: 1500, heightMm: 180 });
    // Not misfiled as an opening.
    expect(scene.openings).toHaveLength(0);
  });
});

// A wall running along the x-axis from the origin, so wall-local x = floor x
// and the projection math is easy to reason about.
const WALL_START = { xMm: 0, yMm: 0 };
const WALL_END = { xMm: 8000, yMm: 0 };

function floorCase(overrides: Partial<CaseFloorObject> = {}): CaseFloorObject {
  return {
    id: "floor-case",
    kind: "case",
    xMm: 2000,
    yMm: 1500,
    widthMm: 1800,
    depthMm: 600,
    rotationDeg: 0,
    heightMm: 950,
    wallYMm: 950,
    ...overrides
  };
}

describe("projectFloorCaseOntoWall", () => {
  it("projects an axis-aligned floor case to its width-spanning x-range", () => {
    const range = projectFloorCaseOntoWall(floorCase(), WALL_START, WALL_END);
    // center 2000 ± halfWidth 900.
    expect(range).toEqual({ xMinMm: 1100, xMaxMm: 2900 });
  });

  it("projects a 90°-rotated floor case to its depth-spanning x-range", () => {
    const range = projectFloorCaseOntoWall(
      floorCase({ rotationDeg: 90 }),
      WALL_START,
      WALL_END
    );
    // Rotated 90°, the along-wall extent is the depth (600): center 2000 ± 300.
    expect(range!.xMinMm).toBeCloseTo(1700);
    expect(range!.xMaxMm).toBeCloseTo(2300);
  });

  it("clamps a footprint straddling the wall end to the wall extent", () => {
    const range = projectFloorCaseOntoWall(
      floorCase({ xMm: 7800 }), // 6900..8700, past the 8000 end
      WALL_START,
      WALL_END
    );
    expect(range).toEqual({ xMinMm: 6900, xMaxMm: 8000 });
  });

  it("emits nothing for a case entirely off the wall's extent", () => {
    const range = projectFloorCaseOntoWall(
      floorCase({ xMm: 12000 }), // 11100..12900, all beyond 8000
      WALL_START,
      WALL_END
    );
    expect(range).toBeNull();
  });
});

describe("buildElevationScene floor-case ghosts", () => {
  it("emits a ghost spanning floor to the case height for a case in front of the wall", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      floorCases: [floorCase()],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.floorCaseGhosts).toHaveLength(1);
    expect(scene.floorCaseGhosts[0]).toMatchObject({
      xMinMm: 1100,
      xMaxMm: 2900,
      heightMm: 950
    });
    expect(scene.floorCaseGhosts[0]!.object.id).toBe("floor-case");
  });

  it("emits no ghost for a case outside the wall extent", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      floorCases: [floorCase({ xMm: 12000 })],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.floorCaseGhosts).toHaveLength(0);
  });

  it("emits no ghosts when the wall geometry is not supplied", () => {
    const scene = buildElevationScene([], { ...WALL, floorCases: [floorCase()] });
    expect(scene.floorCaseGhosts).toHaveLength(0);
  });
});
