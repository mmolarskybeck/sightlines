import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import {
  clampZoom,
  FIT_VIEWPORT,
  getEffectiveZoom,
  getViewBox2D,
  panBy,
  pinchZoomPan,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_STEP,
  zoomAtPoint,
  type Size,
  type ViewBox,
  type Viewport2D,
  type ZoomLimits
} from "../../domain/viewport/viewport2d";
import { isEditableTarget } from "./isEditableTarget";

// A touch gesture (one-finger pan or two-finger pinch) that moves less than
// this many client px on release is treated as a stationary tap — beyond it,
// the release is a pan/pinch. The consuming view decides what a tap vs a
// pan/pinch means for its own selection/tool state (via onGestureEnd).
export const TOUCH_TAP_SLOP_PX = 8;

// Emitted once when a viewport gesture ends, so each view can reproduce its own
// divergent post-gesture behavior without the hook needing to know about it:
//   • PlanView arms its trailing-click suppression when kind === "mouse-pan"
//     (a space/middle pan fires a trailing click) or when !isTap (a real touch
//     pan/pinch also fires one).
//   • ElevationView clears the selection when kind === "touch" && isTap &&
//     startedOnBackground (a stationary background tap — elevation has no svg
//     click handler to ride, so the clear can't piggyback a trailing click).
export type ViewportGestureEnd = {
  kind: "mouse-pan" | "touch"; // space/middle-drag vs touch pan/pinch
  movedPx: number; // total client-px travel (0 for mouse-pan; not tracked today)
  isTap: boolean; // touch only: movedPx <= TOUCH_TAP_SLOP_PX
  startedOnBackground: boolean; // touch pan began via beginTouchPan (bubble-phase background press)
};

