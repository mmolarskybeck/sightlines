import { describe, expect, it } from "vitest";
import type { WallWithGeometry } from "../../domain/geometry/walls";
import type { PartitionNeighborShim } from "../../domain/placement/partitionNeighbors";
import type { Artwork, ArtworkWallObject } from "../../domain/project";
import { deriveArrangeReadout } from "./arrangeReadout";

const WALL: WallWithGeometry = {
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
    const readout = deriveArrangeReadout({
      arrangeWall: WALL,
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

  it("names a partition boundary instead of collapsing it to the wall edge", () => {
    // A slab abutting this wall at 0..500 closes the run's left end. Without the
    // shim path the readout would report the wall edge at 0 and measure 300 mm
    // too far — and the boundary lookup would silently miss.
    const left = member("left", "art-left", 800);
    const right = member("right", "art-right", 1400);
    const partition: PartitionNeighborShim = {
      id: "partition-1",
      wallId: "wall-north",
      xMm: 250,
      yMm: 1500,
      widthMm: 500,
      heightMm: 3000,
      partitionNeighbor: true,
      partitionName: "Partition 1"
    };

    const readout = deriveArrangeReadout({
      arrangeWall: WALL,
      arrangeMembers: [left, right],
      activeArrangeSession: null,
      selectedArtworkMembers: [left, right],
      wallObjects: [left, right],
      selectedObjectIds: [left.id, right.id],
      artworksById: new Map(),
      lastInsetAnchor: "both",
      lastArrangeMode: "inset",
      lastEvenZone: null,
      partitionNeighbors: [partition]
    });

    expect(readout).toMatchObject({
      leftBoundary: { type: "object", kind: "partition", name: "Partition 1" },
      rightBoundary: { type: "wall" },
      // left member's outer edge 600, slab's right edge 500.
      leftEdgeDistanceMm: 100,
      // The bay defaults the even zone to "open".
      evenZone: "open"
    });
  });
});
