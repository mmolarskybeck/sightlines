import { describe, expect, it } from "vitest";
import type { WallWithGeometry } from "../../domain/geometry/walls";
import type { Artwork, ArtworkWallObject } from "../../domain/project";
import { deriveArrangeReadout } from "./arrangeReadout";

function member(
  id: string,
  artworkId: string,
  xMm: number
): ArtworkWallObject {
  return {
    id,
    kind: "artwork",
    artworkId,
    wallId: "wall-north",
    xMm,
    yMm: 1000,
    widthMm: 400,
    heightMm: 300
  };
}

describe("deriveArrangeReadout", () => {
  it("reports gaps and edge distances from mixed framed outer footprints", () => {
    const framed = member("framed", "art-framed", 500);
    const unframed = member("unframed", "art-unframed", 1300);
    const framedArtwork: Artwork = {
      id: "art-framed",
      schemaVersion: 1,
      dimensions: { widthMm: 400, heightMm: 300, status: "known" },
      matWidthMm: 75,
      frame: { widthMm: 25, finish: "black" },
      metadata: {}
    };
    const wall: WallWithGeometry = {
      id: "wall-north",
      roomId: "room-1",
      name: "North wall",
      startVertexId: "v1",
      endVertexId: "v2",
      heightMm: 3000,
      start: { id: "v1", xMm: 0, yMm: 0 },
      end: { id: "v2", xMm: 2000, yMm: 0 },
      lengthMm: 2000,
      angleRad: 0
    };

    const readout = deriveArrangeReadout({
      arrangeWall: wall,
      arrangeMembers: [framed, unframed],
      activeArrangeSession: null,
      selectedArtworkMembers: [framed, unframed],
      wallObjects: [framed, unframed],
      selectedObjectIds: [framed.id, unframed.id],
      artworksById: new Map([[framedArtwork.id, framedArtwork]]),
      lastInsetAnchor: "both",
      lastArrangeMode: "gap",
      lastEvenZone: "wall"
    });

    expect(readout).toMatchObject({
      gapMm: 300,
      leftEdgeDistanceMm: 200,
      rightEdgeDistanceMm: 500
    });
  });
});
