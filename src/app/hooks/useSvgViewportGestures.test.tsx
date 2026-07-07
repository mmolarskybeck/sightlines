import { useRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TOUCH_TAP_SLOP_PX,
  useSvgViewportGestures,
  type ViewportGestureEnd
} from "./useSvgViewportGestures";
import {
  clampZoom,
  FIT_VIEWPORT,
  PLAN_ZOOM_LIMITS,
  type Size,
  type ViewBox,
  type Viewport2D,
  type ZoomLimits
} from "../../domain/viewport/viewport2d";

// jsdom has no PointerEvent constructor (probed: undefined), so window pointer
// events are synthesized as plain Events with the fields the handlers read.
function pointerEvent(type: string, props: Record<string, unknown>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

// The React SyntheticPointerEvent the capture handler consumes — only the
// fields the handler touches, plus spy-able preventDefault/stopPropagation.
function reactPointer(props: Record<string, unknown> = {}) {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    pointerType: "mouse",
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    ...props
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const DEFAULT_BOUNDS: ViewBox = { x: 0, y: 0, width: 1000, height: 1000 };
const DEFAULT_SIZE: Size = { width: 800, height: 600 };

type Options = {
  viewport: Viewport2D;
  onViewportChange?: (v: Viewport2D) => void;
  contentBounds?: ViewBox;
  containerSize?: Size;
  zoomLimits?: ZoomLimits;
  isPinchBlocked?: () => boolean;
  onGestureEnd?: (info: ViewportGestureEnd) => void;
};

type Api = ReturnType<typeof useSvgViewportGestures>;

// Renders the hook in a real component with a real <svg> so svgRef is wired,
// exposing the latest hook return and the svg element to the test.
function renderGestures(opts: Options) {
  const holder: { api: Api | null; svg: SVGSVGElement | null } = { api: null, svg: null };

  function Harness() {
    const svgRef = useRef<SVGSVGElement | null>(null);
    holder.api = useSvgViewportGestures({
      svgRef,
      viewport: opts.viewport,
      onViewportChange: opts.onViewportChange ?? (() => {}),
      contentBounds: opts.contentBounds ?? DEFAULT_BOUNDS,
      containerSize: opts.containerSize ?? DEFAULT_SIZE,
      zoomLimits: opts.zoomLimits ?? PLAN_ZOOM_LIMITS,
      isPinchBlocked: opts.isPinchBlocked,
      onGestureEnd: opts.onGestureEnd
    });
    return (
      <svg
        ref={(el) => {
          svgRef.current = el;
          holder.svg = el;
        }}
        data-testid="svg"
      />
    );
  }

  const utils = render(<Harness />);
  return { holder, ...utils };
}

// Give the svg element working createSVGPoint/getScreenCTM so toSvgPoint can
// exercise its anchor math (both are undefined in jsdom). matrixTransform
// applies a fixed translate so the result is easy to assert against.
function mockCtm(svg: SVGSVGElement, translate = { x: -5, y: -7 }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svg as any).createSVGPoint = () => {
    const p = {
      x: 0,
      y: 0,
      matrixTransform: () => ({ x: p.x + translate.x, y: p.y + translate.y })
    };
    return p;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svg as any).getScreenCTM = () => ({ inverse: () => ({}) });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useSvgViewportGestures — Space / ⌘0 keyboard", () => {
  it("Space keydown sets isSpaceDown; keyup and window blur clear it", () => {
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT });
    expect(holder.api!.isSpaceDown).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", cancelable: true }));
    });
    expect(holder.api!.isSpaceDown).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
    });
    expect(holder.api!.isSpaceDown).toBe(false);

    // Re-arm, then blur.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", cancelable: true }));
    });
    expect(holder.api!.isSpaceDown).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(holder.api!.isSpaceDown).toBe(false);
  });

  it("Space is ignored when the target is an editable element", () => {
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT });
    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }));
    });
    expect(holder.api!.isSpaceDown).toBe(false);
  });

  it("Space is ignored when the target is a button", () => {
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT });
    const button = document.createElement("button");
    document.body.appendChild(button);

    act(() => {
      button.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }));
    });
    expect(holder.api!.isSpaceDown).toBe(false);
  });

  it("⌘0 resets to fit and prevents default", () => {
    const onViewportChange = vi.fn();
    renderGestures({ viewport: { mode: "manual", centerXMm: 5, centerYMm: 5, zoom: 4 }, onViewportChange });

    const event = new KeyboardEvent("keydown", { key: "0", metaKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(onViewportChange).toHaveBeenCalledWith(FIT_VIEWPORT);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+0 also resets to fit", () => {
    const onViewportChange = vi.fn();
    renderGestures({ viewport: { mode: "manual", centerXMm: 5, centerYMm: 5, zoom: 4 }, onViewportChange });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", ctrlKey: true, cancelable: true }));
    });
    expect(onViewportChange).toHaveBeenCalledWith(FIT_VIEWPORT);
  });
});

