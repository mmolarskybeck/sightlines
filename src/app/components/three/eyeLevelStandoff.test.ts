import { describe, expect, it } from "vitest";
import type { WallArtwork3d } from "../../../domain/geometry/scene3d";
import type { Artwork } from "../../../domain/project";
import { resolveEyeLevelStandoffArtwork } from "./ThreeDView";

// Wall-local placement dims (widthMm/heightMm) are always image-sized
// (deriveScene3d does not import framing.ts) — the fixture's 400x300 mirrors
// the contract doc's framed fixture (mat 75, frame 25 -> outer 600x500).
const imageArtwork: WallArtwork3d = {
  objectId: "object-1",
  artworkId: "artwork-1",
  xMm: 1000,
  yMm: 1500,
  widthMm: 400,
  heightMm: 300
};

describe("resolveEyeLevelStandoffArtwork", () => {
  it("returns the artwork unchanged when there is no focus artwork", () => {
    expect(resolveEyeLevelStandoffArtwork(null, new Map())).toBeNull();
  });

  it("returns the artwork unchanged when the record is unframed", () => {
    const artworksById = new Map<string, Artwork>([
      [
        "artwork-1",
        {
          id: "artwork-1",
          schemaVersion: 1,
          dimensions: { widthMm: 400, heightMm: 300, status: "known" },
          metadata: {}
        }
      ]
    ]);

    expect(resolveEyeLevelStandoffArtwork(imageArtwork, artworksById)).toBe(imageArtwork);
  });

  it("returns the artwork unchanged when the record is missing (dangling artworkId)", () => {
    expect(resolveEyeLevelStandoffArtwork(imageArtwork, new Map())).toBe(imageArtwork);
  });

  it("widens widthMm/heightMm to the outer (framed) size, leaving center and ids alone", () => {
    const artworksById = new Map<string, Artwork>([
      [
        "artwork-1",
        {
          id: "artwork-1",
          schemaVersion: 1,
          dimensions: { widthMm: 400, heightMm: 300, status: "known" },
          matWidthMm: 75,
          frame: { widthMm: 25, finish: "black" },
          metadata: {}
        }
      ]
    ]);

    const resolved = resolveEyeLevelStandoffArtwork(imageArtwork, artworksById);

    expect(resolved).toEqual({
      ...imageArtwork,
      widthMm: 600,
      heightMm: 500
    });
  });
});
