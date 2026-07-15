import { useCallback, useEffect, useReducer } from "react";

import type { Point } from "../../domain/geometry/polygon";

// Coordinate ownership is explicit even for temporary work. An Elevation
// measurement is meaningful only on the wall face where it was drawn.
export type MeasurementContext =
  | { kind: "plan" }
  | { kind: "elevation"; wallId: string };

export type MeasurementEndpoint = Point;

export type MeasurementToolState =
  | { phase: "armed-empty"; context: MeasurementContext }
  | {
      phase: "drawing";
      context: MeasurementContext;
      start: MeasurementEndpoint;
      preview: MeasurementEndpoint;
    }
  | {
      phase: "armed-complete";
      context: MeasurementContext;
      start: MeasurementEndpoint;
      end: MeasurementEndpoint;
    }
  | {
      phase: "refining";
      context: MeasurementContext;
      start: MeasurementEndpoint;
      end: MeasurementEndpoint;
      endpoint: "start" | "end";
      original: MeasurementEndpoint;
    };

export type MeasurementToolAction =
  | { type: "set-context"; context: MeasurementContext }
  | { type: "begin"; point: MeasurementEndpoint }
  | { type: "preview"; point: MeasurementEndpoint }
  | { type: "complete"; point: MeasurementEndpoint }
  | { type: "begin-refinement"; endpoint: "start" | "end" }
  | { type: "preview-refinement"; point: MeasurementEndpoint }
  | { type: "commit-refinement" }
  | { type: "cancel-refinement" }
  | { type: "clear" };

function sameContext(a: MeasurementContext, b: MeasurementContext): boolean {
  return a.kind === b.kind && (a.kind === "plan" || a.wallId === (b as typeof a).wallId);
}

function samePoint(a: MeasurementEndpoint, b: MeasurementEndpoint): boolean {
  return a.xMm === b.xMm && a.yMm === b.yMm;
}

export function createEmptyMeasurementState(context: MeasurementContext): MeasurementToolState {
  return { phase: "armed-empty", context };
}

// Pure state machine for temporary work. It intentionally has no project or
// history dependency, which makes replacement and refinement cancellation
// impossible to leak into autosave/undo.
export function measurementToolReducer(
  state: MeasurementToolState,
  action: MeasurementToolAction
): MeasurementToolState {
  switch (action.type) {
    case "set-context":
      return sameContext(state.context, action.context)
        ? state
        : createEmptyMeasurementState(action.context);
    case "begin":
      return {
        phase: "drawing",
        context: state.context,
        start: action.point,
        preview: action.point
      };
    case "preview":
      return state.phase === "drawing" ? { ...state, preview: action.point } : state;
    case "complete":
      if (state.phase !== "drawing" || samePoint(state.start, action.point)) return state;
      return {
        phase: "armed-complete",
        context: state.context,
        start: state.start,
        end: action.point
      };
    case "begin-refinement": {
      if (state.phase !== "armed-complete") return state;
      const original = state[action.endpoint];
      return { ...state, phase: "refining", endpoint: action.endpoint, original };
    }
    case "preview-refinement":
      return state.phase === "refining" ? { ...state, [state.endpoint]: action.point } : state;
    case "commit-refinement":
      if (state.phase !== "refining") return state;
      if (samePoint(state.start, state.end)) {
        return { ...state, [state.endpoint]: state.original };
      }
      return {
        phase: "armed-complete",
        context: state.context,
        start: state.start,
        end: state.end
      };
    case "cancel-refinement":
      return state.phase === "refining"
        ? {
            phase: "armed-complete",
            context: state.context,
            start: state.endpoint === "start" ? state.original : state.start,
            end: state.endpoint === "end" ? state.original : state.end
          }
        : state;
    case "clear":
      return createEmptyMeasurementState(state.context);
  }
}

export function escapeMeasurementState(state: MeasurementToolState): {
  state: MeasurementToolState;
  disarm: boolean;
} {
  if (state.phase === "armed-empty") return { state, disarm: true };
  if (state.phase === "refining") {
    return { state: measurementToolReducer(state, { type: "cancel-refinement" }), disarm: false };
  }
  return { state: createEmptyMeasurementState(state.context), disarm: false };
}

export function useMeasurementTool(context: MeasurementContext) {
  const [state, dispatch] = useReducer(
    measurementToolReducer,
    context,
    createEmptyMeasurementState
  );

  useEffect(() => dispatch({ type: "set-context", context }), [context]);

  const begin = useCallback((point: MeasurementEndpoint) => dispatch({ type: "begin", point }), []);
  const preview = useCallback(
    (point: MeasurementEndpoint) => dispatch({ type: "preview", point }),
    []
  );
  const complete = useCallback(
    (point: MeasurementEndpoint) => dispatch({ type: "complete", point }),
    []
  );
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  return { state, dispatch, begin, preview, complete, clear };
}
