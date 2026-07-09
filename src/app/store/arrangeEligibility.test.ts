import { describe, expect, it } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import type {
  ArtworkWallObject,
  BlockedZoneFloorObject,
  OpeningWallObject,
  Project
} from "../../domain/project";
import { getArrangeEligibility } from "./arrangeEligibility";

// The stock sample project ships with EMPTY wallObjects/floorObjects, so each
// test builds its own fixture project with the placements it needs.
function artwork(id: string, wallId: string, xMm: number): ArtworkWallObject {
  return {
    id,
    wallId,
    kind: "artwork",
    artworkId: `lib-${id}`,
    xMm,
    yMm: 1450,
    widthMm: 500,
    heightMm: 400
  };
}

function door(id: string, wallId: string): OpeningWallObject {
  return {
    id,
    wallId,
    kind: "door",
    blocksPlacement: true,
    xMm: 2000,
    yMm: 1000,
    widthMm: 900,
    heightMm: 2000
  };
}

function blockedZoneFloorObject(id: string): BlockedZoneFloorObject {
  return {
    id,
    kind: "blocked-zone",
    xMm: 0,
    yMm: 0,
    widthMm: 500,
    depthMm: 500,
    rotationDeg: 0,
    heightMm: 0,
    wallYMm: 0
  };
}

function projectWith(overrides: Partial<Project>): Project {
  return { ...createSampleProject(), ...overrides };
}

describe("getArrangeEligibility", () => {
  it("is eligible for 2+ artworks on the same wall, and reports the members and wallId", () => {
    const a1 = artwork("wo-1", "wall-north", 1000);
    const a2 = artwork("wo-2", "wall-north", 2000);
    const project = projectWith({ wallObjects: [a1, a2] });

    const result = getArrangeEligibility(project, ["wo-1", "wo-2"]);

    expect(result).toEqual({
      eligible: true,
      members: [a1, a2],
      wallId: "wall-north"
    });
  });

  it("is eligible for 3 artworks on the same wall even with an opening also selected", () => {
    const a1 = artwork("wo-1", "wall-north", 1000);
    const a2 = artwork("wo-2", "wall-north", 2000);
    const a3 = artwork("wo-3", "wall-north", 3000);
    const d1 = door("wo-door", "wall-north");
    const project = projectWith({ wallObjects: [a1, a2, a3, d1] });

    const result = getArrangeEligibility(project, ["wo-1", "wo-2", "wo-3", "wo-door"]);

    expect(result).toEqual({
      eligible: true,
      members: [a1, a2, a3],
      wallId: "wall-north"
    });
  });

  it("reports floorMember when the selection includes a floor-placed object, even with 2+ eligible artworks", () => {
    const a1 = artwork("wo-1", "wall-north", 1000);
    const a2 = artwork("wo-2", "wall-north", 2000);
    const blockedZone = blockedZoneFloorObject("floor-1");
    const project = projectWith({
      wallObjects: [a1, a2],
      floorObjects: [blockedZone]
    });

    const result = getArrangeEligibility(project, ["wo-1", "wo-2", "floor-1"]);

    expect(result).toEqual({ eligible: false, reason: "floorMember" });
  });

  it("reports noArtworks when the selection has zero artwork wall-objects", () => {
    const d1 = door("wo-door", "wall-north");
    const project = projectWith({ wallObjects: [d1] });

    const result = getArrangeEligibility(project, ["wo-door"]);

    expect(result).toEqual({ eligible: false, reason: "noArtworks" });
  });

  it("reports noArtworks when nothing is selected", () => {
    const project = projectWith({ wallObjects: [] });

    const result = getArrangeEligibility(project, []);

    expect(result).toEqual({ eligible: false, reason: "noArtworks" });
  });

  it("reports singleArtwork when only one artwork is selected", () => {
    const a1 = artwork("wo-1", "wall-north", 1000);
    const d1 = door("wo-door", "wall-north");
    const project = projectWith({ wallObjects: [a1, d1] });

    const result = getArrangeEligibility(project, ["wo-1", "wo-door"]);

    expect(result).toEqual({ eligible: false, reason: "singleArtwork" });
  });

  it("reports multipleWalls when the 2+ artworks span more than one wall", () => {
    const a1 = artwork("wo-1", "wall-north", 1000);
    const a2 = artwork("wo-2", "wall-south", 2000);
    const project = projectWith({ wallObjects: [a1, a2] });

    const result = getArrangeEligibility(project, ["wo-1", "wo-2"]);

    expect(result).toEqual({ eligible: false, reason: "multipleWalls" });
  });

  it("floorMember takes priority over other reasons", () => {
    const blockedZone = blockedZoneFloorObject("floor-1");
    const project = projectWith({ wallObjects: [], floorObjects: [blockedZone] });

    const result = getArrangeEligibility(project, ["floor-1"]);

    expect(result).toEqual({ eligible: false, reason: "floorMember" });
  });
});
