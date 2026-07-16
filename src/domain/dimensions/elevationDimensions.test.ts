import { describe, expect, it } from "vitest";
import type {
  Artwork,
  ArtworkWallObject,
  ConnectableOpeningWallObject,
  WallObject
} from "../project";
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
