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

function Harness() {
  const project = createSampleProject();
  const wall = getWallsWithGeometry(project.floor.rooms[0].room)[0];
  const measurement = useMeasurementTool({ kind: "elevation", wallId: wall.id });
  return (
    <>
    <output data-testid="measurement-phase">{measurement.state.phase}</output>
    <ElevationView
      centerlineMm={project.defaultCenterlineHeightMm}
      gridPrecisionFloorMm={null}
      gridVisible={false}
      measurementActive
      measurementState={measurement.state}
      onMeasurementDispatch={measurement.dispatch}
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
  it("supports click-click creation in wall-local coordinates", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.elevation-svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(svg, { pointerId: 1, pointerType: "mouse", clientX: 700, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 700, clientY: 300 });

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

  it("nudges a focused endpoint in wall-local direction with shared arrow steps", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.elevation-svg")!;
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(svg, { pointerType: "mouse", clientX: 700, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 700, clientY: 300 });

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
    fireEvent.pointerDown(svg, { pointerType: "mouse", button: 0, clientX: 300, clientY: 300 });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("armed-empty");
    fireEvent.keyUp(window, { code: "Space", key: " " });
  });
});
