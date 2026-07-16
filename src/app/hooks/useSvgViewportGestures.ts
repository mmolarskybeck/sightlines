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

// Maximum client-pixel travel still treated as a tap.
export const TOUCH_TAP_SLOP_PX = 8;

// Lets each view apply its own post-gesture selection and click-suppression policy.
export type ViewportGestureEnd = {
  kind: "mouse-pan" | "touch";
  movedPx: number;
  isTap: boolean;
  startedOnBackground: boolean;
};

// Shared 2D pan, zoom, pinch, wheel, and keyboard engine. All coordinates are
// y-down SVG userspace; Elevation performs its own wall-local y-flip.
export function useSvgViewportGestures(options: {
  svgRef: RefObject<SVGSVGElement | null>;
  viewport: Viewport2D;
  onViewportChange: (v: Viewport2D) => void;
  // Padded extent used for fit and gesture calculations.
  contentBounds: ViewBox;
  containerSize: Size;
  zoomLimits: ZoomLimits;
  // Blocks a second finger from pinching over an active edit gesture.
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

  // Space-drag and middle-mouse pan state.
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const spaceHeldRef = useRef(false);
  const pointerInsideSvgRef = useRef(false);
  const [panning, setPanning] = useState(false);
  // Last pointer position for incremental pan deltas.
  const panLastRef = useRef<{ x: number; y: number } | null>(null);
  // Fresh viewport for once-subscribed gesture handlers.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Keep callbacks fresh without resubscribing mid-gesture.
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const isPinchBlockedRef = useRef<() => boolean>(options.isPinchBlocked ?? (() => false));
  isPinchBlockedRef.current = options.isPinchBlocked ?? (() => false);
  const onGestureEndRef = useRef<((info: ViewportGestureEnd) => void) | undefined>(options.onGestureEnd);
  onGestureEndRef.current = options.onGestureEnd;
  // Refs pick up resize/bounds changes between gestures.
  const contentBoundsRef = useRef(contentBounds);
  contentBoundsRef.current = contentBounds;
  const containerSizeRef = useRef(containerSize);
  containerSizeRef.current = containerSize;
  const zoomLimitsRef = useRef(zoomLimits);
  zoomLimitsRef.current = zoomLimits;

  // Touch state machine:
  //   • touchPointsRef  — every live touch pointer's latest client position.
  //   • touchModeRef    — which gesture currently owns the viewport.
  //   • touchPanLastRef — last client position of a one-finger pan (deltas).
  //   • touchPinchRef   — the two pinch pointer ids + previous midpoint/spread.
  //   • touchMovedPxRef — total client-px travelled this gesture (tap vs pan).
  //   • touchPanTapCandidateRef — true once a one-finger pan begins on true
  //     background, so a stationary release is reported as a background tap.
  // A finger on an object remains owned by that object's drag gesture.
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
  // Tracks background starts so stationary taps can clear selection.
  const touchPanTapCandidateRef = useRef(false);
  const [touchTracking, setTouchTracking] = useState(false);

  // Current viewBox used to center button-driven zoom.
  const { viewBox: viewBoxBounds } = getViewBox2D(viewport, contentBounds, containerSize);

  // Client pixels to y-down SVG units. The CTM may be absent before layout.
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

  // Buttons zoom around the viewBox center because they have no cursor anchor.
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
  // Fresh zoomAtCenter for the once-mounted Cmd/Ctrl +/- keydown handler.
  const zoomAtCenterRef = useRef(zoomAtCenter);
  zoomAtCenterRef.current = zoomAtCenter;

  // Disable step controls when clamping would produce no change.
  const canZoomIn =
    clampZoom(getEffectiveZoom(viewport) * ZOOM_STEP, contentBounds, containerSize, zoomLimits) !==
    getEffectiveZoom(viewport);
  const canZoomOut =
    clampZoom(getEffectiveZoom(viewport) / ZOOM_STEP, contentBounds, containerSize, zoomLimits) !==
    getEffectiveZoom(viewport);

  // Native non-passive wheel handling is required for preventDefault.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (e: WheelEvent) => {
    e.preventDefault();
    // Normalize line-mode wheel deltas to approximate pixels.
    const norm = (d: number) => (e.deltaMode === 1 ? d * 16 : d);
    if (e.ctrlKey || e.metaKey) {
      // Browsers report trackpad pinch as ctrl/meta-wheel.
      const point = toSvgPoint(e.clientX, e.clientY);
      if (!point) return;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-norm(e.deltaY) * WHEEL_ZOOM_SENSITIVITY)));
      onViewportChange(
        zoomAtPoint(viewportRef.current, point, factor, contentBounds, containerSize, zoomLimits)
      );
    } else {
      // Synthesize Shift-horizontal pan only when the browser did not.
      const dx = e.shiftKey && e.deltaX === 0 ? norm(e.deltaY) : norm(e.deltaX);
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : norm(e.deltaY);
      onViewportChange(panBy(viewportRef.current, { x: dx, y: dy }, contentBounds, containerSize));
    }
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelHandlerRef.current(e);
    // Prevent Safari's non-standard pinch page zoom.
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

  // Track Space-pan and Cmd/Ctrl+0 fit without hijacking editable fields.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        // Block the browser's own zoom reset.
        event.preventDefault();
        onViewportChangeRef.current(FIT_VIEWPORT);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === "=" || event.key === "+")) {
        // Block the browser's own page zoom-in.
        event.preventDefault();
        zoomAtCenterRef.current(ZOOM_STEP);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "-") {
        // Block the browser's own page zoom-out.
        event.preventDefault();
        zoomAtCenterRef.current(1 / ZOOM_STEP);
        return;
      }
      if (event.code === "Space" || event.key === " ") {
        const interactiveTarget = (event.target as HTMLElement)?.closest?.('button, a, [role="button"]');
        // Preserve Space activation unless the pointer is actively over the SVG.
        if (interactiveTarget && !pointerInsideSvgRef.current) {
          return;
        }
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          setIsSpaceDown(true);
        }
        // Held Space must never scroll the page.
        event.preventDefault();
        if (interactiveTarget) {
          event.stopPropagation();
        }
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space" || event.key === " ") {
        spaceHeldRef.current = false;
        setIsSpaceDown(false);
      }
    }

    function onBlur() {
      // Avoid a stuck Space state after switching windows.
      spaceHeldRef.current = false;
      pointerInsideSvgRef.current = false;
      setIsSpaceDown(false);
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Subscribe once per Space/middle-mouse pan gesture.
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
