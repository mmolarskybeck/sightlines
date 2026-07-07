import { describe, expect, it } from "vitest";
import {
  FIT_VIEWPORT,
  PLAN_ZOOM_LIMITS,
  clampZoom,
  getEffectiveZoom,
  getFitBoundsViewport,
  getViewBox2D,
  panBy,
  pinchZoomPan,
  zoomAtPoint
} from "./viewport2d";
import type { Size, Viewport2D, ViewBox, ZoomLimits } from "./viewport2d";

// mm-scale quantities (viewBox x/y/width/height, centers) can carry a little
// float slop from division; px/mm ratios are small and stay tighter.
const MM_PRECISION = 3;
const PPM_PRECISION = 6;

const wideContent: ViewBox = { x: 0, y: 0, width: 4000, height: 2000 }; // 2:1
const tallContent: ViewBox = { x: 0, y: 0, width: 2000, height: 4000 }; // 1:2
const squareContent: ViewBox = { x: 0, y: 0, width: 2000, height: 2000 }; // 1:1

const wideContainer: Size = { width: 800, height: 400 }; // 2:1
const tallContainer: Size = { width: 400, height: 800 }; // 1:2
const squareContainer: Size = { width: 600, height: 600 }; // 1:1

const contentCases: readonly [string, ViewBox][] = [
  ["wide content", wideContent],
  ["tall content", tallContent],
  ["square content", squareContent]
];

const containerCases: readonly [string, Size][] = [
  ["wide container", wideContainer],
  ["tall container", tallContainer],
  ["square container", squareContainer]
];

describe("getViewBox2D", () => {
  describe("fit mode is aspect-matched to the container", () => {
    for (const [contentLabel, contentBounds] of contentCases) {
      for (const [containerLabel, containerPx] of containerCases) {
        it(`${contentLabel} in a ${containerLabel}`, () => {
          const { viewBox } = getViewBox2D(FIT_VIEWPORT, contentBounds, containerPx);

          expect(viewBox.width / viewBox.height).toBeCloseTo(
            containerPx.width / containerPx.height,
            MM_PRECISION
          );

          // Content is fully contained in the viewBox.
          expect(viewBox.x).toBeLessThanOrEqual(contentBounds.x + 1e-9);
          expect(viewBox.y).toBeLessThanOrEqual(contentBounds.y + 1e-9);
          expect(viewBox.x + viewBox.width).toBeGreaterThanOrEqual(
            contentBounds.x + contentBounds.width - 1e-9
          );
          expect(viewBox.y + viewBox.height).toBeGreaterThanOrEqual(
            contentBounds.y + contentBounds.height - 1e-9
          );

          // Content center equals viewBox center.
          expect(viewBox.x + viewBox.width / 2).toBeCloseTo(
            contentBounds.x + contentBounds.width / 2,
            MM_PRECISION
          );
          expect(viewBox.y + viewBox.height / 2).toBeCloseTo(
            contentBounds.y + contentBounds.height / 2,
            MM_PRECISION
          );
        });
      }
    }
  });

  describe("pixelsPerMm is exact", () => {
    for (const [contentLabel, contentBounds] of contentCases) {
      for (const [containerLabel, containerPx] of containerCases) {
        it(`${contentLabel} in a ${containerLabel}`, () => {
          const { viewBox, pixelsPerMm } = getViewBox2D(FIT_VIEWPORT, contentBounds, containerPx);

          expect(pixelsPerMm).toBeCloseTo(containerPx.width / viewBox.width, PPM_PRECISION);
          expect(pixelsPerMm).toBeCloseTo(containerPx.height / viewBox.height, PPM_PRECISION);
        });
      }
    }
  });

  it("manual mode honors center and zoom", () => {
    const viewport: Viewport2D = { mode: "manual", centerXMm: 1500, centerYMm: 700, zoom: 2 };
    const { viewBox, pixelsPerMm } = getViewBox2D(viewport, wideContent, wideContainer);

    // fitPpm = min(800/4000, 400/2000) = 0.2; pixelsPerMm = 0.2 * 2 = 0.4
    expect(pixelsPerMm).toBeCloseTo(0.4, PPM_PRECISION);
    expect(viewBox.width).toBeCloseTo(wideContainer.width / 0.4, MM_PRECISION); // 2000
    expect(viewBox.height).toBeCloseTo(wideContainer.height / 0.4, MM_PRECISION); // 1000
    expect(viewBox.x).toBeCloseTo(1500 - 1000, MM_PRECISION);
    expect(viewBox.y).toBeCloseTo(700 - 500, MM_PRECISION);
  });

  it("ignores stale center/zoom fields on a fit-mode viewport", () => {
    const staleFit: Viewport2D = { mode: "fit", centerXMm: 12345, centerYMm: -9999, zoom: 50 };
    const stale = getViewBox2D(staleFit, wideContent, wideContainer);
    const clean = getViewBox2D(FIT_VIEWPORT, wideContent, wideContainer);

    expect(stale).toEqual(clean);
  });

  it("falls back to contentBounds with ppm 0 for an unmeasured (zero-size) container", () => {
    const zeroContainer: Size = { width: 0, height: 0 };
    const { viewBox, pixelsPerMm } = getViewBox2D(FIT_VIEWPORT, wideContent, zeroContainer);

    expect(viewBox).toEqual(wideContent);
    expect(pixelsPerMm).toBe(0);
  });
});

