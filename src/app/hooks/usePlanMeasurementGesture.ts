import {
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";
import type { DisplayUnit } from "../../domain/project";
import {
  buildMeasurePointCandidates,
  constrainMeasurePointToAxis,
  resolveMeasurePoint,
  type MeasureCandidateSources,
  type MeasurePoint
} from "../../domain/measurement/measurement";
import {
  MEASURE_DRAG_SLOP_PX,
  type MeasurementToolAction,
  type MeasurementToolState
} from "./useMeasurementTool";
import { isMeasurementCreationArrowKey } from "./measurementCreationKey";
import {
  canPlanMeasurementClaimPointer,
  getPlanMeasurementCreationKeyAction,
  getPlanMeasurementKeyActions,
  planMeasurementCancelAction
} from "./planMeasurementPolicy";

// The plan-view measurement pointer/keyboard gesture, lifted out of PlanView
// verbatim. It owns the transient snap-hysteresis + in-flight-gesture refs and
// the snapped-endpoint highlight state; every handler closes over the current
// props/derived geometry passed in each render (the handlers are plain
// per-render functions, exactly as inline), so the caller keeps threading the
// live values. cancelMeasurePointerGesture and the raw gesture ref are exposed
// because PlanView's own pointer-down-capture handler defers to the viewport
// pan/pinch claim and must cancel an in-flight measurement.
export function usePlanMeasurementGesture(options: {
  measurementActive: boolean;
  measurementState: MeasurementToolState | undefined;
  onMeasurementAction: Dispatch<MeasurementToolAction> | undefined;
  measureSources: MeasureCandidateSources;
  toSvgMm: (clientX: number, clientY: number) => MeasurePoint | null;
  isSpaceDown: boolean;
  gridVisible: boolean;
  snapToGrid: boolean;
  minorGridMm: number;
  snapThresholdMm: number;
  unit: DisplayUnit;
  gridPrecisionFloorMm: number | null;
  viewBoxBounds: { x: number; y: number; width: number; height: number };
  svgRef: RefObject<SVGSVGElement | null>;
}) {
  const {
    measurementActive,
    measurementState,
    onMeasurementAction,
    measureSources,
    toSvgMm,
    isSpaceDown,
    gridVisible,
    snapToGrid,
    minorGridMm,
    snapThresholdMm,
    unit,
    gridPrecisionFloorMm,
    viewBoxBounds,
    svgRef
  } = options;

  const previousMeasureTargetIdRef = useRef<string | undefined>(undefined);
  const [snappedMeasurementEndpoint, setSnappedMeasurementEndpoint] = useState<"a" | "b" | null>(null);
  const measureGestureRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    startedDrawing: boolean;
    refining: boolean;
  } | null>(null);

  function resolvePlanMeasurePoint(
    proposed: MeasurePoint,
    event: Pick<ReactPointerEvent<SVGSVGElement>, "shiftKey" | "metaKey" | "ctrlKey">
  ): MeasurePoint {
    const anchor =
      measurementState?.phase === "drawing"
        ? measurementState.start
        : measurementState?.phase === "refining"
          ? measurementState[measurementState.endpoint === "start" ? "end" : "start"]
          : null;
    const constrained = event.shiftKey && anchor
      ? constrainMeasurePointToAxis(anchor, proposed)
      : proposed;
    if (event.metaKey || event.ctrlKey) {
      previousMeasureTargetIdRef.current = undefined;
      return constrained;
    }
    const points = [...(measureSources.points ?? [])];
    if (gridVisible && snapToGrid && minorGridMm > 0) {
      points.push({
        id: `grid:${Math.round(constrained.xMm / minorGridMm)}:${Math.round(constrained.yMm / minorGridMm)}`,
        kind: "grid",
        point: {
          xMm: Math.round(constrained.xMm / minorGridMm) * minorGridMm,
          yMm: Math.round(constrained.yMm / minorGridMm) * minorGridMm
        }
      });
    }
    const resolved = resolveMeasurePoint(
      constrained,
      buildMeasurePointCandidates(constrained, { points, segments: measureSources.segments }),
      {
        thresholdMm: snapThresholdMm,
        previousTargetId: previousMeasureTargetIdRef.current
      }
    );
    previousMeasureTargetIdRef.current = resolved.target?.id;
    const activeEndpoint =
      measurementState?.phase === "refining"
        ? measurementState.endpoint === "start" ? "a" : "b"
        : measurementState?.phase === "drawing"
          ? "b"
          : "a";
    setSnappedMeasurementEndpoint(resolved.snapped ? activeEndpoint : null);
    return resolved.point;
  }

  function handleMeasurePointerDownCapture(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (!measurementActive || !measurementState || !onMeasurementAction) return false;
    if (!canPlanMeasurementClaimPointer(event.button, isSpaceDown)) return false;
    const target = event.target as Element | null;
    const endpoint = target?.closest(".measurement-endpoint")?.getAttribute("data-endpoint");
    if (endpoint === "a" || endpoint === "b") {
      onMeasurementAction({
        type: "begin-refinement",
        endpoint: endpoint === "a" ? "start" : "end"
      });
      measureGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startedDrawing: false,
        refining: true
      };
    } else if (target?.closest(".measurement-overlay")) {
      // A measurement owns clicks on its body. It is already selected, so the
      // only required action is preventing a new endpoint from being placed.
      event.stopPropagation();
      return true;
    } else {
      const proposed = toSvgMm(event.clientX, event.clientY);
      if (!proposed) return true;
      const point = resolvePlanMeasurePoint(proposed, event);
      const startedDrawing = measurementState.phase !== "drawing";
      if (startedDrawing) onMeasurementAction({ type: "begin", point });
      measureGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startedDrawing,
        refining: false
      };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handleMeasurePointerMove(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (!measurementActive || !measurementState || !onMeasurementAction) return false;
    if (measurementState.phase !== "drawing" && measurementState.phase !== "refining") return true;
    const proposed = toSvgMm(event.clientX, event.clientY);
    if (!proposed) return true;
    const point = resolvePlanMeasurePoint(proposed, event);
    onMeasurementAction({
      type: measurementState.phase === "refining" ? "preview-refinement" : "preview",
      point
    });
    return true;
  }

  function handleMeasurePointerUpCapture(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = measureGestureRef.current;
    if (!measurementActive || !measurementState || !onMeasurementAction || !gesture) return;
    if (gesture.pointerId !== event.pointerId) return;
    const proposed = toSvgMm(event.clientX, event.clientY);
    if (gesture.refining) {
      if (proposed) onMeasurementAction({ type: "preview-refinement", point: resolvePlanMeasurePoint(proposed, event) });
      onMeasurementAction({ type: "commit-refinement" });
    } else if (proposed) {
      const travelled = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY);
      // The second click completes regardless of slop. A first press completes
      // only when it was a genuine drag; jitter stays in click-click drawing.
      if (!gesture.startedDrawing || travelled > MEASURE_DRAG_SLOP_PX) {
        onMeasurementAction({ type: "complete", point: resolvePlanMeasurePoint(proposed, event) });
      }
    }
    measureGestureRef.current = null;
    previousMeasureTargetIdRef.current = undefined;
    event.preventDefault();
    // Touch must reach the viewport hook's window listener so its pointer
    // bookkeeping is released; no underlying edit began because pointerdown
    // was already captured by Measure.
    if (event.pointerType !== "touch") event.stopPropagation();
  }

  function cancelMeasurePointerGesture() {
    const action = measurementState ? planMeasurementCancelAction(measurementState) : null;
    if (action) onMeasurementAction?.(action);
    measureGestureRef.current = null;
    previousMeasureTargetIdRef.current = undefined;
    setSnappedMeasurementEndpoint(null);
  }

  function handleMeasurePointerCancelCapture(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = measureGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    cancelMeasurePointerGesture();
    event.preventDefault();
    if (event.pointerType !== "touch") event.stopPropagation();
  }

  const visibleMeasurement =
    measurementActive && measurementState && measurementState.phase !== "armed-empty"
      ? measurementState
      : null;

  function handleMeasurementEndpointKeyDown(
    endpoint: "a" | "b",
    event: ReactKeyboardEvent<SVGCircleElement>
  ) {
    if (!measurementState || !onMeasurementAction) return;
    const actions = getPlanMeasurementKeyActions(
      measurementState,
      endpoint === "a" ? "start" : "end",
      event.key,
      unit,
      gridPrecisionFloorMm,
      event.shiftKey,
      snapToGrid,
      event.altKey
    );
    if (actions.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    actions.forEach(onMeasurementAction);
  }

  // Keyboard-only creation lives on the SVG itself. It must ignore keys that
  // bubble up from a focused child (the measurement handles own their own
  // arrow/Enter refinement), and it never touches Escape — App.tsx owns that.
  function handleMeasureSurfaceKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (!measurementActive || !measurementState || !onMeasurementAction) return;
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && !isMeasurementCreationArrowKey(event.key)) return;
    const origin: MeasurePoint = {
      xMm: viewBoxBounds.x + viewBoxBounds.width / 2,
      yMm: viewBoxBounds.y + viewBoxBounds.height / 2
    };
    const action = getPlanMeasurementCreationKeyAction(
      measurementState,
      event.key,
      origin,
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
    onMeasurementAction(action);
    // After a keyboard completion the "b" handle becomes focusable; move focus
    // onto it so refinement is immediately reachable. Deferred a frame so the
    // re-rendered, now-tabbable handle exists before we focus it.
    if (completing) {
      requestAnimationFrame(() => {
        const handle = svgRef.current?.querySelector<SVGCircleElement>(
          '.measurement-endpoint[data-endpoint="b"] .measurement-handle-hit'
        );
        handle?.focus();
      });
    }
  }

  return {
    measureGestureRef,
    snappedMeasurementEndpoint,
    visibleMeasurement,
    handleMeasurePointerDownCapture,
    handleMeasurePointerMove,
    handleMeasurePointerUpCapture,
    handleMeasurePointerCancelCapture,
    cancelMeasurePointerGesture,
    handleMeasurementEndpointKeyDown,
    handleMeasureSurfaceKeyDown
  };
}
