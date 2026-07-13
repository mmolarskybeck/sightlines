import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../domain/viewport/viewport2d";
import { useAppStore } from "../store";
import { ElevationView } from "./ElevationView";
import { PlanView } from "./PlanView";
import { TooltipProvider } from "./ui/tooltip";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// PlanView/ElevationView now read their store passthroughs (project,
// wallObjects, the select/commit actions) straight from the singleton store
// instead of from props, so each case seeds the store with the sample project
// before rendering and restores the pristine state afterward.
const initialStoreState = useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  // jsdom implements no SVG geometry. The marquee pointer-down path is now
  // reachable in these renders (the store-connected clear/marquee actions are
  // always present, where the old props were absent-and-inert), so give
  // createSVGPoint/getScreenCTM harmless stubs: toSvgPoint resolves to null and
  // beginMarquee no-ops, leaving the focus handoff under test intact instead of
  // throwing on the missing createSVGPoint.
  (SVGSVGElement.prototype as unknown as { createSVGPoint: () => unknown }).createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform: () => ({ x: 0, y: 0 })
  });
  (SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAppStore.setState(initialStoreState, true);
});

describe("workspace focus handoff", () => {
  it("focuses the plan workspace on pointer down", async () => {
    const project = createSampleProject();
    useAppStore.setState({ project });
    const { container } = render(
      <>
        <button type="button">Focused control</button>
        <PlanView
          activeTool={null}
          gridPrecisionFloorMm={null}
          gridVisible={false}
          selectedWallId={null}
          snapToGrid={false}
          viewport={FIT_VIEWPORT}
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
    useAppStore.setState({ project });
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

  it("moves focus between wall step buttons when the opposite arrow key is pressed", () => {
    const project = createSampleProject();
    useAppStore.setState({ project });
    const roomPlacement = project.floor.rooms[0];
    const roomWalls = getWallsWithGeometry(roomPlacement.room);
    const wall = roomWalls[0];
    const walls = roomWalls.slice(0, 2).map((entry) => ({
      ...entry,
      roomId: roomPlacement.roomId,
      roomName: roomPlacement.room.name,
      kind: "perimeter" as const
    }));

    render(
      <TooltipProvider>
        <ElevationView
          centerlineMm={project.defaultCenterlineHeightMm}
          gridPrecisionFloorMm={null}
          gridVisible={false}
          unit={project.unit}
          wallHeightMm={wall.heightMm}
          wallId={wall.id}
          wallLengthMm={wall.lengthMm}
          wallName={wall.name}
          walls={walls}
          viewport={FIT_VIEWPORT}
          onViewportChange={() => {}}
        />
      </TooltipProvider>
    );

    const previous = screen.getByRole("button", { name: "Previous wall" });
    const next = screen.getByRole("button", { name: "Next wall" });
    const selector = screen.getByRole("button", { name: /Change wall/ });

    previous.focus();
    fireEvent.keyDown(previous, { key: "ArrowLeft" });
    expect(previous).toHaveFocus();

    fireEvent.keyDown(previous, { key: "ArrowRight" });
    expect(next).toHaveFocus();

    fireEvent.keyDown(next, { key: "ArrowRight" });
    expect(next).toHaveFocus();

    fireEvent.keyDown(next, { key: "ArrowLeft" });
    expect(previous).toHaveFocus();

    selector.focus();
    fireEvent.keyDown(selector, { key: "ArrowRight" });
    expect(selector).toHaveFocus();
  });
});
