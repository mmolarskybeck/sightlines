import { describe, expect, it } from "vitest";
import { getArtworkRectSvg, isArtworkOutOfWallBounds } from "./elevationArtworkGeometry";

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
