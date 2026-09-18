import { describe, expect, it } from "vitest";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  CaseFloorObject,
  CaseWallObject,
  ConnectableOpeningWallObject,
  ShelfWallObject,
  WallObject
} from "../project";
import { MONITOR_DEPTH_MM, MONITOR_PEDESTAL_HEIGHT_MM } from "../geometry/monitorGlyphs";
import type { FloorPartition } from "../geometry/freestandingWalls";
import {
  buildElevationScene,
  PARTITION_ABUT_THRESHOLD_MM,
  PARTITION_NEIGHBOR_MAX_GAP_MM,
  projectFloorObjectOntoWall,
  projectSupportedFootprintOntoWall,
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

  it("draws a projection with no frame band, while the stored frame survives on the record", () => {
    // Same record, same placement, same wall as the framed case above — only
    // the display type differs, and with it the whole framing derivation
    // (effectiveFraming). A projection has no mat and no frame on any surface,
    // so the footprint that overhung the wall no longer does.
    const artwork = {
      ...artworkRecord(),
      matWidthMm: 75,
      frame: { widthMm: 25, finish: "black" as const },
      displayAs: "projection" as const
    };
    const scene = buildElevationScene(
      [placement({ xMm: 550 })],
      { ...WALL, artworksById: new Map([[artwork.id, artwork]]) }
    );

    expect(scene.artworks[0]!.sizeMm).toEqual({ widthMm: 1000, heightMm: 800 });
    expect(scene.artworks[0]!.outOfBounds).toBe(false);
    // Suppressed at READ time, never deleted: the joined record still carries
    // both bands, so flipping back to "Wall work" restores them.
    expect(scene.artworks[0]!.artwork?.matWidthMm).toBe(75);
    expect(scene.artworks[0]!.artwork?.frame).toEqual({ widthMm: 25, finish: "black" });
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

  it("emits a wall shelf as a slab band spanning its ends at its stored centre height", () => {
    const shelf: ShelfWallObject = {
      id: "wo-shelf",
      kind: "shelf",
      wallId: "wall-north",
      xMm: 2000,
      yMm: 1180,
      widthMm: 1200,
      heightMm: 40,
      depthMm: 300
    };

    const scene = buildElevationScene([shelf], WALL);

    expect(scene.shelves).toEqual([
      {
        objectId: "wo-shelf",
        xMinMm: 1400,
        xMaxMm: 2600,
        // yMm is the slab CENTRE, heightMm its thickness — the band runs
        // 1160..1200, and 1200 is the face a work stands on.
        yMm: 1180,
        heightMm: 40,
        depthMm: 300
      }
    ]);
    // Its own bucket: never an opening, a case or a wall text.
    expect(scene.openings).toHaveLength(0);
    expect(scene.cases).toHaveLength(0);
    expect(scene.wallTexts).toHaveLength(0);
  });

  it("emits no shelf entries for a wall that has none", () => {
    expect(buildElevationScene([placement()], WALL).shelves).toEqual([]);
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

// A floor-standing box monitor: the CABINET's geometry (a 4:3 face, 450 deep),
// resting on the floor. `monitorSupport` absent = pedestal, the default.
function monitorPlacement(overrides: Partial<ArtworkFloorObject> = {}): ArtworkFloorObject {
  return {
    id: "floor-monitor",
    kind: "artwork",
    artworkId: "art-monitor",
    xMm: 3000,
    yMm: 1500,
    widthMm: 500,
    depthMm: MONITOR_DEPTH_MM,
    rotationDeg: 0,
    heightMm: 375,
    wallYMm: 1450,
    ...overrides
  };
}

const MONITOR_ARTWORKS: ReadonlyMap<string, Artwork> = new Map([
  [
    "art-monitor",
    {
      id: "art-monitor",
      schemaVersion: 1,
      dimensions: { status: "unknown" },
      displayAs: "monitor",
      metadata: {}
    } as Artwork
  ]
]);

describe("buildElevationScene monitor ghosts", () => {
  it("ghosts a floor-RESTING monitor, standing on the floor with its pedestal", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: MONITOR_ARTWORKS,
      floorArtworks: [monitorPlacement()],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.monitorGhosts).toHaveLength(1);
    expect(scene.monitorGhosts[0]).toMatchObject({
      xMinMm: 2750, // center 3000 ± halfWidth 250
      xMaxMm: 3250,
      monitorHeightMm: 375,
      // Absent monitorSupport resolves to a pedestal, HERE, at read time.
      pedestalHeightMm: MONITOR_PEDESTAL_HEIGHT_MM
    });
  });

  it("drops the plinth when the monitor stands on the bare floor", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: MONITOR_ARTWORKS,
      floorArtworks: [monitorPlacement({ monitorSupport: "floor" })],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.monitorGhosts[0]!.pedestalHeightMm).toBe(0);
  });

  it("emits nothing without the artwork join — the display type lives on the WORK", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      floorArtworks: [monitorPlacement()],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.monitorGhosts).toHaveLength(0);
    // ...and it must not fall through into the suspended bucket either.
    expect(scene.suspendedArtworkGhosts).toHaveLength(0);
  });

  it("never floats a monitor as a suspended board, even with a stale baseHeightMm", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: MONITOR_ARTWORKS,
      floorArtworks: [monitorPlacement({ baseHeightMm: 900 })],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.suspendedArtworkGhosts).toHaveLength(0);
    expect(scene.monitorGhosts.map((ghost) => ghost.object.id)).toEqual(["floor-monitor"]);
  });

  it("leaves an ordinary floor-resting artwork emitting no ghost at all", () => {
    // The narrow-exception guard: only displayAs === "monitor" ghosts, so no
    // existing project grows dashed outlines it never had.
    const scene = buildElevationScene([], {
      ...WALL,
      floorArtworks: [suspendedBoard({ baseHeightMm: undefined })],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.monitorGhosts).toHaveLength(0);
    expect(scene.suspendedArtworkGhosts).toHaveLength(0);
  });

  it("LEGACY: a default-pedestal monitor's support span IS its cabinet span", () => {
    // The whole safety argument for the two new span fields: the monitor
    // default is a pedestal sized to its own cabinet and carrying no offset, so
    // every pre-support monitor document produces a ghost whose support span
    // equals the span it has always drawn. Nothing legacy moves.
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: MONITOR_ARTWORKS,
      floorArtworks: [monitorPlacement()],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    const ghost = scene.monitorGhosts[0]!;
    expect(ghost.supportXMinMm).toBe(ghost.xMinMm);
    expect(ghost.supportXMaxMm).toBe(ghost.xMaxMm);
    expect(ghost.bonnetHeightMm).toBeUndefined();
  });

  it("carries an EXPLICIT plinth's own offset span and its bonnet", () => {
    // Plan already draws this assembly whole (PlanSceneFloorObject.support);
    // elevation used to shrink the plinth back to the cabinet and drop the
    // bonnet entirely.
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: MONITOR_ARTWORKS,
      floorArtworks: [
        monitorPlacement({
          support: {
            kind: "plinth",
            widthMm: 900,
            depthMm: 900,
            heightMm: 150,
            offsetXMm: 100,
            bonnetHeightMm: 450
          }
        })
      ],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.monitorGhosts[0]).toMatchObject({
      // The cabinet keeps its OWN span — a monitor on a wide plinth is still a
      // 500mm monitor.
      xMinMm: 2750,
      xMaxMm: 3250,
      monitorHeightMm: 375,
      pedestalHeightMm: 150,
      // The 900-wide plinth, shoved +100 along the placement's local x.
      supportXMinMm: 2650,
      supportXMaxMm: 3550,
      bonnetHeightMm: 450
    });
    // And it is still the monitor family, not the supported-artwork one.
    expect(scene.supportedArtworkGhosts).toHaveLength(0);
  });

  it("emits a bare-floor monitor's inert support span as its cabinet span", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: MONITOR_ARTWORKS,
      floorArtworks: [monitorPlacement({ monitorSupport: "floor" })],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    const ghost = scene.monitorGhosts[0]!;
    expect(ghost.pedestalHeightMm).toBe(0);
    expect(ghost.supportXMinMm).toBe(ghost.xMinMm);
    expect(ghost.supportXMaxMm).toBe(ghost.xMaxMm);
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

  it("carries the raw perpendicular gap, not just the abutting flag", () => {
    // Broadside at y=1000 with 100 mm thickness → nearest face 950 mm out.
    const far = buildPartitionScene([
      partition({
        startMm: { xMm: 2000, yMm: 1000 },
        endMm: { xMm: 5000, yMm: 1000 }
      })
    ]);
    expect(far.partitionProfiles[0]!.gapMm).toBeCloseTo(950);
    expect(far.partitionProfiles[0]!.abutting).toBe(false);

    // Same slab pushed out past the spacing-neighbor rule: still a profile,
    // still a gap that consumers can threshold on.
    const beyond = buildPartitionScene([
      partition({
        startMm: { xMm: 2000, yMm: 3000 },
        endMm: { xMm: 5000, yMm: 3000 }
      })
    ]);
    expect(beyond.partitionProfiles[0]!.gapMm).toBeCloseTo(2950);
    expect(beyond.partitionProfiles[0]!.gapMm).toBeGreaterThan(
      PARTITION_NEIGHBOR_MAX_GAP_MM
    );
  });

  it("floors the gap at 0 for a partition touching or crossing the wall line", () => {
    const meeting = buildPartitionScene([partition()]);
    expect(meeting.partitionProfiles[0]!.gapMm).toBe(0);

    const crossing = buildPartitionScene([
      partition({
        startMm: { xMm: 3000, yMm: -500 },
        endMm: { xMm: 3000, yMm: 1500 }
      })
    ]);
    expect(crossing.partitionProfiles[0]!.gapMm).toBe(0);
  });

  it("keeps abutting pinned to the 150 mm threshold, independent of the neighbor rule", () => {
    // Gap exactly 150 → abutting; one millimetre further → not.
    const at = buildPartitionScene([
      partition({
        startMm: { xMm: 2000, yMm: PARTITION_ABUT_THRESHOLD_MM + 50 },
        endMm: { xMm: 5000, yMm: PARTITION_ABUT_THRESHOLD_MM + 50 }
      })
    ]);
    expect(at.partitionProfiles[0]!.gapMm).toBeCloseTo(PARTITION_ABUT_THRESHOLD_MM);
    expect(at.partitionProfiles[0]!.abutting).toBe(true);

    const past = buildPartitionScene([
      partition({
        startMm: { xMm: 2000, yMm: PARTITION_ABUT_THRESHOLD_MM + 51 },
        endMm: { xMm: 5000, yMm: PARTITION_ABUT_THRESHOLD_MM + 51 }
      })
    ]);
    expect(past.partitionProfiles[0]!.abutting).toBe(false);
  });
});

