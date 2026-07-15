import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import { FIT_VIEWPORT } from "../../domain/viewport/viewport2d";
import { useMeasurementTool } from "../hooks/useMeasurementTool";
import { useAppStore } from "../store";
import { PlanView } from "./PlanView";

class MockResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry],
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
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
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
  cleanup();
  vi.unstubAllGlobals();
  useAppStore.setState(initialStoreState, true);
});

function Harness() {
  const measurement = useMeasurementTool({ kind: "plan" });
  return (
    <>
      <output data-testid="measurement-phase">{measurement.state.phase}</output>
      <PlanView
        activeTool={null}
        gridPrecisionFloorMm={null}
        gridVisible={false}
        measurementActive
        measurementState={
          measurement.state.context.kind === "plan" ? measurement.state : undefined
        }
        onMeasurementAction={measurement.dispatch}
        selectedWallId={null}
        snapToGrid={false}
        viewport={FIT_VIEWPORT}
        onToolChange={() => {}}
        onViewportChange={() => {}}
      />
    </>
  );
}

describe("Plan temporary measurement — keyboard-only creation", () => {
  it("begins at the viewport centre, nudges the preview, and completes with Enter", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.plan-svg")!;

    expect(screen.getByTestId("measurement-phase").textContent).toBe("armed-empty");

    // Enter begins a measurement at the visible-viewport centre.
    fireEvent.keyDown(svg, { key: "Enter" });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("drawing");

    // Arrows nudge the live preview so the two endpoints separate.
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "ArrowDown" });

    // Enter completes; the measurement group and its selected overlay appear
    // and Measure stays armed (armed-complete, not disarmed).
    fireEvent.keyDown(svg, { key: "Enter" });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("armed-complete");
    expect(screen.getByRole("group", { name: /^Measurement,/ })).toBeTruthy();
    expect(container.querySelector(".measurement-overlay")?.getAttribute("data-selected")).toBe(
      "true"
    );
  });

  it("keeps drawing when Enter is pressed on a coincident preview (spec §7.4)", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.plan-svg")!;

    fireEvent.keyDown(svg, { key: "Enter" });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("drawing");

    // No arrow nudge: preview still equals start, so completion is rejected and
    // the tool stays in the drawing phase with endpoint A preserved.
    fireEvent.keyDown(svg, { key: "Enter" });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("drawing");
  });

  it("ignores creation keys bubbling from a focused endpoint handle", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = render(<Harness />);
    const svg = container.querySelector("svg.plan-svg")!;

    // Complete a measurement via the keyboard first.
    fireEvent.keyDown(svg, { key: "Enter" });
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "Enter" });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("armed-complete");

    // Enter on a handle must NOT begin/complete a new measurement — the surface
    // handler yields to the handle's own refinement keys (target !== svg).
    const handle = screen.getByRole("button", { name: /Measurement end point/ });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(screen.getByTestId("measurement-phase").textContent).toBe("armed-complete");
  });
});
