import { describe, expect, it } from "vitest";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  CaseFloorObject,
  CaseWallObject,
  ConnectableOpeningWallObject,
  WallObject
} from "../project";
import type { FloorPartition } from "../geometry/freestandingWalls";
import {
  buildElevationScene,
  PARTITION_ABUT_THRESHOLD_MM,
  projectFloorObjectOntoWall,
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

describe("projectFloorObjectOntoWall", () => {
  it("projects an axis-aligned floor case to its width-spanning x-range", () => {
    const range = projectFloorObjectOntoWall(floorCase(), WALL_START, WALL_END);
    // center 2000 ± halfWidth 900.
    expect(range).toEqual({ xMinMm: 1100, xMaxMm: 2900 });
  });

  it("projects a 90°-rotated floor case to its depth-spanning x-range", () => {
    const range = projectFloorObjectOntoWall(
      floorCase({ rotationDeg: 90 }),
      WALL_START,
      WALL_END
    );
    // Rotated 90°, the along-wall extent is the depth (600): center 2000 ± 300.
    expect(range!.xMinMm).toBeCloseTo(1700);
    expect(range!.xMaxMm).toBeCloseTo(2300);
  });

  it("clamps a footprint straddling the wall end to the wall extent", () => {
    const range = projectFloorObjectOntoWall(
      floorCase({ xMm: 7800 }), // 6900..8700, past the 8000 end
      WALL_START,
      WALL_END
    );
    expect(range).toEqual({ xMinMm: 6900, xMaxMm: 8000 });
  });

  it("emits nothing for a case entirely off the wall's extent", () => {
    const range = projectFloorObjectOntoWall(
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

// A thin freestanding board (MDF projection surface) hung from ceiling wires:
// 2400 wide, 40 deep, bottom edge 900 above the floor.
function suspendedBoard(overrides: Partial<ArtworkFloorObject> = {}): ArtworkFloorObject {
  return {
    id: "floor-board",
    kind: "artwork",
    artworkId: "art-1",
    xMm: 3000,
    yMm: 1500,
    widthMm: 2400,
    depthMm: 40,
    rotationDeg: 0,
    heightMm: 1800,
    wallYMm: 1450,
    baseHeightMm: 900,
    ...overrides
  };
}

describe("buildElevationScene suspended-artwork ghosts", () => {
  it("floats the ghost from baseHeightMm to baseHeightMm + heightMm", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      floorArtworks: [suspendedBoard()],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.suspendedArtworkGhosts).toHaveLength(1);
    // The whole point of the entry: it does NOT rise from the floor the way a
    // floor-case ghost does — bottom 900, top 900 + 1800 = 2700.
    expect(scene.suspendedArtworkGhosts[0]).toMatchObject({
      xMinMm: 1800, // center 3000 ± halfWidth 1200
      xMaxMm: 4200,
      baseHeightMm: 900,
      heightMm: 1800
    });
    expect(scene.suspendedArtworkGhosts[0]!.object.id).toBe("floor-board");
  });

  it("projects a 45°-angled board onto the wall's along-axis, not its own width", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      floorArtworks: [suspendedBoard({ rotationDeg: 45 })],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    // The along-wall extent of a rotated rect is |w·cos| + |d·sin|:
    // (2400 + 40) · cos45 = 1725.34, so center 3000 ± 862.67. Note this is
    // NARROWER than the board's own 2400 width — a thin board angled away from
    // the wall foreshortens. (A DEEP object, like a floor case, is the case
    // where rotation widens the span past its width; both fall out of the same
    // formula.)
    const ghost = scene.suspendedArtworkGhosts[0]!;
    expect(ghost.xMinMm).toBeCloseTo(2137.33, 1);
    expect(ghost.xMaxMm).toBeCloseTo(3862.67, 1);
  });

  it("does not ghost a floor-RESTING artwork (absent or zero baseHeightMm)", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      floorArtworks: [
        suspendedBoard({ id: "resting-implicit", baseHeightMm: undefined }),
        suspendedBoard({ id: "resting-explicit", baseHeightMm: 0 })
      ],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    // Deliberate: only suspended objects ghost, so existing projects with floor
    // artwork keep the elevations they have today.
    expect(scene.suspendedArtworkGhosts).toHaveLength(0);
  });

  it("emits no ghost for a board entirely off the wall's extent", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      floorArtworks: [suspendedBoard({ xMm: 12000 })], // 10800..13200, past 8000
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.suspendedArtworkGhosts).toHaveLength(0);
  });

  it("emits no ghosts when the wall geometry is not supplied", () => {
    const scene = buildElevationScene([], { ...WALL, floorArtworks: [suspendedBoard()] });
    expect(scene.suspendedArtworkGhosts).toHaveLength(0);
  });

  it("keeps case and suspended-artwork ghosts in separate buckets", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      floorCases: [floorCase()],
      floorArtworks: [suspendedBoard()],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    // The PDF elevation page draws floorCaseGhosts with the case glyph (glass
    // box, slab, legs) — a board must never land in that array.
    expect(scene.floorCaseGhosts.map((ghost) => ghost.object.id)).toEqual(["floor-case"]);
    expect(scene.suspendedArtworkGhosts.map((ghost) => ghost.object.id)).toEqual(["floor-board"]);
  });
});

