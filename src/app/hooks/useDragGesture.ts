import { useEffect, useRef, useState, type RefObject } from "react";

// Shared pointer-drag lifecycle. Window listeners subscribe once per gesture;
// refs keep state and handlers fresh without resubscribing on every move.
// Pointerup and pointercancel both release once. Callers own commit policy.
export function useDragGesture<S>(handlers: {
  // Return the next state, or null to ignore this move.
  onMove: (current: S, event: PointerEvent) => S | null;
  // Called once after the drag state is cleared.
  onRelease: (final: S, event: PointerEvent) => void;
}): {
  // Live render state; null between gestures.
  drag: S | null;
  // Fresh state for event handlers and pinch-blocking checks.
  dragRef: RefObject<S | null>;
  beginDrag: (initial: S) => void;
  isDragging: boolean;
} {
  const [drag, setDrag] = useState<S | null>(null);

  // Assigned during render so window handlers always read the latest state.
  const dragRef = useRef<S | null>(null);
  dragRef.current = drag;

  // Callers pass fresh closures; listeners read them through stable refs.
  const onMoveRef = useRef(handlers.onMove);
  onMoveRef.current = handlers.onMove;
  const onReleaseRef = useRef(handlers.onRelease);
  onReleaseRef.current = handlers.onRelease;

  // Some devices deliver duplicate end events before React removes listeners.
  const releasedRef = useRef(false);

  const isDragging = drag !== null;

  function beginDrag(initial: S) {
    releasedRef.current = false;
    // Set eagerly in case a move precedes the next render.
    dragRef.current = initial;
    setDrag(initial);
  }

  // Key on active state, never the per-move drag value.
  useEffect(() => {
    if (!isDragging) return;

    function onPointerMove(event: PointerEvent) {
      const current = dragRef.current;
      if (!current || releasedRef.current) return;
      const next = onMoveRef.current(current, event);
      if (next === null) return;
      // A racing move must not revive a released drag.
      setDrag((prev) => (prev === null ? null : next));
    }

    function onPointerUp(event: PointerEvent) {
      const current = dragRef.current;
      if (!current || releasedRef.current) return;
      releasedRef.current = true;
      setDrag(null);
      onReleaseRef.current(current, event);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [isDragging]);

  return { drag, dragRef, beginDrag, isDragging };
}
