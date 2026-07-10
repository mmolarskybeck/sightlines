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

describe("partition faces", () => {
  function withPartition(project: Project): Project {
    const placement = project.floor.rooms[0];
    return {
      ...project,
      floor: {
        rooms: [
          {
            ...placement,
            room: {
              ...placement.room,
              freestandingWalls: [
                {
                  id: "room-main-partition-1",
                  roomId: placement.room.id,
                  name: "Partition 1",
                  startXMm: feetToMm(5),
                  startYMm: feetToMm(5),
                  endXMm: feetToMm(15),
                  endYMm: feetToMm(5),
                  heightMm: feetToMm(12),
                  thicknessMm: 100
                }
              ]
            }
          }
        ]
      }
    };
  }

  it("validates bounds per face and never flags cross-face collision (back-to-back is fine)", () => {
    const base = withPartition(createSampleProject());
    const project: Project = {
      ...base,
      wallObjects: [
        {
          id: "art-a",
          kind: "artwork",
          artworkId: "art-a",
          wallId: "room-main-partition-1#a",
          xMm: feetToMm(5),
          yMm: inchesToMm(57),
          widthMm: feetToMm(2),
          heightMm: feetToMm(2)
        },
        {
          id: "art-b",
          kind: "artwork",
          artworkId: "art-b",
          wallId: "room-main-partition-1#b",
          xMm: feetToMm(5), // same x as art-a, opposite face
          yMm: inchesToMm(57),
          widthMm: feetToMm(2),
          heightMm: feetToMm(2)
        }
      ]
    };

    const warnings = validateWallObjectPlacements(project, ["art-a", "art-b"]);
    expect(warnings).toEqual([]);
  });

  it("flags a face placement that runs off the partition's length", () => {
    const base = withPartition(createSampleProject());
    const project: Project = {
      ...base,
      wallObjects: [
        {
          id: "art-off",
          kind: "artwork",
          artworkId: "art-off",
          wallId: "room-main-partition-1#a",
          xMm: feetToMm(20), // partition is only ~10 ft long
          yMm: inchesToMm(57),
          widthMm: feetToMm(2),
          heightMm: feetToMm(2)
        }
      ]
    };

    const warnings = validateWallObjectPlacements(project, ["art-off"]);
    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "art-off",
        wallId: "room-main-partition-1#a",
        message: "Placement extends beyond the wall's length."
      })
    ]);
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

  it("flags an artwork/opening collision as overridable (Allow-overlap can rescue it)", () => {
    const project = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(10), doorXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["placement-south-far"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "placement-south-far",
        type: "collision",
        overridable: true
      })
    ]);
  });

  it("flags a door overlapping a window as a FORBIDDEN (non-overridable) collision, both directions", () => {
    const project = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(2), doorXMm: feetToMm(10) });
    const window_: OpeningWallObject = {
      id: "window-1",
      kind: "window",
      blocksPlacement: true,
      wallId: "wall-south",
      xMm: feetToMm(10),
      yMm: inchesToMm(57),
      widthMm: feetToMm(4),
      heightMm: feetToMm(4)
    };
    const withOverlappingOpenings: Project = {
      ...project,
      wallObjects: [...project.wallObjects, window_]
    };

    const doorWarnings = validateWallObjectPlacements(withOverlappingOpenings, ["door-1"]);
    expect(doorWarnings).toEqual([
      expect.objectContaining({
        wallObjectId: "door-1",
        message: "Doors, windows and blocked zones can't overlap.",
        type: "collision",
        overridable: false
      })
    ]);

    const windowWarnings = validateWallObjectPlacements(withOverlappingOpenings, ["window-1"]);
    expect(windowWarnings).toEqual([
      expect.objectContaining({
        wallObjectId: "window-1",
        message: "Doors, windows and blocked zones can't overlap.",
        type: "collision",
        overridable: false
      })
    ]);
  });
});

describe("collision validation between artworks", () => {
  it("flags two overlapping artworks as an overridable collision — never an advisory 'overlap' warning", () => {
    const project = withSouthWallTwoArtworks({ firstXMm: feetToMm(10), secondXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["artwork-placement-1"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "artwork-placement-1",
        wallId: "wall-south",
        message: "Artworks overlap on this wall.",
        type: "collision",
        overridable: true
      })
    ]);
    // The retired "overlap" advisory is never emitted anymore.
    expect(warnings.some((warning) => warning.type === "overlap")).toBe(false);
  });

  it("symmetrically flags the other artwork when it is the one revalidated", () => {
    const project = withSouthWallTwoArtworks({ firstXMm: feetToMm(10), secondXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["artwork-placement-2"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "artwork-placement-2",
        wallId: "wall-south",
        message: "Artworks overlap on this wall.",
        type: "collision",
        overridable: true
      })
    ]);
  });

  it("does not flag two artworks that don't overlap", () => {
    const project = withSouthWallTwoArtworks({ firstXMm: feetToMm(2), secondXMm: feetToMm(20) });

    expect(validateWallObjectPlacements(project, ["artwork-placement-1"])).toEqual([]);
    expect(validateWallObjectPlacements(project, ["artwork-placement-2"])).toEqual([]);
  });

  it("still flags an artwork/obstacle pair as an overridable collision", () => {
    const project = withSouthWallArtworkAndDoor({ artworkXMm: feetToMm(10), doorXMm: feetToMm(10) });

    const warnings = validateWallObjectPlacements(project, ["placement-south-far"]);

    expect(warnings).toEqual([
      expect.objectContaining({
        wallObjectId: "placement-south-far",
        wallId: "wall-south",
        message: "Placement overlaps another object on this wall.",
        type: "collision",
        overridable: true
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
