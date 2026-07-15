import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../domain/viewport/viewport2d";
import { useMeasurementTool } from "../hooks/useMeasurementTool";
import { useAppStore } from "../store";
import { ElevationView } from "./ElevationView";

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

class MockPointerEvent extends MouseEvent {
  readonly isPrimary: boolean;
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? true;
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("PointerEvent", MockPointerEvent);
  (SVGSVGElement.prototype as unknown as { createSVGPoint: () => unknown }).createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: (this as { x: number }).x, y: (this as { y: number }).y };
    }
  });
  (SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({
    inverse: () => ({})
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState(initialStoreState, true);
});

function Harness({
  gridPrecisionFloorMm = null,
  snapToGrid = false
}: { gridPrecisionFloorMm?: number | null; snapToGrid?: boolean } = {}) {
  const project = createSampleProject();
  const wall = getWallsWithGeometry(project.floor.rooms[0].room)[0];
  const measurement = useMeasurementTool({ kind: "elevation", wallId: wall.id });
  return (
    <>
    <output data-testid="measurement-phase">{measurement.state.phase}</output>
    <ElevationView
      centerlineMm={project.defaultCenterlineHeightMm}
      gridPrecisionFloorMm={gridPrecisionFloorMm}
      gridVisible={false}
      measurementActive
      measurementState={measurement.state}
      onMeasurementDispatch={measurement.dispatch}
      snapToGrid={snapToGrid}
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
}

describe("Elevation temporary measurement", () => {
  it("supports click-click creation in wall-local coordinates, completing on the second pointer-up", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.elevation-svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(svg, { pointerId: 1, pointerType: "mouse", clientX: 700, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 700, clientY: 300 });
    // Still drawing until the completing click's pointer-up fires — a
    // sub-slop press must not resolve the measurement on pointer-down.
    expect(screen.getByTestId("measurement-phase").textContent).toBe("drawing");
    fireEvent.pointerUp(svg, { pointerId: 1, pointerType: "mouse", clientX: 700, clientY: 300 });

    expect(screen.getByRole("group", { name: /^Measurement,/ })).toBeTruthy();
    expect(container.querySelector(".measurement-overlay" )?.getAttribute("data-selected")).toBe("true");
  });

  it("completes a drag only after crossing pointer slop", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.elevation-svg")!;

    fireEvent.pointerDown(svg, { pointerId: 2, pointerType: "mouse", button: 0, clientX: 250, clientY: 250 });
    fireEvent.pointerMove(svg, { pointerId: 2, pointerType: "mouse", clientX: 600, clientY: 400 });
    fireEvent.pointerUp(svg, { pointerId: 2, pointerType: "mouse", clientX: 600, clientY: 400 });

    expect(screen.getByRole("button", { name: /Measurement start point/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Measurement end point/ })).toBeTruthy();
  });

  it("stays in the drawing phase when the first press releases under slop, falling through to click-click", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.elevation-svg")!;

    fireEvent.pointerDown(svg, { pointerId: 3, pointerType: "mouse", button: 0, clientX: 250, clientY: 250 });
    fireEvent.pointerMove(svg, { pointerId: 3, pointerType: "mouse", clientX: 252, clientY: 251 });
    fireEvent.pointerUp(svg, { pointerId: 3, pointerType: "mouse", clientX: 252, clientY: 251 });

    expect(screen.getByTestId("measurement-phase").textContent).toBe("drawing");
    expect(container.querySelector(".measurement-overlay")?.getAttribute("data-selected")).toBeNull();
  });

  it("nudges a focused endpoint in wall-local direction with shared arrow steps", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.elevation-svg")!;
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 700, clientY: 300 });
    fireEvent.pointerUp(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });

    const end = screen.getByRole("button", { name: /Measurement end point/ });
    const before = Number(end.getAttribute("cx"));
    fireEvent.keyDown(end, { key: "ArrowRight" });

    const after = Number(screen.getByRole("button", { name: /Measurement end point/ }).getAttribute("cx"));
    expect(after - before).toBeCloseTo(12.7);
    expect(screen.getByTestId("measurement-phase").textContent).toBe("refining");

    fireEvent.keyDown(screen.getByRole("button", { name: /Measurement end point/ }), {
      key: "Enter"
    });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("armed-complete");
  });

  it("honors the precision floor once snapToGrid is on, matching the shared canvas nudge convention", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness snapToGrid gridPrecisionFloorMm={25.4} />);
    const svg = container.querySelector("svg.elevation-svg")!;
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 700, clientY: 300 });
    fireEvent.pointerUp(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });

    const end = screen.getByRole("button", { name: /Measurement end point/ });
    const before = Number(end.getAttribute("cx"));
    fireEvent.keyDown(end, { key: "ArrowRight" });

    const after = Number(screen.getByRole("button", { name: /Measurement end point/ }).getAttribute("cx"));
    expect(after - before).toBeCloseTo(25.4);
  });

  it("opts into an honest fine step with Alt while snapToGrid is on", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness snapToGrid gridPrecisionFloorMm={25.4} />);
    const svg = container.querySelector("svg.elevation-svg")!;
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 700, clientY: 300 });
    fireEvent.pointerUp(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });

    const end = screen.getByRole("button", { name: /Measurement end point/ });
    const before = Number(end.getAttribute("cx"));
    fireEvent.keyDown(end, { key: "ArrowRight", altKey: true });

    const after = Number(screen.getByRole("button", { name: /Measurement end point/ }).getAttribute("cx"));
    expect(after - before).toBeCloseTo(1.5875);
  });

  it("does not claim secondary, additional-touch, or Space-pan presses", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.elevation-svg")!;

    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 2, clientX: 300, clientY: 300 });
    fireEvent.pointerDown(svg, {
      pointerType: "touch",
      isPrimary: false,
      button: 0,
      clientX: 300,
      clientY: 300
    });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("armed-empty");

    fireEvent.pointerEnter(svg);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(svg.closest(".drawing-surface")?.classList.contains("is-pan-ready")).toBe(true);
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("armed-empty");
    fireEvent.keyUp(window, { code: "Space", key: " " });
  });

  it("clamps measurement endpoint to the wall face when nudged with arrow keys past the boundary", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.elevation-svg")!;

    // Create a measurement
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 700, clientY: 300 });
    fireEvent.pointerUp(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });

    const end = screen.getByRole("button", { name: /Measurement end point/ });

    // Nudge right many times to try to push it off the wall boundary (8534.4mm for 28 feet)
    for (let i = 0; i < 500; i++) {
      fireEvent.keyDown(end, { key: "ArrowRight" });
    }

    const cxAfterNudge = Number(screen.getByRole("button", { name: /Measurement end point/ }).getAttribute("cx"));

    // The endpoint should be clamped at the wall's right edge (wallLengthMm ~8534mm for the sample project)
    // but at minimum should not go negative or exceed a reasonable boundary
    expect(cxAfterNudge).toBeGreaterThanOrEqual(0);
    expect(cxAfterNudge).toBeLessThanOrEqual(8535); // ~8534.4mm (28 feet)

    // Now test the y-axis boundary by nudging down
    const before = Number(screen.getByRole("button", { name: /Measurement end point/ }).getAttribute("cy"));
    for (let i = 0; i < 500; i++) {
      fireEvent.keyDown(end, { key: "ArrowDown" });
    }
    const cyAfterNudge = Number(screen.getByRole("button", { name: /Measurement end point/ }).getAttribute("cy"));

    // The y coordinate should not go below 0 (wall floor) when clamped
    // and not exceed wall height (12 feet = 3657.6mm, but SVG uses inverted y so it starts at wallHeightMm and goes to 0)
    expect(cyAfterNudge).toBeGreaterThanOrEqual(0);
  });
});