// A sculpture standing on a pedestal: 400 × 300 work, 900 tall, on a 600 × 500
// block 1100 tall. The union footprint is WIDER than the work, which is the
// whole reason the ghost carries two spans.
function supportedSculpture(
  overrides: Partial<ArtworkFloorObject> = {}
): ArtworkFloorObject {
  return {
    id: "floor-sculpture",
    kind: "artwork",
    artworkId: "art-sculpture",
    xMm: 3000,
    yMm: 1500,
    widthMm: 400,
    depthMm: 300,
    rotationDeg: 0,
    heightMm: 900,
    wallYMm: 1450,
    support: { kind: "pedestal", widthMm: 600, depthMm: 500, heightMm: 1100 },
    ...overrides
  };
}

const SCULPTURE_ARTWORKS: ReadonlyMap<string, Artwork> = new Map([
  [
    "art-sculpture",
    {
      id: "art-sculpture",
      schemaVersion: 1,
      dimensions: { status: "unknown" },
      displayAs: "sculpture",
      metadata: {}
    } as Artwork
  ]
]);

describe("buildElevationScene supported-artwork ghosts", () => {
  it("ghosts a supported work with the union span and the work's own span", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: SCULPTURE_ARTWORKS,
      floorArtworks: [supportedSculpture()],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.supportedArtworkGhosts).toHaveLength(1);
    expect(scene.supportedArtworkGhosts[0]).toEqual({
      kind: "supported-artwork",
      objectId: "floor-sculpture",
      // The 600-wide pedestal, not the 400-wide work.
      xMinMm: 2700,
      xMaxMm: 3300,
      supportHeightMm: 1100,
      workHeightMm: 900,
      workXMinMm: 2800,
      workXMaxMm: 3200,
      // Overhang off: the support IS the assembly here.
      supportXMinMm: 2700,
      supportXMaxMm: 3300
    });
    // Absent bonnet stays absent — the consumer draws no glass.
    expect(scene.supportedArtworkGhosts[0]).not.toHaveProperty("bonnetHeightMm");
  });

  it("carries the bonnet height when there is a bonnet", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: SCULPTURE_ARTWORKS,
      floorArtworks: [
        supportedSculpture({
          support: {
            kind: "pedestal",
            widthMm: 600,
            depthMm: 500,
            heightMm: 1100,
            bonnetHeightMm: 975
          }
        })
      ],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.supportedArtworkGhosts[0]!.bonnetHeightMm).toBe(975);
  });

  it("ghosts a supported work standing on a plinth, never as a floating board", () => {
    // A stale suspension height left behind by a work that was later stood on a
    // plinth must not float it: the support owns the vertical state.
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: SCULPTURE_ARTWORKS,
      floorArtworks: [supportedSculpture({ baseHeightMm: 900 })],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.suspendedArtworkGhosts).toHaveLength(0);
    expect(scene.supportedArtworkGhosts).toHaveLength(1);
    expect(scene.supportedArtworkGhosts[0]!.supportHeightMm).toBe(1100);
  });

  it("emits nothing for an unsupported floor-resting work", () => {
    const scene = buildElevationScene([], {
      ...WALL,
      artworksById: SCULPTURE_ARTWORKS,
      floorArtworks: [supportedSculpture({ support: undefined, baseHeightMm: undefined })],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });

    expect(scene.supportedArtworkGhosts).toHaveLength(0);
    expect(scene.suspendedArtworkGhosts).toHaveLength(0);
  });

  it("leaves monitors to the monitor ghost, on their pedestal or on a plinth", () => {
    const onDefault = buildElevationScene([], {
      ...WALL,
      artworksById: MONITOR_ARTWORKS,
      floorArtworks: [monitorPlacement()],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });
    expect(onDefault.supportedArtworkGhosts).toHaveLength(0);
    // Unchanged by supports existing: the absent default still resolves to 800.
    expect(onDefault.monitorGhosts[0]!.pedestalHeightMm).toBe(MONITOR_PEDESTAL_HEIGHT_MM);

    const onPlinth = buildElevationScene([], {
      ...WALL,
      artworksById: MONITOR_ARTWORKS,
      floorArtworks: [
        monitorPlacement({
          support: { kind: "plinth", widthMm: 900, depthMm: 900, heightMm: 150 }
        })
      ],
      wallStartFloorMm: WALL_START,
      wallEndFloorMm: WALL_END
    });
    expect(onPlinth.supportedArtworkGhosts).toHaveLength(0);
    // An explicit block under the cabinet beats the 800mm default.
    expect(onPlinth.monitorGhosts[0]!.pedestalHeightMm).toBe(150);
  });
});

