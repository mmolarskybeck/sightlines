import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { FIT_VIEWPORT } from "../../../domain/viewport/viewport2d";
import { useAppStore } from "../../store";
import { TooltipProvider } from "../ui/tooltip";
import { PlanView } from "./PlanView";

// Covers the plan background pointerdown branch (beginMarquee): a ⌘/Ctrl
// primary press pans instead of marqueeing (the modifier-click sibling of
// Space/middle-mouse pan), while a plain or Shift press still starts a marquee.

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

function renderPlan(overrides: {
  onViewportChange?: (v: unknown) => void;
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
}) {
  return render(
    <TooltipProvider>
      <PlanView
        activeTool={null}
        gridPrecisionFloorMm={null}
        gridVisible={false}
        selectedWallId={null}
        snapToGrid={false}
        viewport={FIT_VIEWPORT}
        onToolChange={() => {}}
        onViewportChange={overrides.onViewportChange ?? (() => {})}
        onMarqueeSelect={overrides.onMarqueeSelect ?? (() => {})}
        selectedObjectIds={[]}
      />
    </TooltipProvider>
  );
}

describe("PlanView — background pan vs marquee", () => {
  it("⌘-background press pans (no marquee) and moves the viewport on pointermove", () => {
    useAppStore.setState({ project: createSampleProject() });
    const onViewportChange = vi.fn();
    const { container } = renderPlan({ onViewportChange });
    const svg = container.querySelector("svg.plan-svg")!;

    act(() => {
      fireEvent.pointerDown(svg, { metaKey: true, button: 0, clientX: 100, clientY: 100 });
    });
    // The pan claim starts no marquee.
    expect(container.querySelector(".marquee-rect")).toBeNull();

    act(() => {
      window.dispatchEvent(
        new MockPointerEvent("pointermove", { clientX: 160, clientY: 120 })
      );
    });
    expect(onViewportChange).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new MockPointerEvent("pointerup", {}));
    });
    // Still no marquee ever appeared.
    expect(container.querySelector(".marquee-rect")).toBeNull();
  });

  it("plain background press starts a marquee", () => {
    useAppStore.setState({ project: createSampleProject() });
    const { container } = renderPlan({});
    const svg = container.querySelector("svg.plan-svg")!;

    act(() => {
      fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 100 });
    });
    expect(container.querySelector(".marquee-rect")).not.toBeNull();
  });

  it("Shift-background drag still marquees additively", () => {
    useAppStore.setState({ project: createSampleProject() });
    const onMarqueeSelect = vi.fn();
    const { container } = renderPlan({ onMarqueeSelect });
    const svg = container.querySelector("svg.plan-svg")!;

    act(() => {
      fireEvent.pointerDown(svg, { shiftKey: true, button: 0, clientX: 100, clientY: 100 });
    });
    // Shift is the additive marquee, never a pan.
    expect(container.querySelector(".marquee-rect")).not.toBeNull();

    // Separate flushes: the move must commit to the drag state before the
    // release reads it, or onRelease would still see a zero-size marquee.
    act(() => {
      window.dispatchEvent(
        new MockPointerEvent("pointermove", { shiftKey: true, clientX: 200, clientY: 180 })
      );
    });
    act(() => {
      window.dispatchEvent(new MockPointerEvent("pointerup", { shiftKey: true }));
    });
    // Additive flag (2nd arg) is carried from the release event's shiftKey.
    expect(onMarqueeSelect).toHaveBeenCalled();
    expect(onMarqueeSelect.mock.calls[0][1]).toBe(true);
  });
});