// WALL_START→WALL_END runs +x along y=0, so the LEFT normal (the codebase's
// one viewer-side convention, unitLeftNormalOrZero) is +y: the viewer stands at
// POSITIVE y, which is exactly where the floor cases and boards above sit. Every
// partition below is positioned against that fact.
function partition(overrides: Partial<FloorPartition> = {}): FloorPartition {
  return {
    wallId: "partition-1",
    roomId: "room-1",
    startMm: { xMm: 3000, yMm: 0 },
    endMm: { xMm: 3000, yMm: 2000 },
    thicknessMm: 100,
    heightMm: 2400,
    name: "Partition 1",
    ...overrides
  };
}

function buildPartitionScene(partitions: FloorPartition[]) {
  return buildElevationScene([], {
    ...WALL,
    partitions,
    wallStartFloorMm: WALL_START,
    wallEndFloorMm: WALL_END
  });
}

describe("buildElevationScene partition profiles", () => {
  it("projects a perpendicular partition meeting the wall to a thickness-wide abutting band", () => {
    const scene = buildPartitionScene([partition()]);

    expect(scene.partitionProfiles).toHaveLength(1);
    const profile = scene.partitionProfiles[0]!;
    // Seen end-on, the partition shows only its end cap: 100 mm of thickness
    // centered on x=3000 — NOT its 2000 mm length.
    expect(profile.xMinMm).toBeCloseTo(2950);
    expect(profile.xMaxMm).toBeCloseTo(3050);
    expect(profile.heightMm).toBe(2400);
    expect(profile.abutting).toBe(true);
    expect(profile.partition.wallId).toBe("partition-1");
  });

  it("ghosts a parallel partition standing a metre off the wall", () => {
    const scene = buildPartitionScene([
      partition({
        startMm: { xMm: 2000, yMm: 1000 },
        endMm: { xMm: 5000, yMm: 1000 }
      })
    ]);

    const profile = scene.partitionProfiles[0]!;
    // Seen broadside: its full 3000 mm length.
    expect(profile.xMinMm).toBeCloseTo(2000);
    expect(profile.xMaxMm).toBeCloseTo(5000);
    // Nearest face is 950 mm off the wall — well past the abut threshold.
    expect(profile.abutting).toBe(false);
  });

  it("counts a partition exactly at the abut threshold as abutting", () => {
    // Face-to-wall gap = 200 − thickness/2 = 150 = the threshold itself.
    const scene = buildPartitionScene([
      partition({
        startMm: { xMm: 2000, yMm: PARTITION_ABUT_THRESHOLD_MM + 50 },
        endMm: { xMm: 5000, yMm: PARTITION_ABUT_THRESHOLD_MM + 50 }
      })
    ]);

    expect(scene.partitionProfiles[0]!.abutting).toBe(true);
  });

  it("emits nothing for a partition entirely on the wall's non-viewer side", () => {
    // Handedness pin: the viewer of a wall running start→end is on its LEFT
    // (+y here). A partition at NEGATIVE y is behind this face — masonry the
    // viewer cannot see — while its mirror image at positive y is visible. If
    // the normal ever flips, exactly one of these two assertions breaks.
    const behind = buildPartitionScene([
      partition({
        startMm: { xMm: 2000, yMm: -1500 },
        endMm: { xMm: 5000, yMm: -1500 }
      })
    ]);
    expect(behind.partitionProfiles).toHaveLength(0);

    const inFront = buildPartitionScene([
      partition({
        startMm: { xMm: 2000, yMm: 1500 },
        endMm: { xMm: 5000, yMm: 1500 }
      })
    ]);
    expect(inFront.partitionProfiles).toHaveLength(1);
  });

  it("treats a partition crossing the wall line as abutting and clamps its span", () => {
    const scene = buildPartitionScene([
      partition({
        startMm: { xMm: 7900, yMm: -500 },
        endMm: { xMm: 7900, yMm: 1500 },
        thicknessMm: 400
      })
    ]);

    const profile = scene.partitionProfiles[0]!;
    // Raw span 7700..8100; the far end is clamped to the wall's 8000 extent.
    expect(profile.xMinMm).toBeCloseTo(7700);
    expect(profile.xMaxMm).toBeCloseTo(8000);
    // Corners on both sides of the line → the gap floors at 0, never negative.
    expect(profile.abutting).toBe(true);
  });

  it("projects an oblique partition to a span between its thickness and its length", () => {
    const scene = buildPartitionScene([
      partition({
        startMm: { xMm: 3000, yMm: 500 },
        endMm: { xMm: 4000, yMm: 1500 },
        thicknessMm: 200
      })
    ]);

    const profile = scene.partitionProfiles[0]!;
    // 45°: |L·cos45| + |t·sin45| = 1000 + 141.42, centered on x=3500.
    expect(profile.xMinMm).toBeCloseTo(2929.29, 1);
    expect(profile.xMaxMm).toBeCloseTo(4070.71, 1);
    const spanMm = profile.xMaxMm - profile.xMinMm;
    expect(spanMm).toBeGreaterThan(200);
    expect(spanMm).toBeLessThan(Math.hypot(1000, 1000));
    // Nearest corner is 429 mm out — a freestanding ghost, not a band.
    expect(profile.abutting).toBe(false);
  });

  it("emits nothing for a partition entirely off the wall's extent", () => {
    const scene = buildPartitionScene([
      partition({ startMm: { xMm: 12000, yMm: 0 }, endMm: { xMm: 12000, yMm: 2000 } })
    ]);

    expect(scene.partitionProfiles).toHaveLength(0);
  });

  it("emits no profiles when the wall geometry is not supplied", () => {
    const scene = buildElevationScene([], { ...WALL, partitions: [partition()] });
    expect(scene.partitionProfiles).toHaveLength(0);
  });

  it("emits no profiles when no partitions are supplied", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });
    expect(scene.partitionProfiles).toEqual([]);
  });
});