describe("projectSupportedFootprintOntoWall", () => {
  const SUPPORT = { kind: "pedestal", widthMm: 600, depthMm: 500, heightMm: 1100 } as const;

  it("reports the union span around the work's own", () => {
    expect(
      projectSupportedFootprintOntoWall(supportedSculpture(), SUPPORT, WALL_START, WALL_END)
    ).toEqual({
      xMinMm: 2700,
      xMaxMm: 3300,
      workXMinMm: 2800,
      workXMaxMm: 3200,
      // The support is centred on the work here, so its own span IS the union's
      // — the three only diverge under an offset or an overhang.
      supportXMinMm: 2700,
      supportXMaxMm: 3300
    });
  });

  it("reports the SUPPORT's own span, which an offset pulls off the union's", () => {
    const projection = projectSupportedFootprintOntoWall(
      supportedSculpture(),
      { ...SUPPORT, offsetXMm: 100 },
      WALL_START,
      WALL_END
    )!;
    // Work spans 2800..3200; the 600-wide support, shoved +100 along the
    // placement's local x, spans 2800..3400. The union is the pair.
    expect(projection.supportXMinMm).toBe(2800);
    expect(projection.supportXMaxMm).toBe(3400);
    expect(projection.workXMinMm).toBe(2800);
    expect(projection.workXMaxMm).toBe(3200);
    expect(projection.xMinMm).toBe(2800);
    expect(projection.xMaxMm).toBe(3400);
  });

  it("widens both spans for a rotated placement", () => {
    const projection = projectSupportedFootprintOntoWall(
      supportedSculpture({ rotationDeg: 45 }),
      SUPPORT,
      WALL_START,
      WALL_END
    );
    // |600·cos45| + |500·sin45| ≈ 777.8, so the union is wider than 600.
    expect(projection!.xMaxMm - projection!.xMinMm).toBeCloseTo(777.82, 1);
    expect(projection!.workXMaxMm - projection!.workXMinMm).toBeCloseTo(494.97, 1);
  });

  it("returns null when the whole assembly misses the wall", () => {
    expect(
      projectSupportedFootprintOntoWall(
        supportedSculpture({ xMm: 12000 }),
        SUPPORT,
        WALL_START,
        WALL_END
      )
    ).toBeNull();
  });
});
