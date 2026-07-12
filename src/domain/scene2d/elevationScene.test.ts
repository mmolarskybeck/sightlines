import { describe, expect, it } from "vitest";
import type {
  Artwork,
  ArtworkWallObject,
  ConnectableOpeningWallObject,
  WallObject
} from "../project";
import { buildElevationScene, wallLocalYToSvgY } from "./elevationScene";

// wallLocalYToSvgY / getArtworkRectSvg / isArtworkOutOfWallBounds moved here
// from app/components/elevationArtworkGeometry.ts, which still owns their
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

  it("joins the artwork record when it resolves and leaves it undefined when dangling", () => {
    const artwork = artworkRecord();
    const scene = buildElevationScene(
      [placement(), placement({ id: "wo-dangling", artworkId: "art-gone" })],
      { ...WALL, artworksById: new Map([[artwork.id, artwork]]) }
    );

    expect(scene.artworks[0]!.artwork).toBe(artwork);
    expect(scene.artworks[1]!.artwork).toBeUndefined();
  });
});
