import { describe, expect, it } from "vitest";
import type { Project } from "../project";
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
