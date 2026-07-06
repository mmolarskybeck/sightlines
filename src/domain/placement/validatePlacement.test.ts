import { describe, expect, it } from "vitest";
import type { OpeningWallObject, Project } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm, inchesToMm } from "../units/length";
import { resizeWallPreservingAngles } from "../geometry/editRoom";
import { validateChangedWallPlacements, validateWallObjectPlacements } from "./validatePlacement";

describe("validateChangedWallPlacements", () => {
  it("flags objects that become out of bounds on a cascaded wall", () => {
    const project = withSouthWallArtwork(createSampleProject());
    const result = resizeWallPreservingAngles(project, "wall-north", feetToMm(20));
    const warnings = validateChangedWallPlacements(
      result.project,
      result.changedWallIds
    );

    expect(result.changedWallIds).toContain("wall-south");
    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "placement-south-far",
        wallId: "wall-south",
        message: "Placement extends beyond the wall's length."
      })
    ]);
  });

  it("ignores unchanged walls", () => {
    const project = withSouthWallArtwork(createSampleProject());
    const warnings = validateChangedWallPlacements(project, ["wall-north"]);

    expect(warnings).toEqual([]);
  });
});

describe("validateWallObjectPlacements", () => {
  it("flags a specific wall object that is out of its wall's bounds", () => {
    const project = withSouthWallArtwork(createSampleProject());
    const result = resizeWallPreservingAngles(project, "wall-north", feetToMm(20));

    const warnings = validateWallObjectPlacements(result.project, ["placement-south-far"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "placement-south-far",
        wallId: "wall-south",
        message: "Placement extends beyond the wall's length."
      })
    ]);
  });

  it("flags a placement referencing a wall that no longer exists", () => {
    const project = withSouthWallArtwork(createSampleProject());
    const withMissingWall: Project = {
      ...project,
      wallObjects: project.wallObjects.map((wallObject) => ({
        ...wallObject,
        wallId: "wall-gone"
      }))
    };

    const warnings = validateWallObjectPlacements(withMissingWall, ["placement-south-far"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "placement-south-far",
        wallId: "wall-gone",
        message: "Placement references a wall that no longer exists."
      })
    ]);
  });

  it("ignores wall objects not named in the id list", () => {
    const project = withSouthWallArtwork(createSampleProject());

    const warnings = validateWallObjectPlacements(project, ["some-other-id"]);

    expect(warnings).toEqual([]);
  });
});

describe("collision validation against openings", () => {
  it("flags an artwork that overlaps a door on the same wall", () => {
    const project = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(10), doorXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["placement-south-far"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "placement-south-far",
        wallId: "wall-south",
        message: "Placement overlaps another object on this wall."
      })
    ]);
  });

  it("symmetrically flags a door that overlaps an artwork when the door itself is revalidated", () => {
    const project = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(10), doorXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["door-1"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "door-1",
        wallId: "wall-south",
        message: "Placement overlaps another object on this wall."
      })
    ]);
  });

  it("does not flag an artwork and a door that don't overlap", () => {
    const project = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(2), doorXMm: feetToMm(20) });

    expect(validateWallObjectPlacements(project, ["placement-south-far"])).toEqual([]);
    expect(validateWallObjectPlacements(project, ["door-1"])).toEqual([]);
  });

  it("clears once the overlapping object moves away", () => {
    const overlapping = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(10), doorXMm: feetToMm(10) });
    expect(validateWallObjectPlacements(overlapping, ["door-1"])).not.toEqual([]);

    const movedAway: Project = {
      ...overlapping,
      wallObjects: overlapping.wallObjects.map((wallObject) =>
        wallObject.id === "door-1" ? { ...wallObject, xMm: feetToMm(25) } : wallObject
      )
    };

    expect(validateWallObjectPlacements(movedAway, ["door-1"])).toEqual([]);
  });

  it("does not flag two openings overlapping each other — out of scope for this slice", () => {
    const project = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(2), doorXMm: feetToMm(10) });
    const blockedZone: OpeningWallObject = {
      id: "zone-1",
      kind: "blocked-zone",
      blocksPlacement: true,
      wallId: "wall-south",
      xMm: feetToMm(10),
      yMm: inchesToMm(57),
      widthMm: feetToMm(1),
      heightMm: feetToMm(1)
    };
    const withOverlappingOpenings: Project = {
      ...project,
      wallObjects: [...project.wallObjects, blockedZone]
    };

    expect(validateWallObjectPlacements(withOverlappingOpenings, ["door-1", "zone-1"])).toEqual([]);
  });
});

