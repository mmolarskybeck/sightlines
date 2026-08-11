import { describe, expect, it } from "vitest";

import { withArtworkFootprint } from "../../../domain/framing";
import type { PartitionNeighborShim } from "../../../domain/placement/partitionNeighbors";
import type {
  ArtworkWallObject,
  OpeningWallObject,
  WallObjectBase
} from "../../../domain/project";
import {
  getWallPlacementCenterTarget,
  getWallPlacementEdges,
  getWallPlacementNeighborEdges
} from "./WallPlacementFields";

const self: ArtworkWallObject = {
  id: "self",
  kind: "artwork",
  artworkId: "art-self",
  wallId: "wall-1",
  xMm: 1000,
  yMm: 1200,
  widthMm: 400,
  heightMm: 500
};

describe("wall placement framed footprint readouts", () => {
  it("measures wall-edge distances from the outer framed edges", () => {
    const footprint = withArtworkFootprint(self, {
      matWidthMm: 50,
      frame: { widthMm: 25, finish: "black" }
    });

    expect(getWallPlacementEdges(footprint)).toEqual({
      halfWidthMm: 275,
      leftEdgeMm: 725,
      rightEdgeMm: 1275
    });
  });

  it("measures neighbor gaps and centering from adapted outer footprints", () => {
    const footprint = withArtworkFootprint(self, {
      matWidthMm: 50,
      frame: { widthMm: 25, finish: "black" }
    });
    const left = withArtworkFootprint(
      {
        ...self,
        id: "left",
        artworkId: "art-left",
        xMm: 400,
        widthMm: 300
      },
      { matWidthMm: 25 }
    );
    const rightOpening: OpeningWallObject = {
      id: "right-opening",
      kind: "window",
      blocksPlacement: true,
      wallId: self.wallId,
      xMm: 1800,
      yMm: self.yMm,
      widthMm: 200,
      heightMm: 500
    };

    expect(getWallPlacementNeighborEdges(footprint, [left, footprint])).toEqual({
      leftNeighborRightEdgeMm: 575,
      rightNeighborLeftEdgeMm: undefined,
      leftNeighborIsPartition: false,
      rightNeighborIsPartition: false
    });
    expect(
      getWallPlacementCenterTarget(footprint, [left, footprint, rightOpening], 2400)
    ).toEqual({
      xMm: 1137.5,
      boundaryKind: "open"
    });
  });
});

// A partition standing at the wall bounds the run. The shim is a bare
// WallObjectBase to the geometry, but it must survive as a PARTITION through the
// button label, and through the neighbor-distance fields.
describe("partition neighbours in the wall placement inspector", () => {
  // Slab occupying 400..600 on a 2400 wall: a bay from 600 to the wall end.
  const partitionShim: PartitionNeighborShim = {
    id: "partition-1",
    wallId: "wall-1",
    xMm: 500,
    yMm: 1200,
    widthMm: 200,
    heightMm: 2400,
    partitionNeighbor: true,
    partitionName: "Partition 1"
  };

  it("centers in the bay and says so", () => {
    const result = getWallPlacementCenterTarget(self, [self], 2400, [partitionShim]);

    // Midway between the slab's right edge (600) and the wall end (2400).
    expect(result).toEqual({ xMm: 1500, boundaryKind: "bay" });
  });

  it("prefers the bay label over the open-space label when both apply", () => {
    // A window on the far side would normally read as "open space"; a partition
    // on the near side outranks it — the bay is the more specific fact.
    const window: OpeningWallObject = {
      id: "right-opening",
      kind: "window",
      blocksPlacement: true,
      wallId: "wall-1",
      xMm: 1800,
      yMm: self.yMm,
      widthMm: 200,
      heightMm: 500
    };

    expect(
      getWallPlacementCenterTarget(self, [self, window], 2400, [partitionShim]).boundaryKind
    ).toBe("bay");
  });

  it("leaves the label alone on the same wall with no partition", () => {
    // The bay label must come from the shims, never from the default path —
    // the button on an empty wall still reads "Center on wall".
    expect(getWallPlacementCenterTarget(self, [self], 2400).boundaryKind).toBe("wall");
  });

  it("measures the neighbour distance to the partition edge and relabels the field", () => {
    const edges = getWallPlacementNeighborEdges(self, [self], [partitionShim]);

    expect(edges.leftNeighborRightEdgeMm).toBe(600);
    expect(edges.leftNeighborIsPartition).toBe(true);
    expect(edges.rightNeighborLeftEdgeMm).toBeUndefined();
    expect(edges.rightNeighborIsPartition).toBe(false);
  });

  it("answers the same question for a synthetic group footprint", () => {
    // The multi-selection panel centres a GROUP, which reaches this rule as a
    // union footprint (min left edge .. max right edge) rather than a real
    // placement. Nothing here may depend on it being a stored wall object.
    const groupFootprint: WallObjectBase = {
      id: "group",
      wallId: "wall-1",
      xMm: 1200,
      yMm: 1200,
      widthMm: 1000,
      heightMm: 500
    };

    // Bay 600..2400: the group's centre target is 1500, a 300 mm slide right.
    expect(getWallPlacementCenterTarget(groupFootprint, [], 2400, [partitionShim])).toEqual({
      xMm: 1500,
      boundaryKind: "bay"
    });
  });

  it("lets a nearer artwork beat the partition for the neighbour field", () => {
    const nearer: ArtworkWallObject = {
      ...self,
      id: "nearer",
      artworkId: "art-nearer",
      xMm: 800,
      widthMm: 200
    };

    const edges = getWallPlacementNeighborEdges(self, [self, nearer], [partitionShim]);

    expect(edges.leftNeighborRightEdgeMm).toBe(900);
    expect(edges.leftNeighborIsPartition).toBe(false);
  });
});
