import { describe, expect, it } from "vitest";
import type {
  Artwork,
  ArtworkWallObject,
  ConnectableOpeningWallObject,
  WallObject
} from "../project";
import type { FloorPartition } from "../geometry/freestandingWalls";
import { buildElevationScene } from "../scene2d/elevationScene";
import {
  deriveElevationSceneDimensions,
  elevationSceneToDimensionParticipants
} from "./elevationDimensions";

const WALL = {
  wallId: "wall-north",
  wallLengthMm: 5000,
  wallHeightMm: 3000,
  centerlineMm: 1450
};

const artwork: ArtworkWallObject = {
  id: "wo-1",
  kind: "artwork",
  artworkId: "art-1",
  wallId: "wall-north",
  xMm: 1000,
  yMm: 1450,
  widthMm: 1000,
  heightMm: 800
};

const door: ConnectableOpeningWallObject = {
  id: "wo-2",
  kind: "door",
  blocksPlacement: true,
  wallId: "wall-north",
  xMm: 3000,
  yMm: 1050,
  widthMm: 900,
  heightMm: 2100
};

describe("elevationDimensions adapter", () => {
  it("maps scene artworks and openings to participants by kind, min-corner rect", () => {
    const objects: WallObject[] = [artwork, door];
    const scene = buildElevationScene(objects, WALL);
    const participants = elevationSceneToDimensionParticipants(scene);

    const art = participants.find((p) => p.id === "wo-1");
    const opening = participants.find((p) => p.id === "wo-2");
    expect(art?.kind).toBe("artwork");
    expect(opening?.kind).toBe("door");
    // Center (1000, 1450) with 1000x800 footprint -> min corner (500, 1050).
    expect(art?.rect).toEqual({ xMm: 500, yMm: 1050, widthMm: 1000, heightMm: 800 });
  });

  it("uses the mat+frame outer footprint for framed artworks (§9.6 true rendered footprint)", () => {
    const framed: Artwork = {
      id: "art-1",
      schemaVersion: 1,
      dimensions: { widthMm: 1000, heightMm: 800, status: "known" },
      metadata: {},
      matWidthMm: 50,
      frame: { widthMm: 25, finish: "black" }
    };
    const scene = buildElevationScene([artwork], {
      ...WALL,
      artworksById: new Map([[framed.id, framed]])
    });
    const participants = elevationSceneToDimensionParticipants(scene);

    // 75mm band (mat 50 + frame 25) per side around the same center (1000,
    // 1450): image 1000x800 -> outer 1150x950, min corner (425, 975).
    expect(participants.find((p) => p.id === "wo-1")?.rect).toEqual({
      xMm: 425,
      yMm: 975,
      widthMm: 1150,
      heightMm: 950
    });
  });

  it("classifies blocked zones routed through scene.openings", () => {
    const blockedZone: WallObject = {
      id: "wo-bz",
      kind: "blocked-zone",
      blocksPlacement: true,
      wallId: "wall-north",
      xMm: 2500,
      yMm: 1500,
      widthMm: 400,
      heightMm: 3000
    };
    const scene = buildElevationScene([artwork, blockedZone], WALL);
    const participants = elevationSceneToDimensionParticipants(scene);
    expect(participants.find((p) => p.id === "wo-bz")?.kind).toBe("blocked-zone");
  });

  it("derives a horizontal gap between an artwork and a door through the scene", () => {
    const scene = buildElevationScene([artwork, door], WALL);
    const dims = deriveElevationSceneDimensions(scene);

    const gap = dims.neighborGaps.find(
      (g) => g.axis === "horizontal" && g.aId === "wo-1" && g.bId === "wo-2"
    );
    // Door left edge 2550, artwork right edge 1500 -> 1050mm gap.
    expect(gap?.gapMm).toBe(1050);
    expect(dims.overallWidthMm).toBe(5000);
  });
});

