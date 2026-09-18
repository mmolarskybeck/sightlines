import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../../domain/viewport/viewport2d";
import { useAppStore } from "../../store";
import { TooltipProvider } from "../ui/tooltip";
import { ElevationView } from "./ElevationView";

// Wall names are free text now that the inspector and the rooms panel can edit
// them, so the elevation's own header has to hold a long one without pushing
// the chip across the canvas.
const LONG_WALL_NAME = "Long wall beside the freight elevator and loading dock";

class MockResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 1000, height: 600 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAppStore.setState(initialStoreState, true);
});

describe("elevation header with a long wall name", () => {
  it("renders the whole name in the chip's truncating slot", () => {
    const project = createSampleProject();
    useAppStore.setState({ project });
    const wall = getWallsWithGeometry(project.floor.rooms[0]!.room)[0]!;

    const { container } = render(
      <TooltipProvider>
        <ElevationView
          artworksById={new Map()}
          centerlineMm={project.defaultCenterlineHeightMm}
          gridPrecisionFloorMm={null}
          gridVisible={false}
          snapToGrid={false}
          unit="ft"
          wallHeightMm={wall.heightMm}
          wallId={wall.id}
          wallLengthMm={wall.lengthMm}
          wallName={LONG_WALL_NAME}
          viewport={FIT_VIEWPORT}
          onViewportChange={() => {}}
        />
      </TooltipProvider>
    );

    // Nothing is dropped from the DOM — the truncation is CSS, so the full name
    // stays available to screen readers and to the browser's own tooltip.
    const name = container.querySelector(".surface-label strong");
    expect(name?.textContent).toBe(LONG_WALL_NAME);
    // The dimensions line still renders beside it rather than being displaced.
    expect(container.querySelector(".surface-label > span")?.textContent).toMatch(
      /by/
    );
  });

  // jsdom applies no stylesheet, so the rule itself is the thing to assert:
  // without it the chip grows to the name's full width across the canvas.
  it("keeps the chip's name slot clipped to one ellipsized line", () => {
    const css = readFileSync("src/styles/global.css", "utf8");
    const rule = css.slice(
      css.indexOf(".surface-label strong {"),
      css.indexOf("}", css.indexOf(".surface-label strong {"))
    );

    expect(rule).toContain("text-overflow: ellipsis");
    expect(rule).toContain("white-space: nowrap");
    expect(rule).toContain("overflow: hidden");
    expect(rule).toMatch(/max-width:/);
  });
});
