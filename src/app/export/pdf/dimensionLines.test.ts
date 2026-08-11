import { describe, expect, it } from "vitest";
import type { ArtworkWallObject } from "../../../domain/project";
import type { FloorPartition } from "../../../domain/geometry/freestandingWalls";
import { buildElevationScene } from "../../../domain/scene2d/elevationScene";
import { deriveElevationSceneDimensions } from "../../../domain/dimensions/elevationDimensions";
import { participantObstacleBoxes } from "./dimensionLines";
import type { ElevationTransform } from "./transforms";

// Document-PDF elevation dims are drawElevationDimensions's job (createDocumentPdf.ts
// ~L601-607): it derives `deriveElevationSceneDimensions(scene)` for the gap list and
// `participantObstacleBoxes(scene, transform)` for label/leader obstacles, both fed the
// SAME scene the page paints from. This file pins that a qualifying partition profile
// (Stage A, elevationDimensions.ts) actually reaches both — the PDF-layer half of the
// wiring; the domain-layer mapping itself is covered by elevationDimensions.test.ts.

// Pass-through transform: model mm map 1:1 to page points (same convention as
// pdf/elevationPage.test.ts's identityTransform), so obstacle boxes can be checked
// directly against the scene's own mm fields.
function identityTransform(): ElevationTransform {
  return {
    scalePtPerMm: 1,
    point: ({ xMm, yMm }) => ({ x: xMm, y: yMm })
  };
}

const WALL = {
  wallId: "wall-north",
  wallLengthMm: 5000,
  wallHeightMm: 3000,
  centerlineMm: 1450,
  // The wall runs +x along y=0, so the viewer side (and any partition that may
  // project onto it) is at positive y - same handedness pin as
  // elevationScene.test.ts / elevationDimensions.test.ts.
  wallStartFloorMm: { xMm: 0, yMm: 0 },
  wallEndFloorMm: { xMm: 5000, yMm: 0 }
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

describe("document PDF elevation dims pick up nearby partition profiles", () => {
  it("derives a horizontal gap between the artwork and a qualifying partition", () => {
    const scene = buildElevationScene([artwork], { ...WALL, partitions: [partition()] });
    const dims = deriveElevationSceneDimensions(scene);

    const gap = dims.neighborGaps.find(
      (g) => g.axis === "horizontal" && [g.aId, g.bId].includes("partition-1")
    );
    expect(gap).toBeDefined();
    expect(gap?.gapMm).toBe(1450); // artwork right edge 1500, slab left edge 2950
  });

  it("gives the partition slab an obstacle box so labels/leaders avoid it", () => {
    const scene = buildElevationScene([artwork], { ...WALL, partitions: [partition()] });
    const transform = identityTransform();

    const boxes = participantObstacleBoxes(scene, transform);
    // Slab spans xMm 2950..3050, floor (yMm 0) to its clamped height.
    const slabBox = boxes.find((box) => box.left <= 2950 + 3 && box.right >= 3050 - 3);
    expect(slabBox).toBeDefined();
    expect(slabBox?.bottom).toBeCloseTo(-3); // padding=3 below floor
    expect(slabBox?.top).toBeCloseTo(2400 + 3);
  });

  it("excludes a partition standing further off the wall than the neighbor rule from both", () => {
    // Broadside at y=2000 with 100mm thickness -> nearest face 1950mm out,
    // past PARTITION_NEIGHBOR_MAX_GAP_MM (1200). It still DRAWS as a ghost
    // profile on the page, but must not bound dims or block labels.
    const scene = buildElevationScene([artwork], {
      ...WALL,
      partitions: [
        partition({
          startMm: { xMm: 2000, yMm: 2000 },
          endMm: { xMm: 4000, yMm: 2000 }
        })
      ]
    });
    expect(scene.partitionProfiles).toHaveLength(1);

    const dims = deriveElevationSceneDimensions(scene);
    expect(
      dims.neighborGaps.filter((g) => [g.aId, g.bId].includes("partition-1"))
    ).toEqual([]);

    const transform = identityTransform();
    const boxes = participantObstacleBoxes(scene, transform);
    // Only the artwork's own footprint should produce an obstacle box.
    expect(boxes).toHaveLength(1);
  });
});