describe("useSvgViewportGestures — mouse pan", () => {
  it("middle-button press claims a pan, window move pans, up ends it via onGestureEnd", () => {
    const onViewportChange = vi.fn();
    const onGestureEnd = vi.fn();
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange, onGestureEnd });

    let claimed = false;
    const down = reactPointer({ button: 1, pointerType: "mouse", clientX: 100, clientY: 100 });
    act(() => {
      claimed = holder.api!.handlePointerDownCapture(down);
    });
    expect(claimed).toBe(true);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(down.stopPropagation).toHaveBeenCalled();
    expect(holder.api!.panning).toBe(true);

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 150, clientY: 130 }));
    });
    expect(onViewportChange).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", {}));
    });
    expect(holder.api!.panning).toBe(false);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(onGestureEnd.mock.calls[0][0]).toMatchObject({ kind: "mouse-pan", movedPx: 0, isTap: false });
  });

  it("an ordinary left press with space up is not claimed", () => {
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT });
    let claimed = true;
    act(() => {
      claimed = holder.api!.handlePointerDownCapture(reactPointer({ button: 0, pointerType: "mouse" }));
    });
    expect(claimed).toBe(false);
    expect(holder.api!.panning).toBe(false);
  });
});

describe("useSvgViewportGestures — pinch claim", () => {
  it("the second of two touches claims the gesture (returns true, consumes)", () => {
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT });

    let firstClaimed = true;
    act(() => {
      firstClaimed = holder.api!.handlePointerDownCapture(
        reactPointer({ pointerType: "touch", pointerId: 1, clientX: 0, clientY: 0 })
      );
    });
    expect(firstClaimed).toBe(false); // first finger only does bookkeeping

    const second = reactPointer({ pointerType: "touch", pointerId: 2, clientX: 100, clientY: 0 });
    let secondClaimed = false;
    act(() => {
      secondClaimed = holder.api!.handlePointerDownCapture(second);
    });
    expect(secondClaimed).toBe(true);
    expect(second.preventDefault).toHaveBeenCalled();
    expect(second.stopPropagation).toHaveBeenCalled();
  });

  it("when isPinchBlocked() is true the 2nd finger is still consumed but starts no pinch", () => {
    // NOTE: the API brief's test text says a blocked pinch returns false, but the
    // actual PlanView/ElevationView code ALWAYS preventDefaults+stopPropagates the
    // 2nd finger (to block the object under it from starting a competing drag) and
    // only gates beginPinch on the block. Behavior-preserving extraction keeps that:
    // consumed (returns true) but no pinch — verified here by the absence of any
    // onViewportChange when the fingers then move.
    const onViewportChange = vi.fn();
    const { holder } = renderGestures({
      viewport: FIT_VIEWPORT,
      onViewportChange,
      isPinchBlocked: () => true
    });

    act(() => {
      holder.api!.handlePointerDownCapture(
        reactPointer({ pointerType: "touch", pointerId: 1, clientX: 0, clientY: 0 })
      );
    });
    const second = reactPointer({ pointerType: "touch", pointerId: 2, clientX: 100, clientY: 0 });
    let secondClaimed = false;
    act(() => {
      secondClaimed = holder.api!.handlePointerDownCapture(second);
    });
    // Consumed (finger blocked) even though the pinch itself is suppressed.
    expect(secondClaimed).toBe(true);
    expect(second.preventDefault).toHaveBeenCalled();

    // No pinch began → moving the two fingers changes nothing.
    onViewportChange.mockClear();
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 }));
      window.dispatchEvent(pointerEvent("pointermove", { pointerType: "touch", pointerId: 2, clientX: 200, clientY: 10 }));
    });
    expect(onViewportChange).not.toHaveBeenCalled();
  });
});

