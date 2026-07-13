import { describe, expect, it } from "vitest";

import { withArtworkFootprint } from "../../domain/framing";
import type { ArtworkWallObject, OpeningWallObject } from "../../domain/project";
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
      rightNeighborLeftEdgeMm: undefined
    });
    expect(
      getWallPlacementCenterTarget(footprint, [left, footprint, rightOpening], 2400)
    ).toEqual({
      xMm: 1137.5,
      boundaryKind: "open"
    });
  });
});
