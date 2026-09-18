import { describe, expect, it } from "vitest";
import { buildElevationDimensionModel } from "./elevationDimensionModel";
import type { ArtworkWallObject, WallObject, WallObjectBase } from "../../../domain/project";

const WALL_ID = "wall-north";
const WALL_LENGTH_MM = 6000;

function placement(
  id: string,
  xMm: number,
  yMm: number,
  widthMm = 400,
  heightMm = 300
): ArtworkWallObject {
  return {
    id,
    kind: "artwork",
    artworkId: `art-${id}`,
    wallId: WALL_ID,
    xMm,
    yMm,
    widthMm,
    heightMm
  };
}

function inputFor(
  wallObjects: WallObject[],
  selectedObjectIds: string[]
): Parameters<typeof buildElevationDimensionModel>[0] {
  const selectedMembersOnThisWall = wallObjects.filter((object) =>
    selectedObjectIds.includes(object.id)
  );
  return {
    selectedObjectIds,
    selectedMembersOnThisWall,
    selectionAllOnThisWall: selectedMembersOnThisWall.length === selectedObjectIds.length,
    applyDragPreview: (wallObject: WallObjectBase) => wallObject,
    artworksById: undefined,
    wallObjectsOnThisWall: wallObjects,
    visibleFloorCaseGhosts: [],
    visibleSuspendedArtworkGhosts: [],
    visibleMonitorGhosts: [],
    visibleSupportedArtworkGhosts: [],
    partitionNeighborShims: [],
    wallId: WALL_ID,
    wallLengthMm: WALL_LENGTH_MM,
    arrangeSessionMode: null
  };
}

describe("buildElevationDimensionModel", () => {
  it("is ineligible and draws nothing when nothing is selected", () => {
    const wallObjects = [placement("a", 1000, 1500), placement("b", 3000, 1500)];

    const model = buildElevationDimensionModel(inputFor(wallObjects, []));

    expect(model.isDimensionLinesEligible).toBe(false);
    expect(model.effectiveDimensionMembers).toHaveLength(0);
    expect(model.verticalGapDimensions).toEqual([]);
  });

  it("bounds a selected work's horizontal segments at its neighbours on the wall", () => {
    const wallObjects = [
      placement("left", 1000, 1500),
      placement("middle", 3000, 1500),
      placement("right", 5000, 1500)
    ];

    const model = buildElevationDimensionModel(inputFor(wallObjects, ["middle"]));

    expect(model.isDimensionLinesEligible).toBe(true);
    expect(model.effectiveDimensionMembers).toHaveLength(1);
    // One segment on each side, each closing on the neighbouring work rather
    // than sailing to the wall edge: 3000-200 - (1000+200) = 1600 mm.
    expect(model.dimensionSegments).toHaveLength(2);
    for (const segment of model.dimensionSegments) {
      expect(segment.toMm - segment.fromMm).toBeCloseTo(1600, 6);
    }
  });

  it("derives a vertical gap for a stacked pair", () => {
    const wallObjects = [placement("lower", 2000, 1000), placement("upper", 2000, 2000)];

    const model = buildElevationDimensionModel(inputFor(wallObjects, ["lower"]));

    expect(model.isDimensionLinesEligible).toBe(true);
    expect(model.verticalGapDimensions.length).toBeGreaterThanOrEqual(1);
    const gap = model.verticalGapDimensions[0];
    expect([gap.aId, gap.bId]).toContain("lower");
    // Centres 1000 mm apart, 300 mm tall each → a 700 mm clear gap.
    expect(gap.gapMm).toBeCloseTo(700, 6);
  });
});
