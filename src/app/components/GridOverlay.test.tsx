import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getViewBox2D,
  panBy,
  type ViewBox,
  type Viewport2D
} from "../../domain/viewport/viewport2d";
import { GridOverlay } from "./GridOverlay";

afterEach(cleanup);

// Task M3, Test D: grid pattern anchoring under pan — the "grid must not
// swim" regression pin, exercised through the REAL rendered GridOverlay
// rather than through the phase helper alone (calling getGridPatternPhaseMm
// with the same fixed anchor twice proves nothing — purity guarantees
// equality). Here the rendered <pattern> attributes are read back for
// viewBoxes produced by actual panBy calls, so the pin covers the actual
// integration surface: PlanView hands GridOverlay a rect that MOVES with
// the pan (x/y/width/height = the panned viewBox) while leaving the
// originXMm/originYMm props unset — and because the patterns tile in
// userSpaceOnUse (world) coordinates with a phase derived only from that
// fixed default origin, the implied world-space lattice must come out
// identical however far the rect has panned.

// Same fixture as gridZoomRange.test.ts: 10m x 10m content in a 1600x1000px
// container. At zoom 1 (fit ppm = 0.1) the viewBox is 16000x10000mm at
// x = -3000 — and the two pans below are chosen so the three viewBox origins
// all differ mod the minor spacing (0, 400, 130 mod 500), which is exactly
// what makes the anti-regression case at the bottom able to discriminate.
const CONTENT_BOUNDS: ViewBox = { x: 0, y: 0, width: 10000, height: 10000 };
const CONTAINER = { width: 1600, height: 1000 };
const MINOR_SPACING_MM = 500;
const MAJOR_SPACING_MM = 2500;

const VIEWPORT_START: Viewport2D = {
  mode: "manual",
  centerXMm: CONTENT_BOUNDS.x + CONTENT_BOUNDS.width / 2,
  centerYMm: CONTENT_BOUNDS.y + CONTENT_BOUNDS.height / 2,
  zoom: 1
};

type RenderedGrid = {
  minorPattern: { x: number; y: number; width: number };
  majorPattern: { x: number; y: number; width: number };
  fillRects: { x: number; y: number }[];
};

// Renders GridOverlay with EXACTLY the props PlanView passes (rect = the
// viewBox, id="plan-grid", origin props left to their defaults unless the
// buggy-coupling case injects them) and reads back the attributes the
// browser would actually tile from.
function renderGrid(
  viewBox: ViewBox,
  originProps: { originXMm?: number; originYMm?: number } = {}
): RenderedGrid {
  const { container } = render(
    <svg viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}>
      <GridOverlay
        id="plan-grid"
        height={viewBox.height}
        majorSpacingMm={MAJOR_SPACING_MM}
        minorSpacingMm={MINOR_SPACING_MM}
        width={viewBox.width}
        x={viewBox.x}
        y={viewBox.y}
        {...originProps}
      />
    </svg>
  );

  const readPattern = (id: string) => {
    const pattern = container.querySelector(`pattern[id="${id}"]`);
    expect(pattern).not.toBeNull();
    expect(pattern!.getAttribute("patternUnits")).toBe("userSpaceOnUse");
    return {
      x: Number(pattern!.getAttribute("x")),
      y: Number(pattern!.getAttribute("y")),
      width: Number(pattern!.getAttribute("width"))
    };
  };

  const fillRects = [...container.querySelectorAll("rect.grid-fill")].map((rect) => ({
    x: Number(rect.getAttribute("x")),
    y: Number(rect.getAttribute("y"))
  }));

  return {
    minorPattern: readPattern("plan-grid-minor"),
    majorPattern: readPattern("plan-grid-major"),
    fillRects
  };
}

// A userSpaceOnUse pattern with attribute x = phase and width = spacing puts
// its tile seams (the grid lines) at every world-space position ≡ phase
// (mod spacing). Two renders with the same spacing therefore draw the same
// world lattice iff their phases are equal — this reduces "did the grid
// swim?" to a comparison of the rendered phase attributes.
function worldLatticePhase(pattern: { x: number; width: number }): number {
  return ((pattern.x % pattern.width) + pattern.width) % pattern.width;
}

