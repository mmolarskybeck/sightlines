import { MathUtils } from "three";

// OrbitControls dolly envelope (meters), shared by the controls props and the
// cursor-directed wheel dolly so both clamp to the same bounds (spec §4.2).
export const ORBIT_MIN_DISTANCE = 0.35;
export const ORBIT_MAX_DISTANCE = 200;

// Focus flights pull the camera into this envelope (meters): a far overview
// flies in close enough to read the target, an already-near camera keeps its
// standoff rather than jumping.
export const FOCUS_MIN_DISTANCE = 1.5;
export const FOCUS_MAX_DISTANCE = 6;

// Wheel -> zoom step. factor = exp(dy * ZOOM_SENSITIVITY): tuned so a 100px
// mouse notch is ~1.25x per event, brisk without overshooting.
export const ZOOM_SENSITIVITY = 0.0022;
// Trackpad pinch arrives as a ctrlKey wheel with tiny deltas; scale it up so a
// pinch gesture covers range comparable to a scroll.
export const PINCH_SENSITIVITY_MULTIPLIER = 8;

// DOM_DELTA_LINE / DOM_DELTA_PAGE -> approximate pixels, so one code path
// handles every device's wheel units.
const LINE_TO_PIXELS = 16;
const PAGE_TO_PIXELS = 100;

// Normalize a wheel event's vertical delta to pixels, folding in the pinch
// boost so downstream zoom math is unit-agnostic.
export function normalizeWheelDeltaY(event: {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}): number {
  let delta = event.deltaY;
  if (event.deltaMode === 1) delta *= LINE_TO_PIXELS;
  else if (event.deltaMode === 2) delta *= PAGE_TO_PIXELS;
  if (event.ctrlKey) delta *= PINCH_SENSITIVITY_MULTIPLIER;
  return delta;
}

// Multiplicative dolly step. >1 dollies out (positive delta), <1 dollies in.
export function zoomFactorFromDelta(normalizedDeltaY: number): number {
  return Math.exp(normalizedDeltaY * ZOOM_SENSITIVITY);
}

export function clampFocusDistance(currentDistance: number): number {
  return MathUtils.clamp(currentDistance, FOCUS_MIN_DISTANCE, FOCUS_MAX_DISTANCE);
}

// Near/far bracket the camera around its orbit distance so precision stays
// even across the scene's scale — the standoff-derived clipping applyPose and
// the wheel dolly both rely on.
export function updateCameraClipping(
  camera: { near: number; far: number; updateProjectionMatrix: () => void },
  distance: number
): void {
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = Math.max(distance * 100, 100);
  camera.updateProjectionMatrix();
}
