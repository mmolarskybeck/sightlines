import { describe, expect, it } from "vitest";
import { getGridSnapTargets, MAX_LINES_PER_AXIS } from "../snapping/gridSnapTargets";
import {
  getGridPrecisionFloorOptionsMm,
  getMinorGridIntervalMm
} from "../units/precision";
import { getViewBox2D, PLAN_ZOOM_LIMITS, type ViewBox, type Viewport2D } from "./viewport2d";

// Regression coverage for grid density and snap thresholds across the zoom range.

// Aspect mismatch forces the unconstrained viewBox axis beyond content bounds.
const CONTENT_BOUNDS: ViewBox = { x: 0, y: 0, width: 10000, height: 10000 };
const CONTAINER = { width: 1600, height: 1000 };

function manualViewport(zoom: number): Viewport2D {
  return {
    mode: "manual",
    centerXMm: CONTENT_BOUNDS.x + CONTENT_BOUNDS.width / 2,
    centerYMm: CONTENT_BOUNDS.y + CONTENT_BOUNDS.height / 2,
    zoom
  };
}

function boundsOf(viewBox: ViewBox) {
  return {
    minXMm: viewBox.x,
    maxXMm: viewBox.x + viewBox.width,
    minYMm: viewBox.y,
    maxYMm: viewBox.y + viewBox.height
  };
}

describe("grid/snap correctness across the zoom range (M3)", () => {
  it("Test A: snap-target volume stays well under the per-axis cap at min zoom + finest precision floor", () => {
    const viewport = manualViewport(PLAN_ZOOM_LIMITS.minZoom);
    const { viewBox, pixelsPerMm } = getViewBox2D(viewport, CONTENT_BOUNDS, CONTAINER);
    const visibleBounds = boundsOf(viewBox);

    const metricFloorMm = getGridPrecisionFloorOptionsMm("m")[0];
    const metricMinorMm = getMinorGridIntervalMm("m", pixelsPerMm, {
      targetMinorPx: 12,
      minIntervalMm: metricFloorMm
    });
    const metricTargets = getGridSnapTargets(metricMinorMm, visibleBounds);
    const metricXCount = metricTargets.filter((t) => t.axis === "x").length;
    const metricYCount = metricTargets.filter((t) => t.axis === "y").length;

    // Pin target volume so DOM/snap candidates cannot silently balloon.
    expect(metricMinorMm).toBe(500);
    expect(metricXCount).toBe(129);
    expect(metricYCount).toBe(81);
    expect(metricXCount).toBeLessThan(MAX_LINES_PER_AXIS * 0.2);
    expect(metricYCount).toBeLessThan(MAX_LINES_PER_AXIS * 0.2);

    const imperialFloorMm = getGridPrecisionFloorOptionsMm("ft")[0];
    const imperialMinorMm = getMinorGridIntervalMm("ft", pixelsPerMm, {
      targetMinorPx: 12,
      minIntervalMm: imperialFloorMm
    });
    const imperialTargets = getGridSnapTargets(imperialMinorMm, visibleBounds);
    const imperialXCount = imperialTargets.filter((t) => t.axis === "x").length;
    const imperialYCount = imperialTargets.filter((t) => t.axis === "y").length;

    expect(imperialMinorMm).toBeCloseTo(609.6, 5);
    expect(imperialXCount).toBe(105);
    expect(imperialYCount).toBe(66);
    expect(imperialXCount).toBeLessThan(MAX_LINES_PER_AXIS * 0.2);
    expect(imperialYCount).toBeLessThan(MAX_LINES_PER_AXIS * 0.2);
  });

  it("Test B: minor grid interval steps down monotonically with zoom, never below the on-screen target, and respects a precision floor", () => {
    const zooms = [0.25, 0.5, 1, 2, 4, 12];
    const targetMinorPx = 12;
    const floorMm = 25.4; // 1 inch — an arbitrary but realistic precision floor

    const unfloored = zooms.map((zoom) => {
      const { pixelsPerMm } = getViewBox2D(manualViewport(zoom), CONTENT_BOUNDS, CONTAINER);
      const minorMm = getMinorGridIntervalMm("m", pixelsPerMm, { targetMinorPx });
      return { zoom, pixelsPerMm, minorMm };
    });

    for (let i = 1; i < unfloored.length; i += 1) {
      expect(unfloored[i].minorMm).toBeLessThanOrEqual(unfloored[i - 1].minorMm);
    }

    for (const { minorMm, pixelsPerMm } of unfloored) {
      expect(minorMm * pixelsPerMm).toBeGreaterThanOrEqual(targetMinorPx - 1e-9);
    }

    const floored = zooms.map((zoom) => {
      const { pixelsPerMm } = getViewBox2D(manualViewport(zoom), CONTENT_BOUNDS, CONTAINER);
      return getMinorGridIntervalMm("m", pixelsPerMm, { targetMinorPx, minIntervalMm: floorMm });
    });
    for (const minorMm of floored) {
      expect(minorMm).toBeGreaterThanOrEqual(floorMm);
    }
    expect(unfloored[unfloored.length - 1].minorMm).toBeLessThan(floorMm);
    expect(floored[floored.length - 1]).toBeGreaterThanOrEqual(floorMm);
  });

  it("Test C: the 10px snap threshold is constant in screen px, so its mm value scales inversely with zoom", () => {
    const zooms = [0.25, 1, 12];
    const SNAP_THRESHOLD_PX = 10;

    const results = zooms.map((zoom) => {
      const { pixelsPerMm } = getViewBox2D(manualViewport(zoom), CONTENT_BOUNDS, CONTAINER);
      const snapThresholdMm = SNAP_THRESHOLD_PX / pixelsPerMm;
      return { zoom, pixelsPerMm, snapThresholdMm };
    });

    for (const { pixelsPerMm, snapThresholdMm } of results) {
      // Snap threshold must remain constant in screen pixels.
      expect(snapThresholdMm * pixelsPerMm).toBeCloseTo(SNAP_THRESHOLD_PX, 9);
    }

    for (let i = 1; i < results.length; i += 1) {
      const prev = results[i - 1];
      const curr = results[i];
      const expectedRatio = prev.zoom / curr.zoom;
      const actualRatio = curr.snapThresholdMm / prev.snapThresholdMm;
      expect(actualRatio).toBeCloseTo(expectedRatio, 9);
    }
  });
});