describe("GridOverlay pattern anchoring under pan (M3 Test D)", () => {
  const { viewBox: viewBoxStart } = getViewBox2D(VIEWPORT_START, CONTENT_BOUNDS, CONTAINER);
  const viewportPan1 = panBy(VIEWPORT_START, { x: 340, y: 130 }, CONTENT_BOUNDS, CONTAINER);
  const { viewBox: viewBoxPan1 } = getViewBox2D(viewportPan1, CONTENT_BOUNDS, CONTAINER);
  const viewportPan2 = panBy(viewportPan1, { x: -777, y: 46 }, CONTENT_BOUNDS, CONTAINER);
  const { viewBox: viewBoxPan2 } = getViewBox2D(viewportPan2, CONTENT_BOUNDS, CONTAINER);

  it("keeps the world-space grid lattice identical across pans when origin props are left to PlanView's defaults", () => {
    // Sanity: the pans genuinely moved the viewBox, and moved it to origins
    // that are NOT a whole number of minor tiles apart — otherwise phase
    // equality below would hold even under the buggy viewBox-coupled origin,
    // and this pin would be toothless.
    expect(viewBoxPan1.x).not.toBeCloseTo(viewBoxStart.x);
    expect(viewBoxPan2.x).not.toBeCloseTo(viewBoxPan1.x);
    expect((viewBoxPan1.x - viewBoxStart.x) % MINOR_SPACING_MM).not.toBeCloseTo(0);
    expect((viewBoxPan2.x - viewBoxPan1.x) % MINOR_SPACING_MM).not.toBeCloseTo(0);

    const gridStart = renderGrid(viewBoxStart);
    const gridPan1 = renderGrid(viewBoxPan1);
    const gridPan2 = renderGrid(viewBoxPan2);

    // The fill rects DO follow the pan (they're what keeps the grid covering
    // the visible window) — proving the pattern-phase equality below isn't
    // holding just because nothing about the render changed.
    expect(gridPan1.fillRects[0].x).toBeCloseTo(viewBoxPan1.x, 6);
    expect(gridPan2.fillRects[0].x).toBeCloseTo(viewBoxPan2.x, 6);
    expect(gridPan1.fillRects[0].x).not.toBeCloseTo(gridStart.fillRects[0].x);

    // The pin itself: the rendered patterns' world-space phases — and hence
    // the world positions of every grid line they tile — are identical for
    // all three differently-panned viewBoxes, on both axes, in both tiers.
    for (const grid of [gridPan1, gridPan2]) {
      expect(worldLatticePhase(grid.minorPattern)).toBeCloseTo(
        worldLatticePhase(gridStart.minorPattern),
        9
      );
      expect(grid.minorPattern.y).toBeCloseTo(gridStart.minorPattern.y, 9);
      expect(worldLatticePhase(grid.majorPattern)).toBeCloseTo(
        worldLatticePhase(gridStart.majorPattern),
        9
      );
      expect(grid.majorPattern.y).toBeCloseTo(gridStart.majorPattern.y, 9);
    }
  });

  it("would catch the regression: a viewBox-derived origin prop shifts the phase between pans", () => {
    // The anti-regression teeth. If someone reintroduced letterbox-era
    // coupling at PlanView's call site — e.g. originXMm={viewBoxBounds.x} —
    // the pattern phase would become a function of the pan position, and the
    // lattice would visibly swim. Rendering that buggy coupling here and
    // asserting the phases DIFFER proves the previous test's equality check
    // can actually discriminate, rather than passing for any inputs.
    const buggyPan1 = renderGrid(viewBoxPan1, { originXMm: viewBoxPan1.x });
    const buggyPan2 = renderGrid(viewBoxPan2, { originXMm: viewBoxPan2.x });

    expect(worldLatticePhase(buggyPan1.minorPattern)).not.toBeCloseTo(
      worldLatticePhase(buggyPan2.minorPattern),
      6
    );
  });
});
