import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getViewBox2D,
  panBy,
  type ViewBox,
  type Viewport2D
} from "../../../domain/viewport/viewport2d";
import { GridOverlay } from "./GridOverlay";

afterEach(cleanup);

// Regression: rendered userSpaceOnUse grid phases must stay fixed while panning.
// Pan offsets differ modulo grid spacing so a viewBox-coupled phase would fail.
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

// Render with PlanView's prop shape and inspect the browser-facing attributes.
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

// Equal phase modulo spacing means an equal world-space lattice.
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
    // Ensure the pan offsets can distinguish a viewBox-coupled phase.
    expect(viewBoxPan1.x).not.toBeCloseTo(viewBoxStart.x);
    expect(viewBoxPan2.x).not.toBeCloseTo(viewBoxPan1.x);
    expect((viewBoxPan1.x - viewBoxStart.x) % MINOR_SPACING_MM).not.toBeCloseTo(0);
    expect((viewBoxPan2.x - viewBoxPan1.x) % MINOR_SPACING_MM).not.toBeCloseTo(0);

    const gridStart = renderGrid(viewBoxStart);
    const gridPan1 = renderGrid(viewBoxPan1);
    const gridPan2 = renderGrid(viewBoxPan2);

    expect(gridPan1.fillRects[0].x).toBeCloseTo(viewBoxPan1.x, 6);
    expect(gridPan2.fillRects[0].x).toBeCloseTo(viewBoxPan2.x, 6);
    expect(gridPan1.fillRects[0].x).not.toBeCloseTo(gridStart.fillRects[0].x);

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
    // Model the buggy viewBox-coupled origin to prove this test can discriminate.
    const buggyPan1 = renderGrid(viewBoxPan1, { originXMm: viewBoxPan1.x });
    const buggyPan2 = renderGrid(viewBoxPan2, { originXMm: viewBoxPan2.x });

    expect(worldLatticePhase(buggyPan1.minorPattern)).not.toBeCloseTo(
      worldLatticePhase(buggyPan2.minorPattern),
      6
    );
  });
});