// The shared 2D viewport gesture engine (pan / zoom / pinch / wheel / keyboard),
// extracted verbatim from PlanView and ElevationView (which each carried a
// near-identical ~350-line copy). The hook works EXCLUSIVELY in SVG userspace
// (y-down): every viewport helper (zoomAtPoint, panBy, getViewBox2D,
// pinchZoomPan) is y-down, so there is deliberately NO y-flip parameter here —
// ElevationView's y-flip lives in its own toWallLocalMm placement helper and
// stays in the view. Callbacks and view-owned flags (isPinchBlocked,
// onGestureEnd) are mirrored into refs and read fresh, matching the existing
// viewportRef discipline, so the once-per-gesture window effects never need to
// resubscribe on their identity.
export function useSvgViewportGestures(options: {
  svgRef: RefObject<SVGSVGElement | null>;
  viewport: Viewport2D;
  onViewportChange: (v: Viewport2D) => void;
  // The padded fit extent the view already computes (plan: floor bounds +
  // padding; elevation: wall rect + 6% pad) — the FIT extent every gesture
  // measures against.
  contentBounds: ViewBox;
  containerSize: Size;
  zoomLimits: ZoomLimits;
  // True while a view-owned single-finger edit (wall resize / room move /
  // object-or-placement move-drag) is in flight — a 2nd finger then blocks
  // rather than starting a pinch over that edit. Defaults to never-blocked.
  isPinchBlocked?: () => boolean;
  onGestureEnd?: (info: ViewportGestureEnd) => void;
}): {
  isSpaceDown: boolean;
  panning: boolean;
  toSvgPoint: (clientX: number, clientY: number) => Vector2 | null;
  zoomAtCenter: (factor: number) => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  handlePointerDownCapture: (e: ReactPointerEvent<SVGSVGElement>) => boolean;
  beginTouchPan: (clientX: number, clientY: number) => void;
} {
  const { svgRef, viewport, onViewportChange, contentBounds, containerSize, zoomLimits } = options;

  // Space-drag / middle-mouse pan. `isSpaceDown` drives the container cursor
  // (grab), `panning` drives it while a pan drag is live (grabbing).
  // `isSpaceDown` is mirrored into `spaceHeldRef` so the capture-phase
  // pointerdown and the window-level pan move handlers read a fresh value
  // without resubscribing.
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const spaceHeldRef = useRef(false);
  const pointerInsideSvgRef = useRef(false);
  const [panning, setPanning] = useState(false);
  // Last pointer client position of the in-flight pan, for incremental deltas.
  const panLastRef = useRef<{ x: number; y: number } | null>(null);
  // Fresh viewport for gesture handlers that were subscribed once (pan moves,
  // wheel) and must not close over a stale prop — same ref-mirror discipline
  // the drag gestures use for their transient state.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // View-owned callbacks/flags mirrored into refs so the once-per-gesture
  // window effects can read the latest without resubscribing on identity.
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const isPinchBlockedRef = useRef<() => boolean>(options.isPinchBlocked ?? (() => false));
  isPinchBlockedRef.current = options.isPinchBlocked ?? (() => false);
  const onGestureEndRef = useRef<((info: ViewportGestureEnd) => void) | undefined>(options.onGestureEnd);
  onGestureEndRef.current = options.onGestureEnd;
  // contentBounds/containerSize/zoomLimits can't change mid-gesture (no commit,
  // no resize while a pointer is captured), but the once-subscribed window
  // handlers still read them fresh via refs so a resize between gestures is
  // picked up without resubscribing.
  const contentBoundsRef = useRef(contentBounds);
  contentBoundsRef.current = contentBounds;
  const containerSizeRef = useRef(containerSize);
  containerSizeRef.current = containerSize;
  const zoomLimitsRef = useRef(zoomLimits);
  zoomLimitsRef.current = zoomLimits;

  // Touch (tablet) gestures: one-finger canvas pan and two-finger pinch-zoom.
  // A small explicit state machine keyed off the number of tracked touch
  // pointers:
  //   • touchPointsRef  — every live touch pointer's latest client position.
  //   • touchModeRef    — which gesture currently owns the viewport.
  //   • touchPanLastRef — last client position of a one-finger pan (deltas).
  //   • touchPinchRef   — the two pinch pointer ids + previous midpoint/spread.
  //   • touchMovedPxRef — total client-px travelled this gesture (tap vs pan).
  //   • touchPanTapCandidateRef — true once a one-finger pan begins on true
  //     background, so a stationary release is reported as a background tap.
  // `touchTracking` (state) keys the window move/up effect on/off, mirroring
  // how `panning` gates the mouse-pan effect. A single finger that lands on a
  // view object owns its own move-drag — touchMode stays "idle" and these
  // handlers stay out of its way.
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const touchModeRef = useRef<"idle" | "pan" | "pinch">("idle");
  const touchPanLastRef = useRef<{ x: number; y: number } | null>(null);
  const touchPinchRef = useRef<{
    idA: number;
    idB: number;
    prevMid: { x: number; y: number };
    prevDist: number;
  } | null>(null);
  const touchMovedPxRef = useRef(0);
  // True once a one-finger pan begins on true background (via beginTouchPan) —
  // surfaced through onGestureEnd's startedOnBackground so a stationary release
  // can clear the selection. Stays false for a finger that started on an object.
  const touchPanTapCandidateRef = useRef(false);
  const [touchTracking, setTouchTracking] = useState(false);

  // The concrete zoomed viewBox rect for the current viewport — the anchor for
  // the [+]/[−] buttons' center-zoom.
  const { viewBox: viewBoxBounds } = getViewBox2D(viewport, contentBounds, containerSize);

  // Client-px → viewBox-mm conversion in plain SVG userspace (y-down). Every
  // viewport helper works in SVG userspace, never wall-local (y-up) — the
  // elevation y-flip lives in the view's own toWallLocalMm. Used for the
  // wheel-zoom anchor and the pinch anchor. Returns null when the CTM is
  // unavailable (e.g. jsdom, or before first layout).
  function toSvgPoint(clientX: number, clientY: number): Vector2 | null {
    const svg = svgRef.current;
    if (!svg) return null;

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const transformed = point.matrixTransform(ctm.inverse());
    return { xMm: transformed.x, yMm: transformed.y };
  }

  // Zoom the current viewBox about its own center — the [+]/[−] buttons' target
  // point, since there's no cursor to anchor on for a button press.
  function zoomAtCenter(factor: number) {
    onViewportChange(
      zoomAtPoint(
        viewport,
        { xMm: viewBoxBounds.x + viewBoxBounds.width / 2, yMm: viewBoxBounds.y + viewBoxBounds.height / 2 },
        factor,
        contentBounds,
        containerSize,
        zoomLimits
      )
    );
  }

  // The zoom-control affordances: a step-zoom is possible only when it would
  // actually change the effective zoom (clampZoom holds it at the limit).
  const canZoomIn =
    clampZoom(getEffectiveZoom(viewport) * ZOOM_STEP, contentBounds, containerSize, zoomLimits) !==
    getEffectiveZoom(viewport);
  const canZoomOut =
    clampZoom(getEffectiveZoom(viewport) / ZOOM_STEP, contentBounds, containerSize, zoomLimits) !==
    getEffectiveZoom(viewport);

  // Wheel = zoom (ctrl/⌘ or trackpad pinch) or pan (plain / shift-horizontal).
  // Reassigned every render so it always sees the latest viewport/bounds;
  // registered once as a NON-passive native listener (React's onWheel can be
  // passive, which would make preventDefault a no-op) in the effect below.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (e: WheelEvent) => {
    e.preventDefault();
    // Line-mode wheels (deltaMode 1) report in lines, not pixels — scale up so
    // one detent moves a comparable amount to a pixel-mode wheel.
    const norm = (d: number) => (e.deltaMode === 1 ? d * 16 : d);
    if (e.ctrlKey || e.metaKey) {
      // ctrlKey===true is also how a trackpad pinch arrives in Chrome/Firefox/
      // Safari — same code path, anchored on the cursor's world point.
      const point = toSvgPoint(e.clientX, e.clientY);
      if (!point) return;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-norm(e.deltaY) * WHEEL_ZOOM_SENSITIVITY)));
      onViewportChange(
        zoomAtPoint(viewportRef.current, point, factor, contentBounds, containerSize, zoomLimits)
      );
    } else {
      // Plain wheel pans; shift+wheel pans horizontally on Windows (macOS
      // already flips deltaX for a shifted wheel, so only synthesize when the
      // browser left deltaX at 0).
      const dx = e.shiftKey && e.deltaX === 0 ? norm(e.deltaY) : norm(e.deltaX);
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : norm(e.deltaY);
      onViewportChange(panBy(viewportRef.current, { x: dx, y: dy }, contentBounds, containerSize));
    }
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelHandlerRef.current(e);
    // Safari's non-standard pinch events would otherwise page-zoom the app.
    const onGesture = (e: Event) => e.preventDefault();
    const onPointerEnter = () => {
      pointerInsideSvgRef.current = true;
    };
    const onPointerLeave = () => {
      pointerInsideSvgRef.current = false;
    };
    const onPointerCancel = () => {
      pointerInsideSvgRef.current = false;
    };
    el.addEventListener("pointerenter", onPointerEnter);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGesture);
    el.addEventListener("gesturechange", onGesture);
    el.addEventListener("gestureend", onGesture);
    return () => {
      el.removeEventListener("pointerenter", onPointerEnter);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGesture);
      el.removeEventListener("gesturechange", onGesture);
      el.removeEventListener("gestureend", onGesture);
    };
  }, []);

  // Track Space (for the grab cursor + capture-phase pan intercept) and handle
  // ⌘0 / Ctrl+0 = reset to fit. Window-scoped; skips edit fields so typing a
  // literal "0" or space in an input is never hijacked. plan/elevation are
  // never both mounted at once (viewMode gates which one App renders), so
  // there's no risk of two of these double-firing on the same keystroke.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        // Also blocks the browser's own zoom-reset.
        event.preventDefault();
        onViewportChangeRef.current(FIT_VIEWPORT);
        return;
      }
      if (event.code === "Space" || event.key === " ") {
        const interactiveTarget = (event.target as HTMLElement)?.closest?.('button, a, [role="button"]');
        // A Tab-focused button/link must still activate on Space. The one
        // exception is pointer-led viewport work: focus may still sit on a
        // topbar control while the pointer is over the SVG, and in that case
        // Space should arm pan instead of clicking the stale focused control.
        if (interactiveTarget && !pointerInsideSvgRef.current) {
          return;
        }
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          setIsSpaceDown(true);
        }
        // Stops the page from scrolling while space engages pan. e.repeat is
        // ignored for the flag (already set) but still prevented so
        // held-space never scrolls.
        event.preventDefault();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space" || event.key === " ") {
        spaceHeldRef.current = false;
        setIsSpaceDown(false);
      }
    }

    function onBlur() {
      // ⌘Tab away while holding space would otherwise leave the flag stuck.
      spaceHeldRef.current = false;
      pointerInsideSvgRef.current = false;
      setIsSpaceDown(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Space/middle-mouse pan drag. Subscribed once per gesture (keyed on
  // `panning`), reading the live viewport via viewportRef and applying the
  // negated incremental pointer delta so the drawing tracks the pointer.
  // contentBounds/containerSize are read fresh via refs — they can't change
  // mid-gesture (no commit, no resize while a button is held).
  useEffect(() => {
    if (!panning) return;

    function onPointerMove(event: PointerEvent) {
      const last = panLastRef.current;
      if (!last) return;
      onViewportChangeRef.current(
        panBy(
          viewportRef.current,
          { x: -(event.clientX - last.x), y: -(event.clientY - last.y) },
          contentBoundsRef.current,
          containerSizeRef.current
        )
      );
      panLastRef.current = { x: event.clientX, y: event.clientY };
    }

    function endPan() {
      panLastRef.current = null;
      setPanning(false);
      // A left-button (space) pan fires a trailing `click` on the svg just like
      // a marquee does; the view reproduces its own trailing-click suppression
      // via onGestureEnd. (Middle-button pan fires auxclick, not click, so it's
      // harmless there — the view's suppress is idempotent either way.) movedPx
      // is not tracked for a mouse pan today, so it's reported as 0.
      onGestureEndRef.current?.({
        kind: "mouse-pan",
        movedPx: 0,
        isTap: false,
        startedOnBackground: false
      });
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endPan);
    window.addEventListener("pointercancel", endPan);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPan);
      window.removeEventListener("pointercancel", endPan);
    };
  }, [panning]);

  // Begin a two-finger pinch from the two currently tracked touch pointers.
  // Ends any in-flight one-finger pan (pinch owns the gesture from here).
  function beginPinch() {
    const entries = [...touchPointsRef.current.entries()];
    if (entries.length < 2) return;
    const [idA, a] = entries[0];
    const [idB, b] = entries[1];
    touchModeRef.current = "pinch";
    touchPanLastRef.current = null;
    touchPanTapCandidateRef.current = false;
    touchPinchRef.current = {
      idA,
      idB,
      prevMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      prevDist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 0)
    };
  }

  // Begin a one-finger canvas pan (touch only). Called from the svg's
  // bubble-phase pointerdown, which only fires for a press on true background
  // (an object's pointerdown stopPropagation keeps it from reaching here — that
  // touch stays an object/placement move-drag instead). Callers may invoke it
  // UNCONDITIONALLY from that handler: the guard below only starts a pan when
  // exactly one pointer is tracked and no pinch is live — the same condition
  // the views used to check at their call sites before the extraction. (A
  // pinch's own 2nd finger never reaches the bubble phase — the capture
  // handler stopPropagation's it — but a 3rd+ finger landing on background
  // during a live pinch does; this guard is what makes that a no-op instead
  // of hijacking the pinch as a pan.)
  function beginTouchPan(clientX: number, clientY: number) {
    if (touchPointsRef.current.size !== 1 || touchModeRef.current === "pinch") return;
    touchModeRef.current = "pan";
    touchPanLastRef.current = { x: clientX, y: clientY };
    touchPanTapCandidateRef.current = true;
  }

  // Touch move/up/cancel/blur, subscribed once while ≥1 touch is tracked
  // (keyed on `touchTracking`), reading live state via the touch refs — the
  // same discipline the mouse-pan effect uses. viewport is read fresh via
  // viewportRef; contentBounds/containerSize/zoomLimits via their refs.
  useEffect(() => {
    if (!touchTracking) return;

    function onPointerMove(event: PointerEvent) {
      if (event.pointerType !== "touch") return;
      const points = touchPointsRef.current;
      if (!points.has(event.pointerId)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (touchModeRef.current === "pan") {
        const last = touchPanLastRef.current;
        if (!last) return;
        const dx = event.clientX - last.x;
        const dy = event.clientY - last.y;
        touchMovedPxRef.current += Math.hypot(dx, dy);
        onViewportChangeRef.current(
          panBy(viewportRef.current, { x: -dx, y: -dy }, contentBoundsRef.current, containerSizeRef.current)
        );
        touchPanLastRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

      if (touchModeRef.current === "pinch") {
        const pinch = touchPinchRef.current;
        if (!pinch) return;
        const a = points.get(pinch.idA);
        const b = points.get(pinch.idB);
        if (!a || !b) return;
        const nextMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const nextDist = Math.hypot(a.x - b.x, a.y - b.y);
        const midDelta = { x: nextMid.x - pinch.prevMid.x, y: nextMid.y - pinch.prevMid.y };
        if (pinch.prevDist > 0 && nextDist > 0) {
          const factor = nextDist / pinch.prevDist;
          // World point under the PREVIOUS midpoint, via the live CTM in plain
          // SVG userspace (toSvgPoint, not any y-flipped view helper) — the
          // same anchor space the wheel-zoom handler uses.
          const prevMidWorld = toSvgPoint(pinch.prevMid.x, pinch.prevMid.y);
          if (prevMidWorld) {
            touchMovedPxRef.current +=
              Math.hypot(midDelta.x, midDelta.y) + Math.abs(nextDist - pinch.prevDist);
            onViewportChangeRef.current(
              pinchZoomPan(
                viewportRef.current,
                prevMidWorld,
                factor,
                midDelta,
                contentBoundsRef.current,
                containerSizeRef.current,
                zoomLimitsRef.current
              )
            );
          }
        }
        pinch.prevMid = nextMid;
        pinch.prevDist = nextDist;
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (event.pointerType !== "touch") return;
      const points = touchPointsRef.current;
      if (!points.has(event.pointerId)) return;
      points.delete(event.pointerId);

      if (touchModeRef.current === "pinch") {
        const pinch = touchPinchRef.current;
        // Only a lift of one of the two pinch fingers ends the pinch; a 3rd
        // finger lifting leaves it running. A 2→1 lift never hands off to a new
        // pan — the lone remaining finger idles until a fresh touch-down.
        if (pinch && (event.pointerId === pinch.idA || event.pointerId === pinch.idB)) {
          touchModeRef.current = "idle";
          touchPinchRef.current = null;
        }
      } else if (touchModeRef.current === "pan") {
        touchModeRef.current = "idle";
        touchPanLastRef.current = null;
      }

      if (points.size === 0) {
        // Whole gesture over. Report it so the view reproduces its own
        // divergent behavior (plan: suppress the trailing click on a real
        // pan/pinch; elevation: clear the selection on a stationary background
        // tap). Read the flags into locals BEFORE resetting them.
        const movedPx = touchMovedPxRef.current;
        onGestureEndRef.current?.({
          kind: "touch",
          movedPx,
          isTap: movedPx <= TOUCH_TAP_SLOP_PX,
          startedOnBackground: touchPanTapCandidateRef.current
        });
        touchMovedPxRef.current = 0;
        touchPanTapCandidateRef.current = false;
        setTouchTracking(false);
      }
    }

    function onBlur() {
      // Losing the window (⌘Tab, notification) mid-gesture would otherwise
      // strand tracked pointers — reset everything. No gesture-end is reported:
      // a blur-interrupted gesture neither pans-to-suppress nor taps-to-clear.
      touchPointsRef.current.clear();
      touchModeRef.current = "idle";
      touchPanLastRef.current = null;
      touchPinchRef.current = null;
      touchMovedPxRef.current = 0;
      touchPanTapCandidateRef.current = false;
      setTouchTracking(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [touchTracking]);

  // Capture-phase pan intercept: space-held (left button) or middle-mouse press
  // claims the gesture BEFORE any of the view's own gestures (move-drag,
  // marquee, drop-ghost) can start — the capture phase runs on the svg, an
  // ancestor of every object's own <g>, so stopPropagation here keeps those
  // gestures from ever firing. Returns true ONLY when the event was CONSUMED
  // (preventDefault + stopPropagation ran): a pinch claim, or a space/middle
  // pan claim. A 1st touch or 3rd+ touch does bookkeeping and returns false so
  // the view's own capture-tail logic (e.g. plan's suppressNextToolClickRef
  // assignment for a press that started on an object) still runs.
  function handlePointerDownCapture(event: ReactPointerEvent<SVGSVGElement>): boolean {
    // Touch pointers feed the pinch/pan state machine. This capture-phase
    // handler fires before any object's own pointerdown, so every touch is
    // recorded regardless of what it lands on. The 2nd finger claims the
    // gesture as a pinch (unless a view-owned edit is already in flight, in
    // which case we defer to that edit and just block the finger), stopping
    // propagation so no object under it starts its own drag.
    //
    // Deliberate normalization vs PlanView's old copy: a touch press NEVER
    // routes into the space/middle-mouse pan branch below (it always returns
    // here first). ElevationView's copy already did this; PlanView's technically
    // allowed the exotic "space held while touching" case to fall through into
    // the space-pan branch. That case is meaningless in practice, so the hook
    // adopts elevation's cleaner behavior for both views.
    if (event.pointerType === "touch") {
      const points = touchPointsRef.current;
      const isFirst = points.size === 0;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (isFirst) {
        touchMovedPxRef.current = 0;
        touchPanTapCandidateRef.current = false;
      }
      setTouchTracking(true);
      if (points.size === 2) {
        event.preventDefault();
        event.stopPropagation();
        if (!isPinchBlockedRef.current()) beginPinch();
        return true;
      }
      if (points.size >= 3) return false; // ignore 3rd+ touches
      // A single touch falls through (returns false); whether it becomes a pan
      // is decided by the view's bubble-phase background handler calling
      // beginTouchPan. A finger on an object never reaches that handler (the
      // object stopPropagation), so it stays a move-drag.
      return false;
    }

    if (spaceHeldRef.current || event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      panLastRef.current = { x: event.clientX, y: event.clientY };
      setPanning(true);
      return true;
    }
    return false;
  }

  return {
    isSpaceDown,
    panning,
    toSvgPoint,
    zoomAtCenter,
    canZoomIn,
    canZoomOut,
    handlePointerDownCapture,
    beginTouchPan
  };
}