describe("zoomAtPoint", () => {
  const limits: ZoomLimits = PLAN_ZOOM_LIMITS;

  function screenPositionOf(
    viewport: Viewport2D,
    pointMm: { xMm: number; yMm: number },
    contentBounds: ViewBox,
    containerPx: Size
  ): { x: number; y: number } {
    const { viewBox, pixelsPerMm } = getViewBox2D(viewport, contentBounds, containerPx);
    return {
      x: (pointMm.xMm - viewBox.x) * pixelsPerMm,
      y: (pointMm.yMm - viewBox.y) * pixelsPerMm
    };
  }

  describe("keeps the world point under the cursor fixed", () => {
    const startingViewports: readonly [string, Viewport2D][] = [
      ["fit", FIT_VIEWPORT],
      ["manual", { mode: "manual", centerXMm: 1800, centerYMm: 900, zoom: 2 }]
    ];
    const points: readonly { xMm: number; yMm: number }[] = [
      { xMm: 2000, yMm: 1000 }, // content center
      { xMm: 500, yMm: 300 }, // off-center
      { xMm: 0, yMm: 0 } // content corner
    ];
    const factors = [1.25, 0.8, 100, 0.001];

    for (const [viewportLabel, viewport] of startingViewports) {
      for (const point of points) {
        for (const factor of factors) {
          it(`${viewportLabel} viewport, point (${point.xMm}, ${point.yMm}), factor ${factor}`, () => {
            const before = screenPositionOf(viewport, point, wideContent, wideContainer);
            const next = zoomAtPoint(viewport, point, factor, wideContent, wideContainer, limits);
            const after = screenPositionOf(next, point, wideContent, wideContainer);

            expect(after.x).toBeCloseTo(before.x, MM_PRECISION);
            expect(after.y).toBeCloseTo(before.y, MM_PRECISION);
          });
        }
      }
    }
  });

  it("pins at minZoom when zooming out past the limit", () => {
    const next = zoomAtPoint(
      FIT_VIEWPORT,
      { xMm: 2000, yMm: 1000 },
      0.0001,
      wideContent,
      wideContainer,
      limits
    );
    expect(next.mode).toBe("manual");
    expect(next.zoom).toBeCloseTo(limits.minZoom, PPM_PRECISION);
  });

  it("pins at maxZoom when zooming in past the limit", () => {
    const next = zoomAtPoint(
      FIT_VIEWPORT,
      { xMm: 2000, yMm: 1000 },
      100000,
      wideContent,
      wideContainer,
      limits
    );
    expect(next.mode).toBe("manual");
    expect(next.zoom).toBeCloseTo(limits.maxZoom, PPM_PRECISION);
  });

  it("pins at the minViewBoxWidthMm world-space cap when it is tighter than maxZoom", () => {
    // fitPpm = min(800/2000, 400/1000) = 0.4; widthCap = 800 / (0.4 * 250) = 8,
    // which is well below PLAN_ZOOM_LIMITS.maxZoom (12).
    const smallContent: ViewBox = { x: 0, y: 0, width: 2000, height: 1000 };
    const expectedCappedZoom = wideContainer.width / (0.4 * limits.minViewBoxWidthMm);
    expect(expectedCappedZoom).toBeLessThan(limits.maxZoom);

    const next = zoomAtPoint(
      FIT_VIEWPORT,
      { xMm: 1000, yMm: 500 },
      100000,
      smallContent,
      wideContainer,
      limits
    );
    expect(next.mode).toBe("manual");
    expect(next.zoom).toBeCloseTo(expectedCappedZoom, PPM_PRECISION);
  });

  it("returns the same object reference when already pinned at minZoom in manual mode", () => {
    const pinned: Viewport2D = {
      mode: "manual",
      centerXMm: 2000,
      centerYMm: 1000,
      zoom: limits.minZoom
    };
    const next = zoomAtPoint(
      pinned,
      { xMm: 2000, yMm: 1000 },
      0.5,
      wideContent,
      wideContainer,
      limits
    );
    expect(next).toBe(pinned);
  });

  it("returns the same object reference when already pinned at maxZoom in manual mode", () => {
    const pinned: Viewport2D = {
      mode: "manual",
      centerXMm: 2000,
      centerYMm: 1000,
      zoom: limits.maxZoom
    };
    const next = zoomAtPoint(
      pinned,
      { xMm: 2000, yMm: 1000 },
      2,
      wideContent,
      wideContainer,
      limits
    );
    expect(next).toBe(pinned);
  });

  it("transitions fit mode into manual mode", () => {
    const next = zoomAtPoint(
      FIT_VIEWPORT,
      { xMm: 2000, yMm: 1000 },
      1.25,
      wideContent,
      wideContainer,
      limits
    );
    expect(next.mode).toBe("manual");
  });
});