describe("overlap validation between artworks", () => {
  it("flags two overlapping artworks on the same wall as non-blocking overlaps", () => {
    const project = withSouthWallTwoArtworks({ firstXMm: feetToMm(10), secondXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["artwork-placement-1"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "artwork-placement-1",
        wallId: "wall-south",
        message: "Artworks overlap on this wall.",
        type: "overlap"
      })
    ]);
  });

  it("symmetrically flags the other artwork when it is the one revalidated", () => {
    const project = withSouthWallTwoArtworks({ firstXMm: feetToMm(10), secondXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["artwork-placement-2"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "artwork-placement-2",
        wallId: "wall-south",
        message: "Artworks overlap on this wall.",
        type: "overlap"
      })
    ]);
  });

  it("does not flag two artworks that don't overlap", () => {
    const project = withSouthWallTwoArtworks({ firstXMm: feetToMm(2), secondXMm: feetToMm(20) });

    expect(validateWallObjectPlacements(project, ["artwork-placement-1"])).toEqual([]);
    expect(validateWallObjectPlacements(project, ["artwork-placement-2"])).toEqual([]);
  });

  it("still flags an artwork/obstacle pair as a blocking collision, unaffected by overlap detection", () => {
    const project = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(10), doorXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["placement-south-far"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "placement-south-far",
        wallId: "wall-south",
        message: "Placement overlaps another object on this wall.",
        type: "collision"
      })
    ]);
  });
});

function withSouthWallTwoArtworks({
  firstXMm,
  secondXMm
}: {
  firstXMm: number;
  secondXMm: number;
}): Project {
  const project = createSampleProject();

  return {
    ...project,
    wallObjects: [
      {
        id: "artwork-placement-1",
        kind: "artwork",
        artworkId: "artwork-1",
        wallId: "wall-south",
        xMm: firstXMm,
        yMm: inchesToMm(57),
        widthMm: feetToMm(2),
        heightMm: feetToMm(3)
      },
      {
        id: "artwork-placement-2",
        kind: "artwork",
        artworkId: "artwork-1",
        wallId: "wall-south",
        xMm: secondXMm,
        yMm: inchesToMm(57),
        widthMm: feetToMm(2),
        heightMm: feetToMm(3)
      }
    ]
  };
}

function withSouthWallArtworkAndDoor({
  artworkXMm,
  doorXMm
}: {
  artworkXMm: number;
  doorXMm: number;
}): Project {
  const project = createSampleProject();
  const door: OpeningWallObject = {
    id: "door-1",
    kind: "door",
    blocksPlacement: true,
    wallId: "wall-south",
    xMm: doorXMm,
    yMm: inchesToMm(40),
    widthMm: feetToMm(3),
    heightMm: inchesToMm(80)
  };

  return {
    ...project,
    wallObjects: [
      {
        id: "placement-south-far",
        kind: "artwork",
        artworkId: "artwork-1",
        wallId: "wall-south",
        xMm: artworkXMm,
        yMm: inchesToMm(57),
        widthMm: feetToMm(2),
        heightMm: feetToMm(3)
      },
      door
    ]
  };
}

function withSouthWallArtwork(project: Project): Project {
  return {
    ...project,
    wallObjects: [
      {
        id: "placement-south-far",
        kind: "artwork",
        artworkId: "artwork-1",
        wallId: "wall-south",
        xMm: feetToMm(27),
        yMm: inchesToMm(57),
        widthMm: feetToMm(2),
        heightMm: feetToMm(3)
      }
    ]
  };
}
