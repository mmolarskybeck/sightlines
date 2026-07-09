import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDragGesture } from "./useDragGesture";

// jsdom has no PointerEvent constructor, so window pointer events are
// synthesized as plain Events carrying the fields the handlers read — the same
// approach useSvgViewportGestures.test.tsx uses.
function pointerEvent(type: string, props: Record<string, unknown> = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

// A minimal drag state for the tests: a point that a move slides around.
type DragState = { startX: number; x: number };

type Handlers = {
  onMove?: (current: DragState, event: PointerEvent) => DragState | null;
  onRelease?: (final: DragState, event: PointerEvent) => void;
};

type Api = ReturnType<typeof useDragGesture<DragState>>;

// Renders the hook in a real component, exposing the latest return value and a
// begin() helper to the test. Handlers default to a plain "track clientX" move
// and a spy-friendly release.
function renderDrag(handlers: Handlers = {}) {
  const holder: { api: Api | null } = { api: null };

  function Harness() {
    holder.api = useDragGesture<DragState>({
      onMove:
        handlers.onMove ??
        ((current, event) => ({ ...current, x: (event as PointerEvent).clientX })),
      onRelease: handlers.onRelease ?? (() => {})
    });
    return null;
  }

  const utils = render(<Harness />);
  return { holder, ...utils };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useDragGesture", () => {
  it("starts idle and flips to dragging on beginDrag", () => {
    const { holder } = renderDrag();
    expect(holder.api!.drag).toBeNull();
    expect(holder.api!.isDragging).toBe(false);
    expect(holder.api!.dragRef.current).toBeNull();

    act(() => {
      holder.api!.beginDrag({ startX: 10, x: 10 });
    });
    expect(holder.api!.drag).toEqual({ startX: 10, x: 10 });
    expect(holder.api!.isDragging).toBe(true);
    // The mirror ref is live for the external isPinchBlocked read.
    expect(holder.api!.dragRef.current).toEqual({ startX: 10, x: 10 });
  });

  it("pointermove applies the state onMove returns", () => {
    const { holder } = renderDrag();
    act(() => {
      holder.api!.beginDrag({ startX: 10, x: 10 });
    });

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 42 }));
    });
    expect(holder.api!.drag).toEqual({ startX: 10, x: 42 });
    expect(holder.api!.dragRef.current).toEqual({ startX: 10, x: 42 });
  });

  it("onMove sees the LIVE state each move (no stale closure across moves)", () => {
    // A move that accumulates onto the current state proves the handler reads
    // the freshly-applied state, not the state captured at subscribe time.
    const { holder } = renderDrag({
      onMove: (current, event) => ({ ...current, x: current.x + (event as PointerEvent).clientX })
    });
    act(() => {
      holder.api!.beginDrag({ startX: 0, x: 0 });
    });

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 5 }));
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 3 }));
    });
    expect(holder.api!.drag).toEqual({ startX: 0, x: 8 });
  });

  it("returning null from onMove makes no change", () => {
    const onMove = vi.fn((current: DragState, event: PointerEvent) =>
      event.clientX < 0 ? null : { ...current, x: event.clientX }
    );
    const { holder } = renderDrag({ onMove });
    act(() => {
      holder.api!.beginDrag({ startX: 10, x: 10 });
    });

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: -1 }));
    });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(holder.api!.drag).toEqual({ startX: 10, x: 10 }); // unchanged
  });

  it("pointerup commits exactly once with the final state, then clears", () => {
    const onRelease = vi.fn();
    const { holder } = renderDrag({ onRelease });
    act(() => {
      holder.api!.beginDrag({ startX: 10, x: 10 });
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 55 }));
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", {}));
    });

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0][0]).toEqual({ startX: 10, x: 55 });
    expect(holder.api!.drag).toBeNull();
    expect(holder.api!.isDragging).toBe(false);
    expect(holder.api!.dragRef.current).toBeNull();
  });

  it("pointercancel commits through the same path as pointerup", () => {
    const onRelease = vi.fn();
    const { holder } = renderDrag({ onRelease });
    act(() => {
      holder.api!.beginDrag({ startX: 10, x: 10 });
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointercancel", {}));
    });

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0][0]).toEqual({ startX: 10, x: 10 });
    expect(holder.api!.drag).toBeNull();
  });

  it("a pointerup then a pointercancel in the same gesture fires onRelease only once", () => {
    const onRelease = vi.fn();
    const { holder } = renderDrag({ onRelease });
    act(() => {
      holder.api!.beginDrag({ startX: 10, x: 10 });
    });
    // Both dispatched before React re-renders / tears down the listeners.
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", {}));
      window.dispatchEvent(pointerEvent("pointercancel", {}));
    });

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(holder.api!.drag).toBeNull();
  });

  it("a move that races the release cannot resurrect the cleared drag", () => {
    const { holder } = renderDrag();
    act(() => {
      holder.api!.beginDrag({ startX: 10, x: 10 });
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", {}));
      // A stray move arriving in the same tick, before listener teardown.
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 99 }));
    });
    expect(holder.api!.drag).toBeNull();
  });

  it("moves after release do nothing (no commit, no state)", () => {
    const onRelease = vi.fn();
    const { holder } = renderDrag({ onRelease });
    act(() => {
      holder.api!.beginDrag({ startX: 10, x: 10 });
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", {}));
    });
    onRelease.mockClear();
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 200 }));
      window.dispatchEvent(pointerEvent("pointerup", {}));
    });
    expect(holder.api!.drag).toBeNull();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("subscribes window listeners exactly once per gesture — a mid-drag re-render does not resubscribe", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { holder } = renderDrag();

    act(() => {
      holder.api!.beginDrag({ startX: 0, x: 0 });
    });
    const addsAfterBegin = addSpy.mock.calls.filter(([type]) =>
      ["pointermove", "pointerup", "pointercancel"].includes(type as string)
    ).length;
    expect(addsAfterBegin).toBe(3);

    // Several moves each cause a re-render; none may resubscribe.
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 1 }));
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 2 }));
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 3 }));
    });
    const addsAfterMoves = addSpy.mock.calls.filter(([type]) =>
      ["pointermove", "pointerup", "pointercancel"].includes(type as string)
    ).length;
    expect(addsAfterMoves).toBe(3); // still just the one subscription
    const removesAfterMoves = removeSpy.mock.calls.filter(([type]) =>
      ["pointermove", "pointerup", "pointercancel"].includes(type as string)
    ).length;
    expect(removesAfterMoves).toBe(0); // and no teardown yet

    // Release tears the one subscription down exactly once.
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", {}));
    });
    const removesAfterUp = removeSpy.mock.calls.filter(([type]) =>
      ["pointermove", "pointerup", "pointercancel"].includes(type as string)
    ).length;
    expect(removesAfterUp).toBe(3);
  });

  it("onMove/onRelease read the LATEST closures without resubscribing (fresh-handler refs)", () => {
    // Re-render mid-drag with brand-new closures; the live listeners must call
    // the new ones, proving they read through refs and did not resubscribe.
    const holder: { api: Api | null } = { api: null };
    const releaseA = vi.fn();
    const releaseB = vi.fn();

    function Harness({ tag }: { tag: "A" | "B" }) {
      holder.api = useDragGesture<DragState>({
        onMove: (current, event) => ({ ...current, x: (event as PointerEvent).clientX + (tag === "B" ? 1000 : 0) }),
        onRelease: tag === "B" ? releaseB : releaseA
      });
      return null;
    }

    const addSpy = vi.spyOn(window, "addEventListener");
    const { rerender } = render(<Harness tag="A" />);
    act(() => {
      holder.api!.beginDrag({ startX: 0, x: 0 });
    });
    const addsAfterBegin = addSpy.mock.calls.filter(([type]) =>
      ["pointermove", "pointerup", "pointercancel"].includes(type as string)
    ).length;

    // Swap in the "B" closures mid-gesture.
    rerender(<Harness tag="B" />);
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 5 }));
    });
    expect(holder.api!.drag).toEqual({ startX: 0, x: 1005 }); // used B's onMove

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", {}));
    });
    expect(releaseB).toHaveBeenCalledTimes(1); // used B's onRelease
    expect(releaseA).not.toHaveBeenCalled();

    // The re-render swapped handlers without a fresh subscription.
    const addsAfterSwap = addSpy.mock.calls.filter(([type]) =>
      ["pointermove", "pointerup", "pointercancel"].includes(type as string)
    ).length;
    expect(addsAfterSwap).toBe(addsAfterBegin);
  });

  it("unmounting mid-drag removes the window listeners (no leak)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { holder, unmount } = renderDrag();
    act(() => {
      holder.api!.beginDrag({ startX: 0, x: 0 });
    });

    act(() => {
      unmount();
    });
    const removes = removeSpy.mock.calls.filter(([type]) =>
      ["pointermove", "pointerup", "pointercancel"].includes(type as string)
    ).length;
    expect(removes).toBe(3);

    // A pointerup after unmount reaches no handler.
    const onReleaseAfter = vi.fn();
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", {}));
    });
    expect(onReleaseAfter).not.toHaveBeenCalled();
  });
});
