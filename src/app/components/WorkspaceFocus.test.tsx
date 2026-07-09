import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../domain/viewport/viewport2d";
import { ElevationView } from "./ElevationView";
import { PlanView } from "./PlanView";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("workspace focus handoff", () => {
  it("focuses the plan workspace on pointer down", async () => {
    const project = createSampleProject();
    const { container } = render(
      <>
        <button type="button">Focused control</button>
        <PlanView
          activeTool={null}
          gridPrecisionFloorMm={null}
          gridVisible={false}
          project={project}
          selectedWallId={null}
          snapToGrid={false}
          viewport={FIT_VIEWPORT}
          onCommitWallLength={async () => {}}
          onToolChange={() => {}}
          onViewportChange={() => {}}
        />
      </>
    );

    const button = container.querySelector("button");
    const svg = container.querySelector("svg.plan-svg");
    expect(button).not.toBeNull();
    expect(svg).not.toBeNull();

    button!.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.pointerDown(svg!, { pointerType: "mouse", button: 0 });
    expect(document.activeElement).toBe(svg);
  });

  it("focuses the elevation workspace on pointer down", async () => {
    const project = createSampleProject();
    const wall = getWallsWithGeometry(project.floor.rooms[0].room)[0];
    const { container } = render(
      <>
        <button type="button">Focused control</button>
        <ElevationView
          centerlineMm={project.defaultCenterlineHeightMm}
          gridPrecisionFloorMm={null}
          gridVisible={false}
          unit={project.unit}
          wallHeightMm={wall.heightMm}
          wallId={wall.id}
          wallLengthMm={wall.lengthMm}
          wallName={wall.name}
          wallObjects={[]}
          viewport={FIT_VIEWPORT}
          onViewportChange={() => {}}
        />
      </>
    );

    const button = container.querySelector("button");
    const svg = container.querySelector("svg.elevation-svg");
    expect(button).not.toBeNull();
    expect(svg).not.toBeNull();

    button!.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.pointerDown(svg!, { pointerType: "mouse", button: 0 });
    expect(document.activeElement).toBe(svg);
  });
});
