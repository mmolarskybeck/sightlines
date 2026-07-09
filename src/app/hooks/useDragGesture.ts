import { useEffect, useRef, useState, type RefObject } from "react";

// The transient pointer-drag state machine that PlanView (wall-resize, room,
// object/group, vertex, wall-slide, partition, marquee) and ElevationView
// (object/group move, marquee) each hand-rolled once per gesture. Every copy
// followed the identical discipline; this hook is that discipline, extracted so
// each machine collapses to a `useState` shape plus two closures (onMove /
// onRelease). The extraction is behavior-preserving by construction — the effect
// wiring below is a line-for-line transcription of the copies, with two
// deliberate hardenings that only ever help (see onRelease's once-guard and the
// fresh-handler refs).
//
// The discipline it captures (verbatim from the machines):
//   • `useState<S | null>` transient state + a mirrored ref so the once-per-
//     gesture window handlers read the latest state without resubscribing.
//   • an effect keyed on whether a drag is ACTIVE (a boolean), NOT on the state
//     value — the state changes every pointermove, and rekeying on it would tear
//     the window listeners down and back up mid-gesture. Keying on the boolean
//     subscribes exactly once per gesture and cleans up exactly once.
//   • pointermove: recompute the next state from the live ref + event.
//   • pointerup AND pointercancel: commit exactly once, then clear the state.
//     Every hand-rolled copy pointed BOTH events at the same handler — a cancel
//     commits identically to an up, none of them revert — so the hook needs no
//     separate onCancel path. (Verified across all 10 machines before extracting.)
//
// What deliberately stays in CALLER code, inside onRelease: the <0.5mm "a click
// isn't a drag" no-op guard, selection-suppression for the trailing click, and
// the actual commit call. The hook is only the plumbing; the caller owns policy.
export function useDragGesture<S>(handlers: {
  // Called on each window pointermove while a drag is live. Receives the live
  // drag state (read fresh from the mirror ref, never a stale closure) and the
  // raw DOM PointerEvent. Return the NEXT full state to apply, or `null` to make
  // no change this move (the machines' `if (!pointerMm) return` early-outs map
  // straight onto returning `null`). The returned state is applied through a
  // functional updater guarded on the gesture still being live, so a move that
  // races the release can never resurrect a cleared drag.
  onMove: (current: S, event: PointerEvent) => S | null;
  // Called exactly ONCE when the gesture ends, on pointerup or pointercancel,
  // with the final drag state and the ending event. The hook clears the drag
  // state before invoking this, matching the copies' `setX(null)` ordering. Put
  // the no-op guard, selection-suppression, and commit here.
  onRelease: (final: S, event: PointerEvent) => void;
}): {
  // The live drag state for rendering (preview layers, cursor, `if (drag)`
  // guards). `null` between gestures.
  drag: S | null;
  // The same state mirrored into a ref, for reads that must be fresh OUTSIDE a
  // render — every machine's viewport `isPinchBlocked: () => Boolean(dragRef.current)`
  // reads this so a second finger defers to a live single-finger edit.
  dragRef: RefObject<S | null>;
  // Start a gesture. Call from the element's pointerdown with the initial state.
  beginDrag: (initial: S) => void;
  // `drag !== null`, for readability at call sites that only need the boolean.
  isDragging: boolean;
} {
  const [drag, setDrag] = useState<S | null>(null);

  // State mirrored into a ref so the window handlers — subscribed once per
  // gesture — read the latest without resubscribing. Assigned during render (as
  // useSvgViewportGestures does for viewportRef) so it is always at least as
  // fresh as a post-commit effect would make it.
  const dragRef = useRef<S | null>(null);
  dragRef.current = drag;

  // Handlers mirrored into refs. Callers pass new closures every render (they
  // close over the latest project / snap settings / commit props), so the
  // once-per-gesture effect must read them through refs rather than close over
  // them — otherwise it would either go stale or have to resubscribe mid-drag.
  const onMoveRef = useRef(handlers.onMove);
  onMoveRef.current = handlers.onMove;
  const onReleaseRef = useRef(handlers.onRelease);
  onReleaseRef.current = handlers.onRelease;

  // Guards onRelease to exactly once per gesture. If a device delivers both a
  // pointerup and a pointercancel for the same pointer (or two of either) before
  // React can re-render and tear down the listeners, the second delivery finds
  // this already set and returns without a double commit. Reset at each begin.
  const releasedRef = useRef(false);

  const isDragging = drag !== null;

  function beginDrag(initial: S) {
    releasedRef.current = false;
    // Set the ref eagerly too, so a pointermove that somehow races the very
    // first render still reads the started state rather than a stale null.
    dragRef.current = initial;
    setDrag(initial);
  }

  // Subscribed once per gesture, keyed on the ACTIVE boolean (never the state
  // value). onMove/onRelease are read fresh from their refs, and the drag state
  // is read fresh from dragRef, so a re-render mid-drag (every move causes one)
  // neither resubscribes these listeners nor lets them go stale.
  useEffect(() => {
    if (!isDragging) return;

    function onPointerMove(event: PointerEvent) {
      const current = dragRef.current;
      if (!current || releasedRef.current) return;
      const next = onMoveRef.current(current, event);
      if (next === null) return;
      // Guard on the gesture still being live so a move can never revive a drag
      // the release already cleared — mirrors the copies' `state ? {…} : state`.
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