describe("useSvgViewportGestures — touch pan (beginTouchPan)", () => {
  function startBackgroundTouch(holder: { api: Api | null }) {
    act(() => {
      holder.api!.handlePointerDownCapture(
        reactPointer({ pointerType: "touch", pointerId: 1, clientX: 50, clientY: 50 })
      );
    });
    // The view calls beginTouchPan from its bubble-phase background pointerdown.
    holder.api!.beginTouchPan(50, 50);
  }

  it("move beyond slop then release reports a non-tap background pan", () => {
    const onViewportChange = vi.fn();
    const onGestureEnd = vi.fn();
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange, onGestureEnd });

    startBackgroundTouch(holder);

    act(() => {
      // dx = 40 > TOUCH_TAP_SLOP_PX
      window.dispatchEvent(
        pointerEvent("pointermove", { pointerType: "touch", pointerId: 1, clientX: 90, clientY: 50 })
      );
    });
    expect(onViewportChange).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 1 }));
    });
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    const info = onGestureEnd.mock.calls[0][0] as ViewportGestureEnd;
    expect(info.kind).toBe("touch");
    expect(info.isTap).toBe(false);
    expect(info.startedOnBackground).toBe(true);
    expect(info.movedPx).toBeGreaterThan(TOUCH_TAP_SLOP_PX);
  });

  it("a stationary release reports a background tap", () => {
    const onGestureEnd = vi.fn();
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT, onGestureEnd });

    startBackgroundTouch(holder);

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 1 }));
    });
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    const info = onGestureEnd.mock.calls[0][0] as ViewportGestureEnd;
    expect(info).toMatchObject({ kind: "touch", isTap: true, startedOnBackground: true, movedPx: 0 });
  });

  it("a 3rd-finger beginTouchPan during a live pinch is a no-op (pinch survives)", () => {
    const onViewportChange = vi.fn();
    const onGestureEnd = vi.fn();
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange, onGestureEnd });
    mockCtm(holder.svg!);

    // Two fingers → live pinch.
    act(() => {
      holder.api!.handlePointerDownCapture(
        reactPointer({ pointerType: "touch", pointerId: 1, clientX: 0, clientY: 0 })
      );
    });
    act(() => {
      holder.api!.handlePointerDownCapture(
        reactPointer({ pointerType: "touch", pointerId: 2, clientX: 100, clientY: 0 })
      );
    });

    // A 3rd finger lands on true background: the capture handler only does
    // bookkeeping (returns false, no stopPropagation), so the view's
    // bubble-phase background handler fires and calls beginTouchPan
    // unconditionally. The internal guard must ignore it.
    let thirdClaimed = true;
    act(() => {
      thirdClaimed = holder.api!.handlePointerDownCapture(
        reactPointer({ pointerType: "touch", pointerId: 3, clientX: 200, clientY: 200 })
      );
    });
    expect(thirdClaimed).toBe(false);
    holder.api!.beginTouchPan(200, 200);

    // The pinch still owns the gesture: spreading the two pinch fingers keeps
    // firing viewport changes...
    onViewportChange.mockClear();
    act(() => {
      window.dispatchEvent(
        pointerEvent("pointermove", { pointerType: "touch", pointerId: 2, clientX: 150, clientY: 0 })
      );
    });
    expect(onViewportChange).toHaveBeenCalled();

    // ...and the release reports NO background pan-start — had beginTouchPan
    // hijacked the pinch as a pan, startedOnBackground would be true here.
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 1 }));
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 2 }));
      window.dispatchEvent(pointerEvent("pointerup", { pointerType: "touch", pointerId: 3 }));
    });
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    const info = onGestureEnd.mock.calls[0][0] as ViewportGestureEnd;
    expect(info.startedOnBackground).toBe(false);
    expect(info.isTap).toBe(false);
  });
});

describe("useSvgViewportGestures — zoom affordances (real math)", () => {
  it("canZoomIn is false at the effective max zoom, true at min", () => {
    const limits = PLAN_ZOOM_LIMITS;
    const effMax = clampZoom(1e9, DEFAULT_BOUNDS, DEFAULT_SIZE, limits);
    const effMin = clampZoom(0, DEFAULT_BOUNDS, DEFAULT_SIZE, limits);

    const atMax = renderGestures({
      viewport: { mode: "manual", centerXMm: 500, centerYMm: 500, zoom: effMax }
    });
    expect(atMax.holder.api!.canZoomIn).toBe(false);
    expect(atMax.holder.api!.canZoomOut).toBe(true);

    const atMin = renderGestures({
      viewport: { mode: "manual", centerXMm: 500, centerYMm: 500, zoom: effMin }
    });
    expect(atMin.holder.api!.canZoomOut).toBe(false);
    expect(atMin.holder.api!.canZoomIn).toBe(true);
  });
});

describe("useSvgViewportGestures — toSvgPoint", () => {
  it("returns null when getScreenCTM is unavailable (jsdom / pre-layout)", () => {
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT });
    // createSVGPoint present but getScreenCTM returns null → the null branch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (holder.svg as any).createSVGPoint = () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (holder.svg as any).getScreenCTM = () => null;
    expect(holder.api!.toSvgPoint(10, 20)).toBeNull();
  });

  it("returns the CTM-inverse-transformed userspace point when the CTM is available", () => {
    const { holder } = renderGestures({ viewport: FIT_VIEWPORT });
    mockCtm(holder.svg!, { x: -5, y: -7 });
    expect(holder.api!.toSvgPoint(100, 50)).toEqual({ xMm: 95, yMm: 43 });
  });
});
