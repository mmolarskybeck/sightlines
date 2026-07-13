import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  getElevationDropGhostSizeMm,
  getElevationFootprintObjects,
  getArtworkRectSvg,
  getFitSelectionBoundsSvg,
  isArtworkOutOfWallBounds
} from "./elevationArtworkGeometry";
import { ElevationArtwork } from "./ElevationArtwork";
import { getGroupBounds, getIdsIntersectingRect } from "../../domain/placement/groupBounds";
import type { Artwork, ArtworkWallObject } from "../../domain/project";

function framedSelectionFixture() {
  const artwork: Artwork = {
    id: "art-framed",
    schemaVersion: 1,
    dimensions: { widthMm: 400, heightMm: 300, status: "known" },
    matWidthMm: 75,
    frame: { widthMm: 25, finish: "black" },
    metadata: {}
  };
  const placement: ArtworkWallObject = {
    id: "placement-framed",
    kind: "artwork",
    artworkId: artwork.id,
    wallId: "wall-north",
    xMm: 1000,
    yMm: 1000,
    widthMm: 400,
    heightMm: 300
  };
  return { artwork, placement };
}

describe("getElevationDropGhostSizeMm", () => {
  it("matches the outer size rendered for the framed placement after drop", () => {
    const artwork = {
      dimensions: { widthMm: 400, heightMm: 300, status: "known" as const },
      matWidthMm: 75,
      frame: { widthMm: 25, finish: "black" as const }
    };
    const ghostSize = getElevationDropGhostSizeMm(artwork);
    const { container } = render(
      createElement(
        "svg",
        null,
        createElement(ElevationArtwork, {
          center: { xMm: 1000, yMm: 1000 },
          frame: artwork.frame,
          matWidthMm: artwork.matWidthMm,
          size: { widthMm: 400, heightMm: 300 },
          wallHeightMm: 3000
        })
      )
    );
    const renderedOutline = container.querySelector(".artwork-outline");

    expect(ghostSize).toEqual({ widthMm: 600, heightMm: 500 });
    expect(renderedOutline?.getAttribute("width")).toBe(String(ghostSize.widthMm));
    expect(renderedOutline?.getAttribute("height")).toBe(String(ghostSize.heightMm));
  });
});

describe("framed elevation selection geometry", () => {
  it("selects a marquee that intersects only the frame band", () => {
    const { artwork, placement } = framedSelectionFixture();
    const footprintObjects = getElevationFootprintObjects(
      [placement],
      new Map([[artwork.id, artwork]])
    );

    expect(
      getIdsIntersectingRect(footprintObjects, {
        minXMm: 720,
        maxXMm: 760,
        minYMm: 950,
        maxYMm: 1050
      })
    ).toEqual([placement.id]);
    expect(
      getIdsIntersectingRect([placement], {
        minXMm: 720,
        maxXMm: 760,
        minYMm: 950,
        maxYMm: 1050
      })
    ).toEqual([]);
  });

  it("gives a one-member group outline the same outer dimensions as the single outline", () => {
    const { artwork, placement } = framedSelectionFixture();
    const [footprint] = getElevationFootprintObjects(
      [placement],
      new Map([[artwork.id, artwork]])
    );
    const bounds = getGroupBounds([footprint]);
    const { container } = render(
      createElement(
        "svg",
        null,
        createElement(ElevationArtwork, {
          center: { xMm: placement.xMm, yMm: placement.yMm },
          frame: artwork.frame,
          matWidthMm: artwork.matWidthMm,
          size: { widthMm: placement.widthMm, heightMm: placement.heightMm },
          wallHeightMm: 3000
        })
      )
    );
    const singleOutline = container.querySelector(".artwork-outline");

    expect(bounds.widthMm).toBe(Number(singleOutline?.getAttribute("width")));
    expect(bounds.heightMm).toBe(Number(singleOutline?.getAttribute("height")));
    expect(bounds).toMatchObject({
      centerXMm: placement.xMm,
      centerYMm: placement.yMm,
      widthMm: 600,
      heightMm: 500
    });
  });

  it("fits the framed outer footprint rather than the stored image box", () => {
    const { artwork, placement } = framedSelectionFixture();
    const [footprint] = getElevationFootprintObjects(
      [placement],
      new Map([[artwork.id, artwork]])
    );

    const bounds = getFitSelectionBoundsSvg(3000, [
      {
        center: { xMm: footprint.xMm, yMm: footprint.yMm },
        size: { widthMm: footprint.widthMm, heightMm: footprint.heightMm }
      }
    ]);

    expect(bounds).toEqual({ xMm: 550, yMm: 1600, widthMm: 900, heightMm: 800 });
  });
});

describe("getArtworkRectSvg", () => {
  it("converts a center-anchored wall-local point to a top-left SVG rect", () => {
    // Wall 3000mm tall; artwork centered at (1000, 1500), 400x600.
    // Top edge is at wall-local y = 1500 + 300 = 1800, which flips to
    // svg y = 3000 - 1800 = 1200. Left edge is a plain offset: 1000 - 200 = 800.
    const rect = getArtworkRectSvg(3000, { xMm: 1000, yMm: 1500 }, { widthMm: 400, heightMm: 600 });

    expect(rect).toEqual({ xMm: 800, yMm: 1200, widthMm: 400, heightMm: 600 });
  });

  it("places a floor-level, centerline-height artwork consistently with wallLocalYToSvgY", () => {
    const rect = getArtworkRectSvg(2400, { xMm: 0, yMm: 0 }, { widthMm: 200, heightMm: 200 });

    // Top edge at wall-local y = 100 -> svg y = 2400 - 100 = 2300.
    expect(rect.yMm).toBe(2300);
    expect(rect.xMm).toBe(-100);
  });
});

