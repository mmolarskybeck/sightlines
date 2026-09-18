import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import type { DisplayUnit } from "../../domain/project";
import {
  buildMeasurePointCandidates,
  constrainMeasurePointToAxis,
  resolveMeasurePoint,
  type MeasureCandidateSources,
  type MeasurePoint
} from "../../domain/measurement/measurement";
import { wallLocalYToSvgY } from "../components/elevation/elevationArtworkGeometry";
import type { MeasurementEndpoint } from "../components/measurement/MeasurementOverlay";
import { getNudgeStepMm } from "./nudgeStep";
import { isMeasurementCreationArrowKey } from "./measurementCreationKey";
import { getElevationMeasurementCreationKeyAction } from "./elevationMeasurementPolicy";
import { planMeasurementCancelAction } from "./planMeasurementPolicy";
import {
  MEASURE_DRAG_SLOP_PX,
  type MeasurementToolAction,
  type MeasurementToolState
} from "./useMeasurementTool";

export type ElevationMeasurementGestureRef = MutableRefObject<{
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startedDrawing: boolean;
  refining?: MeasurementEndpoint;
} | null>;

// The elevation measurement pointer/keyboard gesture cluster, lifted out of
// ElevationView verbatim. It owns the snap-target hysteresis ref; the gesture
// ref stays in the view (its pointercancel handler and the pointer-down capture
// still read it) and is passed through.
export function useElevationMeasurementGestures(options: {
  measurementActive: boolean;
  measurementState: MeasurementToolState | null;
  onMeasurementDispatch: ((action: MeasurementToolAction) => void) | undefined;
  measurementGestureRef: ElevationMeasurementGestureRef;
  setMeasurementSnappedEndpoint: (endpoint: MeasurementEndpoint | null) => void;
  measurementSources: MeasureCandidateSources;
  toWallLocalMm: (clientX: number, clientY: number) => Vector2 | null;
  svgRef: RefObject<SVGSVGElement | null>;
  isSpaceDown: boolean;
  snapThresholdMm: number;
  minorGridMm: number;
  gridVisible: boolean;
  snapToGrid: boolean;
  gridPrecisionFloorMm: number | null;
  unit: DisplayUnit;
  wallId: string | undefined;
  wallLengthMm: number;
  wallHeightMm: number;
  viewBoxBounds: { x: number; y: number; width: number; height: number };
}) {
  const {
    measurementActive,
    measurementState,
    onMeasurementDispatch,
    measurementGestureRef,
    setMeasurementSnappedEndpoint,
    measurementSources,
    toWallLocalMm,
    svgRef,
    isSpaceDown,
    snapThresholdMm,
    minorGridMm,
    gridVisible,
    snapToGrid,
    gridPrecisionFloorMm,
    unit,
    wallId,
    wallLengthMm,
    wallHeightMm,
    viewBoxBounds
  } = options;

  const measurementSnapTargetIdRef = useRef<string | undefined>(undefined);

  function resolveMeasurementPoint(raw: MeasurePoint, event: Pick<PointerEvent, "shiftKey" | "metaKey" | "ctrlKey">) {
    // Clamp to wall face: xMm into [0, wallLengthMm], yMm into [0, wallHeightMm]
    const clamped: MeasurePoint = {
      xMm: Math.min(Math.max(raw.xMm, 0), wallLengthMm),
      yMm: Math.min(Math.max(raw.yMm, 0), wallHeightMm)
    };

    const anchor = measurementState?.phase === "drawing"
      ? measurementState.start
      : measurementState?.phase === "refining"
        ? measurementState[measurementState.endpoint === "start" ? "end" : "start"]
        : null;
    const proposed = event.shiftKey && anchor ? constrainMeasurePointToAxis(anchor, clamped) : clamped;
    if (event.metaKey || event.ctrlKey) {
      measurementSnapTargetIdRef.current = undefined;
      return { point: proposed, snapped: false };
    }
    const sources: MeasureCandidateSources = gridVisible && snapToGrid
      ? {
          ...measurementSources,
          points: [
            ...(measurementSources.points ?? []),
            {
              id: `grid:${Math.round(proposed.xMm / minorGridMm)}:${Math.round(proposed.yMm / minorGridMm)}`,
              kind: "grid",
              point: {
                xMm: Math.round(proposed.xMm / minorGridMm) * minorGridMm,
                yMm: Math.round(proposed.yMm / minorGridMm) * minorGridMm
              }
            }
          ]
        }
      : measurementSources;
    const result = resolveMeasurePoint(proposed, buildMeasurePointCandidates(proposed, sources), {
      thresholdMm: snapThresholdMm,
      previousTargetId: measurementSnapTargetIdRef.current
    });
    measurementSnapTargetIdRef.current = result.target?.id;
    return result;
  }

  function resolvedMeasurementPointer(event: ReactPointerEvent<SVGElement>) {
    const raw = toWallLocalMm(event.clientX, event.clientY);
    if (!raw) return null;
    const resolved = resolveMeasurementPoint(raw, event);
    const endpoint: MeasurementEndpoint =
      measurementState?.phase === "refining"
        ? measurementState.endpoint === "start" ? "a" : "b"
        : "b";
    setMeasurementSnappedEndpoint(resolved.snapped ? endpoint : null);
    return resolved.point;
  }

  function handleMeasurementPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      !measurementActive ||
      isSpaceDown ||
      event.isPrimary === false ||
      (event.button !== undefined && event.button !== 0)
    ) {
      return false;
    }
    const point = resolvedMeasurementPointer(event);
    if (!point) return true;
    event.preventDefault();
    event.stopPropagation();

    // A press while already drawing is the completing click of click-click;
    // defer it to pointer-up (mirrors Plan) so the rubber band doesn't
    // resolve before the browser delivers the matching up event.
    const startedDrawing = measurementState?.phase !== "drawing";
    if (startedDrawing) onMeasurementDispatch?.({ type: "begin", point });
    measurementGestureRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startedDrawing
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  }

  function handleMeasurementPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!measurementActive) return false;
    const gesture = measurementGestureRef.current;
    if (gesture?.refining && gesture.pointerId === event.pointerId) {
      const point = resolvedMeasurementPointer(event);
      if (point) onMeasurementDispatch?.({ type: "preview-refinement", point });
      return true;
    }
    if (measurementState?.phase === "drawing") {
      const point = resolvedMeasurementPointer(event);
      if (point) onMeasurementDispatch?.({ type: "preview", point });
      return true;
    }
    return Boolean(gesture);
  }

  function handleMeasurementPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = measurementGestureRef.current;
    if (!measurementActive || !gesture || gesture.pointerId !== event.pointerId) return false;
    measurementGestureRef.current = null;
    if (gesture.refining) {
      onMeasurementDispatch?.({ type: "commit-refinement" });
      return true;
    }
    const movedPx = Math.hypot(
      event.clientX - gesture.startClientX,
      event.clientY - gesture.startClientY
    );
    // The second click completes regardless of slop. A first press completes
    // only when it was a genuine drag; jitter stays in click-click drawing
    // (mirrors Plan's handleMeasurePointerUpCapture).
    if (!gesture.startedDrawing || movedPx > MEASURE_DRAG_SLOP_PX) {
      const point = resolvedMeasurementPointer(event);
      if (point) onMeasurementDispatch?.({ type: "complete", point });
    }
    return true;
  }

  // Mirror of PlanView's cancelMeasurePointerGesture. When a second touch
  // promotes the viewport gesture to a pinch, drop the one-finger measurement
  // in flight: clear the transient gesture ref, release the captured pointer,
  // and dispatch the phase-appropriate clear so no stray measurement is
  // committed on the trailing pointerup.
  function cancelMeasurementPointerGesture() {
    const gesture = measurementGestureRef.current;
    const action = measurementState ? planMeasurementCancelAction(measurementState) : null;
    if (action) onMeasurementDispatch?.(action);
    measurementGestureRef.current = null;
    measurementSnapTargetIdRef.current = undefined;
    setMeasurementSnappedEndpoint(null);
    if (gesture) svgRef.current?.releasePointerCapture?.(gesture.pointerId);
  }

  function beginMeasurementRefinement(
    endpoint: MeasurementEndpoint,
    event: ReactPointerEvent<SVGCircleElement>
  ) {
    if (!measurementActive || measurementState?.phase !== "armed-complete") return;
    const stateEndpoint = endpoint === "a" ? "start" : "end";
    onMeasurementDispatch?.({ type: "begin-refinement", endpoint: stateEndpoint });
    measurementGestureRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startedDrawing: false,
      refining: endpoint
    };
    svgRef.current?.setPointerCapture?.(event.pointerId);
  }

  function handleMeasurementEndpointKeyDown(
    endpoint: MeasurementEndpoint,
    event: ReactKeyboardEvent<SVGCircleElement>
  ) {
    if (!measurementActive || !measurementState || !onMeasurementDispatch) return;
    if (event.key === "Enter" && measurementState.phase === "refining") {
      event.preventDefault();
      event.stopPropagation();
      onMeasurementDispatch({ type: "commit-refinement" });
      return;
    }
    if (
      (measurementState.phase !== "armed-complete" && measurementState.phase !== "refining") ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const stepMm = getNudgeStepMm({
      unit,
      snapToGrid,
      gridPrecisionFloorMm,
      shiftKey: event.shiftKey,
      altKey: event.altKey
    });
    const key = endpoint === "a" ? "start" : "end";
    if (measurementState.phase === "refining" && measurementState.endpoint !== key) return;
    const current = measurementState[key];
    const point = {
      xMm:
        current.xMm +
        (event.key === "ArrowRight" ? stepMm : event.key === "ArrowLeft" ? -stepMm : 0),
      // Wall-local y grows upward, so ArrowUp is positive.
      yMm:
        current.yMm +
        (event.key === "ArrowUp" ? stepMm : event.key === "ArrowDown" ? -stepMm : 0)
    };
    // Clamp to wall face before dispatching
    const clampedPoint: MeasurePoint = {
      xMm: Math.min(Math.max(point.xMm, 0), wallLengthMm),
      yMm: Math.min(Math.max(point.yMm, 0), wallHeightMm)
    };
    if (measurementState.phase === "armed-complete") {
      onMeasurementDispatch({ type: "begin-refinement", endpoint: key });
    }
    onMeasurementDispatch({ type: "preview-refinement", point: clampedPoint });
  }

  // Keyboard-only creation on the SVG surface. Ignores keys bubbling from a
  // focused child (the endpoint handles own their refinement keys) and never
  // touches Escape (App.tsx owns that).
  function handleMeasureSurfaceKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (!measurementActive || !measurementState || !onMeasurementDispatch) return;
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && !isMeasurementCreationArrowKey(event.key)) return;
    // Begin at the visible-viewport centre in wall-local coordinates, clamped
    // to the wall face so the origin is always a valid endpoint.
    const centreSvg = {
      xMm: viewBoxBounds.x + viewBoxBounds.width / 2,
      yMm: viewBoxBounds.y + viewBoxBounds.height / 2
    };
    const origin = {
      xMm: Math.min(Math.max(centreSvg.xMm, 0), wallLengthMm),
      yMm: Math.min(Math.max(wallLocalYToSvgY(wallHeightMm, centreSvg.yMm), 0), wallHeightMm)
    };
    const action = getElevationMeasurementCreationKeyAction(
      measurementState,
      event.key,
      origin,
      wallLengthMm,
      wallHeightMm,
      unit,
      gridPrecisionFloorMm,
      event.shiftKey,
      snapToGrid,
      event.altKey
    );
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const completing = action.type === "complete";
    onMeasurementDispatch(action);
    if (completing) {
      requestAnimationFrame(() => {
        const handle = svgRef.current?.querySelector<SVGCircleElement>(
          '.measurement-endpoint[data-endpoint="b"] .measurement-handle-hit'
        );
        handle?.focus();
      });
    }
  }

  useEffect(() => {
    if (!measurementActive) {
      measurementGestureRef.current = null;
      measurementSnapTargetIdRef.current = undefined;
      setMeasurementSnappedEndpoint(null);
    }
  }, [measurementActive, wallId]);

  return {
    handleMeasurementPointerDown,
    handleMeasurementPointerMove,
    handleMeasurementPointerUp,
    cancelMeasurementPointerGesture,
    beginMeasurementRefinement,
    handleMeasurementEndpointKeyDown,
    handleMeasureSurfaceKeyDown
  };
}