describe("clampZoom", () => {
  const limits: ZoomLimits = PLAN_ZOOM_LIMITS;

  it("clamps to [minZoom, maxZoom] for an unmeasured container", () => {
    const zeroContainer: Size = { width: 0, height: 0 };
    expect(clampZoom(0.0001, wideContent, zeroContainer, limits)).toBe(limits.minZoom);
    expect(clampZoom(999999, wideContent, zeroContainer, limits)).toBe(limits.maxZoom);
    expect(clampZoom(3, wideContent, zeroContainer, limits)).toBe(3);
  });

  it("never caps below fit scale for content narrower than minViewBoxWidthMm", () => {
    // 200mm content is below PLAN_ZOOM_LIMITS.minViewBoxWidthMm (250), so the
    // naive world-space cap (widthCap = containerPx.width / (fitPpm * 250))
    // would fall below 1 here and clamp fit scale itself down.
    const tinyContent: ViewBox = { x: 0, y: 0, width: 200, height: 160 };
    const container: Size = { width: 1000, height: 800 };

    expect(clampZoom(1, tinyContent, container, limits)).toBe(1);

    // Zooming in from fit must never land below fit scale either.
    const zoomedIn = clampZoom(1.01, tinyContent, container, limits);
    expect(zoomedIn).toBeGreaterThanOrEqual(1);
  });
});