describe("isArtworkOutOfWallBounds", () => {
  const wallLengthMm = 4000;
  const wallHeightMm = 3000;

  it("is false for a placement fully within the wall", () => {
    expect(
      isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, { xMm: 2000, yMm: 1500 }, {
        widthMm: 400,
        heightMm: 600
      })
    ).toBe(false);
  });

  it("is true when the left edge extends past the wall start", () => {
    expect(
      isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, { xMm: 100, yMm: 1500 }, {
        widthMm: 400,
        heightMm: 600
      })
    ).toBe(true);
  });

  it("is true when the right edge extends past the wall end", () => {
    expect(
      isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, { xMm: 3900, yMm: 1500 }, {
        widthMm: 400,
        heightMm: 600
      })
    ).toBe(true);
  });

  it("is true when the bottom edge extends below the floor", () => {
    expect(
      isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, { xMm: 2000, yMm: 100 }, {
        widthMm: 400,
        heightMm: 600
      })
    ).toBe(true);
  });

  it("is true when the top edge extends past the wall's height", () => {
    expect(
      isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, { xMm: 2000, yMm: 2900 }, {
        widthMm: 400,
        heightMm: 600
      })
    ).toBe(true);
  });
});

describe("getFitSelectionBoundsSvg", () => {
  const wallHeightMm = 3000;

  it("returns null for an empty selection", () => {
    expect(getFitSelectionBoundsSvg(wallHeightMm, [])).toBeNull();
  });

  it("pads a single artwork's rect, with the 150mm floor kicking in for a small work", () => {
    // A tiny 100x100 work: 20% of its largest dimension is only 20mm, well
    // under the 150mm floor, so the floor must win.
    const size = { widthMm: 100, heightMm: 100 };
    const center = { xMm: 1000, yMm: 1500 };
    const rect = getArtworkRectSvg(wallHeightMm, center, size);

    const bounds = getFitSelectionBoundsSvg(wallHeightMm, [{ center, size }]);

    expect(bounds).toEqual({
      xMm: rect.xMm - 150,
      yMm: rect.yMm - 150,
      widthMm: rect.widthMm + 300,
      heightMm: rect.heightMm + 300
    });
  });

  it("pads proportionally (20% of the larger union dimension) once that exceeds the 150mm floor", () => {
    // A single 2000x1000 work: 20% of the larger dimension (2000) is 400mm,
    // which beats the 150mm floor.
    const size = { widthMm: 2000, heightMm: 1000 };
    const center = { xMm: 2000, yMm: 1500 };
    const rect = getArtworkRectSvg(wallHeightMm, center, size);
    const padMm = 400;

    const bounds = getFitSelectionBoundsSvg(wallHeightMm, [{ center, size }]);

    expect(bounds).toEqual({
      xMm: rect.xMm - padMm,
      yMm: rect.yMm - padMm,
      widthMm: rect.widthMm + padMm * 2,
      heightMm: rect.heightMm + padMm * 2
    });
  });

  it("unions two artworks' rects before padding", () => {
    // Wall 3000mm tall. Artwork A: 400x400 centered at (500, 500) -> svg rect
    // x[300,700], y[2100,2500] (top wall-local y=700 -> svg y=3000-700=2300;
    // wait recomputed below via getArtworkRectSvg to stay honest).
    const a = { center: { xMm: 500, yMm: 500 }, size: { widthMm: 400, heightMm: 400 } };
    const b = { center: { xMm: 3000, yMm: 2000 }, size: { widthMm: 400, heightMm: 400 } };
    const rectA = getArtworkRectSvg(wallHeightMm, a.center, a.size);
    const rectB = getArtworkRectSvg(wallHeightMm, b.center, b.size);

    const minXMm = Math.min(rectA.xMm, rectB.xMm);
    const minYMm = Math.min(rectA.yMm, rectB.yMm);
    const maxXMm = Math.max(rectA.xMm + rectA.widthMm, rectB.xMm + rectB.widthMm);
    const maxYMm = Math.max(rectA.yMm + rectA.heightMm, rectB.yMm + rectB.heightMm);
    const unionWidthMm = maxXMm - minXMm;
    const unionHeightMm = maxYMm - minYMm;
    const padMm = Math.max(Math.max(unionWidthMm, unionHeightMm) * 0.2, 150);

    const bounds = getFitSelectionBoundsSvg(wallHeightMm, [a, b]);

    expect(bounds).toEqual({
      xMm: minXMm - padMm,
      yMm: minYMm - padMm,
      widthMm: unionWidthMm + padMm * 2,
      heightMm: unionHeightMm + padMm * 2
    });
  });

  it("is y-flip correct: a work near the wall top yields a small (near-zero) svg y before padding", () => {
    // Wall 2400mm tall, work 200x200 centered at wall-local (1000, 2300) — its
    // top edge sits at wall-local y = 2400 (the very top of the wall), which
    // must flip to svg y = 0 before the 150mm pad is subtracted.
    const center = { xMm: 1000, yMm: 2300 };
    const size = { widthMm: 200, heightMm: 200 };
    const rect = getArtworkRectSvg(2400, center, size);
    expect(rect.yMm).toBe(0);

    const bounds = getFitSelectionBoundsSvg(2400, [{ center, size }]);

    expect(bounds?.yMm).toBe(-150);
  });
});
