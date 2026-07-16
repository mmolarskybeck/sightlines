import type {
  MeasurementEndpoint,
  MeasurementToolAction,
  MeasurementToolState
} from "./useMeasurementTool";

// The arrow keys that move a keyboard-driven preview endpoint. Enter begins a
// measurement (from an origin) or completes one; every other key is ignored so
// the surface handler can leave it for the browser / other shortcuts.
const ARROW_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;

export function isMeasurementCreationArrowKey(key: string): boolean {
  return (ARROW_KEYS as readonly string[]).includes(key);
}

export type MeasurementCreationKeyOptions = {
  // Where a keyboard-begun measurement starts. The view computes this (the
  // centre of the visible viewport, already clamped to any valid surface) so
  // both endpoints land somewhere predictable and on-screen.
  origin: MeasurementEndpoint;
  // The per-key nudge delta in model mm, already carrying the view's y-axis
  // convention (Plan y-down, Elevation wall-local y-up). Null when the key is
  // not an arrow key.
  delta: MeasurementEndpoint | null;
  // Optional surface clamp (Elevation clamps to the wall face). Applied to the
  // nudged preview so arrow keys can never walk an endpoint off the surface.
  clamp?: (point: MeasurementEndpoint) => MeasurementEndpoint;
};

// Pure creation-phase keyboard resolver, shared by Plan and Elevation. It
// mirrors the pointer creation path onto keys: Enter begins from the origin
// while armed-empty, arrows nudge the live preview while drawing, and Enter
// completes at the current preview (the reducer still rejects a coincident
// endpoint, leaving the state in `drawing`, per spec §7.4). Refinement of a
// completed measurement stays owned by the endpoint-handle key handler.
export function getMeasurementCreationKeyAction(
  state: MeasurementToolState,
  key: string,
  { origin, delta, clamp }: MeasurementCreationKeyOptions
): MeasurementToolAction | null {
  if (state.phase === "armed-empty") {
    return key === "Enter" ? { type: "begin", point: origin } : null;
  }
  if (state.phase === "drawing") {
    if (key === "Enter") return { type: "complete", point: state.preview };
    if (!delta) return null;
    const nudged: MeasurementEndpoint = {
      xMm: state.preview.xMm + delta.xMm,
      yMm: state.preview.yMm + delta.yMm
    };
    return { type: "preview", point: clamp ? clamp(nudged) : nudged };
  }
  return null;
}