describe("panBy", () => {
  it("round-trips: pan then pan by the negated delta restores the center", () => {
    const viewport: Viewport2D = { mode: "manual", centerXMm: 1800, centerYMm: 900, zoom: 2 };
    const delta = { x: 37, y: -21 };

    const panned = panBy(viewport, delta, wideContent, wideContainer);
    const restored = panBy(panned, { x: -delta.x, y: -delta.y }, wideContent, wideContainer);

    expect(restored.centerXMm).toBeCloseTo(viewport.centerXMm, MM_PRECISION);
    expect(restored.centerYMm).toBeCloseTo(viewport.centerYMm, MM_PRECISION);
  });

  it("moves the center by half as many mm at 2x zoom for the same px delta", () => {
    const delta = { x: 40, y: 20 };
    const at1x: Viewport2D = { mode: "manual", centerXMm: 2000, centerYMm: 1000, zoom: 1 };
    const at2x: Viewport2D = { mode: "manual", centerXMm: 2000, centerYMm: 1000, zoom: 2 };

    const panned1x = panBy(at1x, delta, wideContent, wideContainer);
    const panned2x = panBy(at2x, delta, wideContent, wideContainer);

    const shift1x = { x: panned1x.centerXMm - at1x.centerXMm, y: panned1x.centerYMm - at1x.centerYMm };
    const shift2x = { x: panned2x.centerXMm - at2x.centerXMm, y: panned2x.centerYMm - at2x.centerYMm };

    expect(shift2x.x).toBeCloseTo(shift1x.x / 2, MM_PRECISION);
    expect(shift2x.y).toBeCloseTo(shift1x.y / 2, MM_PRECISION);
  });

  it("transitions fit mode into manual mode with zoom 1", () => {
    const next = panBy(FIT_VIEWPORT, { x: 10, y: 5 }, wideContent, wideContainer);
    expect(next.mode).toBe("manual");
    expect(next.zoom).toBe(1);

    // fitPpm = 0.2, so the mm shift is px / 0.2
    expect(next.centerXMm).toBeCloseTo(2000 + 10 / 0.2, MM_PRECISION);
    expect(next.centerYMm).toBeCloseTo(1000 + 5 / 0.2, MM_PRECISION);
  });

  it("returns the input viewport unchanged for an unmeasured container", () => {
    const viewport: Viewport2D = { mode: "manual", centerXMm: 1800, centerYMm: 900, zoom: 2 };
    const zeroContainer: Size = { width: 0, height: 0 };
    const next = panBy(viewport, { x: 10, y: 10 }, wideContent, zeroContainer);
    expect(next).toBe(viewport);
  });
});

describe("pinchZoomPan", () => {
  const limits: ZoomLimits = PLAN_ZOOM_LIMITS;

  function screenPositionOf(
    viewport: Viewport2D,
    pointMm: { xMm: number; yMm: number },
    contentBounds: ViewBox,
    containerPx: Size
  ): { x: number; y: number } {
    const { viewBox, pixelsPerMm } = getViewBox2D(viewport, contentBounds, containerPx);
    return {
      x: (pointMm.xMm - viewBox.x) * pixelsPerMm,
      y: (pointMm.yMm - viewBox.y) * pixelsPerMm
    };
  }

  const manual: Viewport2D = { mode: "manual", centerXMm: 1800, centerYMm: 900, zoom: 2 };
  const prevMidWorld = { xMm: 1600, yMm: 700 };

  it("with no midpoint movement, equals a pure zoomAtPoint about the midpoint", () => {
    const factor = 1.4;
    const combined = pinchZoomPan(
      manual,
      prevMidWorld,
      factor,
      { x: 0, y: 0 },
      wideContent,
      wideContainer,
      limits
    );
    const zoomOnly = zoomAtPoint(manual, prevMidWorld, factor, wideContent, wideContainer, limits);
    expect(combined.mode).toBe(zoomOnly.mode);
    expect(combined.zoom).toBeCloseTo(zoomOnly.zoom, PPM_PRECISION);
    expect(combined.centerXMm).toBeCloseTo(zoomOnly.centerXMm, MM_PRECISION);
    expect(combined.centerYMm).toBeCloseTo(zoomOnly.centerYMm, MM_PRECISION);
  });

  it("with a unit zoom factor, equals a pure two-finger panBy of the negated midpoint delta", () => {
    const midDelta = { x: 34, y: -22 };
    const combined = pinchZoomPan(
      manual,
      prevMidWorld,
      1,
      midDelta,
      wideContent,
      wideContainer,
      limits
    );
    // factor 1 on a manual viewport is an exact zoom identity, so the result
    // must be panBy of the negated midpoint delta.
    const panOnly = panBy(
      manual,
      { x: -midDelta.x, y: -midDelta.y },
      wideContent,
      wideContainer
    );
    expect(combined.centerXMm).toBeCloseTo(panOnly.centerXMm, MM_PRECISION);
    expect(combined.centerYMm).toBeCloseTo(panOnly.centerYMm, MM_PRECISION);
    expect(combined.zoom).toBeCloseTo(panOnly.zoom, PPM_PRECISION);
  });

  it("combined: the world point under the previous midpoint lands under the new midpoint", () => {
    const factor = 1.6;
    const midDelta = { x: 40, y: -25 };
    const before = screenPositionOf(manual, prevMidWorld, wideContent, wideContainer);
    const next = pinchZoomPan(
      manual,
      prevMidWorld,
      factor,
      midDelta,
      wideContent,
      wideContainer,
      limits
    );
    const after = screenPositionOf(next, prevMidWorld, wideContent, wideContainer);

    // zoomAtPoint pins the world point at the prev midpoint's screen position;
    // panBy(-midDelta) then shifts the content by +midDelta on screen, so the
    // point ends up exactly under the new (prev + delta) screen midpoint.
    expect(after.x).toBeCloseTo(before.x + midDelta.x, MM_PRECISION);
    expect(after.y).toBeCloseTo(before.y + midDelta.y, MM_PRECISION);
  });

  it("clamps the zoom factor but still applies the pan", () => {
    const hugeFactor = 100000;
    const midDelta = { x: 30, y: 18 };
    const zoomOnly = zoomAtPoint(manual, prevMidWorld, hugeFactor, wideContent, wideContainer, limits);
    const combined = pinchZoomPan(
      manual,
      prevMidWorld,
      hugeFactor,
      midDelta,
      wideContent,
      wideContainer,
      limits
    );
    // Zoom is clamped identically...
    expect(combined.zoom).toBeCloseTo(zoomOnly.zoom, PPM_PRECISION);
    // ...and the pan is still applied on top of the clamped zoom.
    const expected = panBy(
      zoomOnly,
      { x: -midDelta.x, y: -midDelta.y },
      wideContent,
      wideContainer
    );
    expect(combined.centerXMm).toBeCloseTo(expected.centerXMm, MM_PRECISION);
    expect(combined.centerYMm).toBeCloseTo(expected.centerYMm, MM_PRECISION);
    // The pan genuinely moved the center off the pure-zoom result.
    expect(Math.hypot(combined.centerXMm - zoomOnly.centerXMm, combined.centerYMm - zoomOnly.centerYMm)).toBeGreaterThan(1);
  });
});