// The wall runs +x along y=0, so its viewer (and every partition that may
// project onto it) is at POSITIVE y — the same handedness pin as
// elevationScene.test.ts.
const WALL_WITH_FLOOR = {
  ...WALL,
  wallStartFloorMm: { xMm: 0, yMm: 0 },
  wallEndFloorMm: { xMm: 5000, yMm: 0 }
};

function partition(overrides: Partial<FloorPartition> = {}): FloorPartition {
  return {
    wallId: "partition-1",
    roomId: "room-1",
    // End-on against the wall at x=3000: a 100mm-wide abutting band.
    startMm: { xMm: 3000, yMm: 0 },
    endMm: { xMm: 3000, yMm: 2000 },
    thicknessMm: 100,
    heightMm: 2400,
    name: "Partition 1",
    ...overrides
  };
}

describe("elevationDimensions partition participants", () => {
  it("maps a nearby partition profile to a floor-standing min-corner rect", () => {
    const scene = buildElevationScene([artwork], {
      ...WALL_WITH_FLOOR,
      partitions: [partition()]
    });
    const participants = elevationSceneToDimensionParticipants(scene);

    const slab = participants.find((p) => p.id === "partition-1");
    expect(slab?.kind).toBe("partition");
    // Wall-local y-up: the slab rises FROM the floor, so its min corner is y=0.
    expect(slab?.rect).toEqual({
      xMm: 2950,
      yMm: 0,
      widthMm: 100,
      heightMm: 2400
    });
  });

  it("clamps a partition taller than the wall to the wall height", () => {
    const scene = buildElevationScene([artwork], {
      ...WALL_WITH_FLOOR,
      partitions: [partition({ heightMm: 4000 })]
    });
    const slab = elevationSceneToDimensionParticipants(scene).find(
      (p) => p.id === "partition-1"
    );

    expect(slab?.rect.heightMm).toBe(WALL.wallHeightMm);
  });

  it("derives a horizontal gap between an artwork and a nearby partition", () => {
    const scene = buildElevationScene([artwork], {
      ...WALL_WITH_FLOOR,
      partitions: [partition()]
    });
    const dims = deriveElevationSceneDimensions(scene);

    const gap = dims.neighborGaps.find(
      (g) => g.axis === "horizontal" && g.aId === "partition-1" && g.bId === "wo-1"
    );
    // Artwork right edge 1500, slab left edge 2950 -> 1450mm of open wall.
    expect(gap?.gapMm).toBe(1450);
  });

  it("excludes a partition standing further off the wall than the neighbor rule", () => {
    // Broadside at y=2000 with 100mm thickness -> nearest face 1950mm out,
    // past PARTITION_NEIGHBOR_MAX_GAP_MM. It still DRAWS as a ghost profile.
    const scene = buildElevationScene([artwork], {
      ...WALL_WITH_FLOOR,
      partitions: [
        partition({
          startMm: { xMm: 2000, yMm: 2000 },
          endMm: { xMm: 4000, yMm: 2000 }
        })
      ]
    });

    expect(scene.partitionProfiles).toHaveLength(1);
    const participants = elevationSceneToDimensionParticipants(scene);
    expect(participants.map((p) => p.id)).toEqual(["wo-1"]);
    expect(
      deriveElevationSceneDimensions(scene).neighborGaps.filter((g) =>
        [g.aId, g.bId].includes("partition-1")
      )
    ).toEqual([]);
  });

  it("gives partitions no boundary margins and no center-height datum", () => {
    const scene = buildElevationScene([artwork], {
      ...WALL_WITH_FLOOR,
      partitions: [partition()]
    });
    const dims = deriveElevationSceneDimensions(scene);

    // Architecture, not a work: it bounds the artwork's spacing but never
    // asks for its own wall margin or its own centerline.
    for (const boundary of dims.boundaryGaps) {
      expect(boundary.participantIds).not.toContain("partition-1");
    }
    for (const height of dims.centerHeights) {
      expect(height.participantIds).not.toContain("partition-1");
    }
    expect(dims.centerHeights.flatMap((h) => h.participantIds)).toEqual(["wo-1"]);
  });
});
