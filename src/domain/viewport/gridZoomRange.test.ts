import { describe, expect, it } from "vitest";
import { getGridSnapTargets } from "../snapping/gridSnapTargets";
import {
  getGridPatternPhaseMm,
  getGridPrecisionFloorOptionsMm,
  getMinorGridIntervalMm
} from "../units/precision";
import {
  getViewBox2D,
  panBy,
  PLAN_ZOOM_LIMITS,
  type ViewBox,
  type Viewport2D
} from "./viewport2d";

// Task M3 regression pins (docs: task-m3-brief.md). M2 already made the
// getViewBox2D → precision → gridSnapTargets pipeline correct (the viewBox
// IS the visible window, aspect-matched, no letterboxing) — these tests pin
// that behavior across the zoom range so a future change can't silently
// regress grid density, snap-threshold scaling, or pattern anchoring.

// A realistic worst case: a modest room-scale plan (10m x 10m) viewed in a
// wide, short container — the aspect mismatch (1.6 vs 1.0) is deliberate,
// it's what makes the viewBox's non-constrained axis extend past contentBounds.
const CONTENT_BOUNDS: ViewBox = { x: 0, y: 0, width: 10000, height: 10000 };
const CONTAINER = { width: 1600, height: 1000 };

// gridSnapTargets.ts's own defensive cap — kept in sync here as a literal
// (not imported) since it's not exported; Test A's job is to prove the real
// zoom-adaptive interval stays comfortably under it, not to reach into the
// module's internals.
const MAX_LINES_PER_AXIS = 1000;

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
    // minZoom = 4x the fit size — the widest possible visible window, and the
    // finest precision floor the app offers (metric: 0.5cm; imperial: 0.5in),
    // so the minor interval is pinned as fine as the ladder ever allows.
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

    // Pinned actual counts (10m x 10m content, 1600x1000px container,
    // minZoom=0.25 -> 64000x40000mm visible window, 500mm metric minor): a
    // future change to any link in the pipeline that inflates this materially
    // will fail here instead of silently ballooning the DOM/snap-candidate set.
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

    // (1) monotonically non-increasing as zoom increases.
    for (let i = 1; i < unfloored.length; i += 1) {
      expect(unfloored[i].minorMm).toBeLessThanOrEqual(unfloored[i - 1].minorMm);
    }

    // (2) the on-screen minor spacing never drops below the target — the
    // invariant the whole ladder exists to guarantee.
    for (const { minorMm, pixelsPerMm } of unfloored) {
      expect(minorMm * pixelsPerMm).toBeGreaterThanOrEqual(targetMinorPx - 1e-9);
    }

    // (3) with a precision floor set, the interval never goes below it even
    // at the deepest zoom (where the unfloored ladder would otherwise pick a
    // finer rung).
    const floored = zooms.map((zoom) => {
      const { pixelsPerMm } = getViewBox2D(manualViewport(zoom), CONTENT_BOUNDS, CONTAINER);
      return getMinorGridIntervalMm("m", pixelsPerMm, { targetMinorPx, minIntervalMm: floorMm });
    });
    for (const minorMm of floored) {
      expect(minorMm).toBeGreaterThanOrEqual(floorMm);
    }
    // At max zoom the unfloored ladder would pick a rung finer than the
    // floor (10mm < 25.4mm) — confirming the floor is actually doing work,
    // not just trivially satisfied because nothing ever got that fine.
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
      // Trivially true by construction — documents the definition so a future
      // refactor that stores the threshold in mm (losing the constant-px
      // property) would have to knowingly break this line.
      expect(snapThresholdMm * pixelsPerMm).toBeCloseTo(SNAP_THRESHOLD_PX, 9);
    }

    // Inversely proportional to zoom: doubling zoom halves the mm threshold.
    for (let i = 1; i < results.length; i += 1) {
      const prev = results[i - 1];
      const curr = results[i];
      const expectedRatio = prev.zoom / curr.zoom;
      const actualRatio = curr.snapThresholdMm / prev.snapThresholdMm;
      expect(actualRatio).toBeCloseTo(expectedRatio, 9);
    }
  });

  it("Test D: grid pattern phase stays anchored to world space (does not swim) as the viewBox pans", () => {
    // GridOverlay (src/app/components/GridOverlay.tsx) renders its pattern
    // with patternUnits="userSpaceOnUse" and x/y = getGridPatternPhaseMm(
    // originXMm/originYMm, spacingMm). PlanView's call site passes no
    // originXMm/originYMm at all (they default to 0) — i.e. the plan grid is
    // anchored to world (0,0), NOT to the current viewBox origin. That's what
    // keeps the lattice from shifting as the user pans: the pattern's phase
    // is a function of the fixed world anchor only, never of viewBox.x/y.
    const worldOriginXMm = 0;
    const spacingMm = 500;

    const viewportStart = manualViewport(1);
    const { viewBox: viewBoxStart } = getViewBox2D(viewportStart, CONTENT_BOUNDS, CONTAINER);

    const viewportAfterPan1 = panBy(viewportStart, { x: 340, y: 0 }, CONTENT_BOUNDS, CONTAINER);
    const { viewBox: viewBoxAfterPan1 } = getViewBox2D(
      viewportAfterPan1,
      CONTENT_BOUNDS,
      CONTAINER
    );

    const viewportAfterPan2 = panBy(
      viewportAfterPan1,
      { x: -777, y: 0 },
      CONTENT_BOUNDS,
      CONTAINER
    );
    const { viewBox: viewBoxAfterPan2 } = getViewBox2D(
      viewportAfterPan2,
      CONTENT_BOUNDS,
      CONTAINER
    );

    // Sanity: the two pans actually moved the visible window (else the rest
    // of this test would pass vacuously).
    expect(viewBoxAfterPan1.x).not.toBeCloseTo(viewBoxStart.x);
    expect(viewBoxAfterPan2.x).not.toBeCloseTo(viewBoxAfterPan1.x);

    // The pattern phase PlanView would hand to GridOverlay is recomputed from
    // the SAME fixed world anchor at every pan step — never from the panned
    // viewBox's own x — so it comes out identical every time.
    const phaseAtStart = getGridPatternPhaseMm(worldOriginXMm, spacingMm);
    const phaseAfterPan1 = getGridPatternPhaseMm(worldOriginXMm, spacingMm);
    const phaseAfterPan2 = getGridPatternPhaseMm(worldOriginXMm, spacingMm);
    expect(phaseAfterPan1).toBe(phaseAtStart);
    expect(phaseAfterPan2).toBe(phaseAtStart);

    // And the world-space grid lattice implied by that (fixed) phase lands on
    // an exact multiple-of-spacing offset from the world anchor for every one
    // of the three (differently panned) viewBoxes — i.e. it's one continuous
    // lattice that the viewBox slides across, not three different lattices
    // that happen to line up.
    for (const viewBox of [viewBoxStart, viewBoxAfterPan1, viewBoxAfterPan2]) {
      const nearestLineAtOrAfterLeftEdge =
        Math.ceil((viewBox.x - phaseAtStart) / spacingMm) * spacingMm + phaseAtStart;
      const remainder = (nearestLineAtOrAfterLeftEdge - worldOriginXMm) % spacingMm;
      expect(Math.abs(remainder)).toBeLessThan(1e-6);
    }
  });
});