describe("getFitBoundsViewport", () => {
  const limits: ZoomLimits = PLAN_ZOOM_LIMITS;

  it("centers on the target and derives zoom from targetPpm / fitPpm", () => {
    // Half the content's width, same aspect ratio, centered inside it.
    const targetBounds: ViewBox = { x: 1000, y: 500, width: 2000, height: 1000 };
    const next = getFitBoundsViewport(targetBounds, wideContent, wideContainer, limits);

    expect(next.mode).toBe("manual");
    expect(next.centerXMm).toBeCloseTo(2000, MM_PRECISION);
    expect(next.centerYMm).toBeCloseTo(1000, MM_PRECISION);
    expect(next.zoom).toBeCloseTo(2, PPM_PRECISION);
  });

  it("clamps the derived zoom by the given limits", () => {
    // A tiny target would derive a huge zoom; it must be capped at maxZoom.
    const tinyTarget: ViewBox = { x: 1900, y: 950, width: 4, height: 2 };
    const next = getFitBoundsViewport(tinyTarget, wideContent, wideContainer, limits);
    expect(next.zoom).toBeLessThanOrEqual(limits.maxZoom);
  });

  it("returns FIT_VIEWPORT for an unmeasured container", () => {
    const targetBounds: ViewBox = { x: 1000, y: 500, width: 2000, height: 1000 };
    const zeroContainer: Size = { width: 0, height: 0 };
    const next = getFitBoundsViewport(targetBounds, wideContent, zeroContainer, limits);
    expect(next).toBe(FIT_VIEWPORT);
  });
});

describe("getEffectiveZoom", () => {
  it("is 1 for fit mode", () => {
    expect(getEffectiveZoom(FIT_VIEWPORT)).toBe(1);
  });

  it("is the viewport's zoom for manual mode", () => {
    const viewport: Viewport2D = { mode: "manual", centerXMm: 0, centerYMm: 0, zoom: 3.5 };
    expect(getEffectiveZoom(viewport)).toBe(3.5);
  });
});
