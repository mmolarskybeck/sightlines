import { MathUtils } from "three";
import type { Vector3 } from "three";

// A camera position + orbit target, in world space (spec §5.2 scale). Shared
// by the interactive rig and the offscreen snapshot renderer so a capture can
// apply exactly the pose the user was looking at.
export type CameraPose = { position: Vector3; target: Vector3 };

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

// Cmd/Ctrl +/- keyboard dolly step — one keypress, one 2D-ZOOM_STEP-sized
// hop (~1.25x), matching how the buttons/shortcut feel in the SVG viewport
// (useSvgViewportGestures.ts's ZOOM_STEP).
export const KEYBOARD_ZOOM_STEP = 1.25;

// Same >1-dollies-out/<1-dollies-in convention as zoomFactorFromDelta, keyed
// off keyboard intent rather than a wheel delta.
export function keyboardZoomFactor(direction: "in" | "out"): number {
  return direction === "out" ? KEYBOARD_ZOOM_STEP : 1 / KEYBOARD_ZOOM_STEP;
}

export function clampFocusDistance(currentDistance: number): number {
  return MathUtils.clamp(currentDistance, FOCUS_MIN_DISTANCE, FOCUS_MAX_DISTANCE);
}

// WASD travel speed envelope (meters/second before the shift boost): scales
// with orbit distance — walking-ish close in, a glide zoomed out.
export const TRAVEL_MIN_SPEED = 1.5;
export const TRAVEL_MAX_SPEED = 30;
export const TRAVEL_SHIFT_MULTIPLIER = 3;

// frameloop="demand": the first frame after an idle period reports a delta
// spanning the entire gap (whole seconds), which would teleport the camera —
// cap the integration step at a plausible frame time.
export const MAX_TRAVEL_FRAME_DELTA = 0.05;

// Distance (meters) one frame of travel covers, all clamps applied.
export function travelStepDistance(
  orbitDistance: number,
  shiftHeld: boolean,
  frameDelta: number
): number {
  const speed =
    MathUtils.clamp(orbitDistance, TRAVEL_MIN_SPEED, TRAVEL_MAX_SPEED) *
    (shiftHeld ? TRAVEL_SHIFT_MULTIPLIER : 1);
  return speed * Math.min(frameDelta, MAX_TRAVEL_FRAME_DELTA);
}

// Eye level never lands closer than this (~6ft): a natural standing viewing
// distance — closer reads as pressing your nose to the work.
export const EYE_MIN_VIEW_MM = 1800;
// Breathing room multiplier on the exact frustum fit.
export const EYE_FIT_MARGIN = 1.08;
// Artwork viewing rule of thumb: stand about 1.5 diagonals back.
export const EYE_ARTWORK_DIAGONALS = 1.5;

// Standoff that fits a WHOLE wall from a camera held level at eye height:
// horizontal fit of the wall's length, plus vertical fit of the asymmetric
// extents — the wall spans floor..height around an eye that sits low, so the
// extent above the eye usually governs. Obstructions never shorten this;
// they're ghosted by the render layer instead (position is framing's job,
// visibility is ghosting's).
export function eyeLevelWallDistanceMm(
  wallLengthMm: number,
  wallHeightMm: number,
  eyeHeightMm: number,
  fovVerticalRad: number,
  aspect: number
): number {
  const halfV = fovVerticalRad / 2;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const widthFit = wallLengthMm / 2 / Math.tan(halfH);
  const heightFit =
    Math.max(wallHeightMm - eyeHeightMm, eyeHeightMm) / Math.tan(halfV);
  return Math.max(EYE_MIN_VIEW_MM, EYE_FIT_MARGIN * Math.max(widthFit, heightFit));
}

// Standing distance for one work: ~1.5 diagonals of its rect, floored at the
// minimum standing distance so small works don't pull the camera into them.
export function eyeLevelArtworkDistanceMm(widthMm: number, heightMm: number): number {
  return Math.max(
    EYE_MIN_VIEW_MM,
    EYE_ARTWORK_DIAGONALS * Math.hypot(widthMm, heightMm)
  );
}

export type SightlineSegment = {
  id: string;
  start: { xMm: number; yMm: number };
  end: { xMm: number; yMm: number };
  // Present for single-sided perimeter walls: they only occlude when the
  // camera sits on this (inward) side — seen from outside they're already
  // back-face culled (the dollhouse effect, see WallPanel). Absent for
  // partition slabs, which are opaque from both sides.
  facing?: { xMm: number; yMm: number };
};

// Every segment crossing the OPEN sight segment camera -> target in floor
// space — the set the render layer ghosts while an eye-level view is active.
// Endpoint hits don't count: the viewed wall sits exactly at the target and
// must never ghost itself.
export function sightlineOccluders(
  camera: { xMm: number; yMm: number },
  target: { xMm: number; yMm: number },
  segments: readonly SightlineSegment[],
  excludeIds: ReadonlySet<string> = new Set()
): string[] {
  const rx = target.xMm - camera.xMm;
  const ry = target.yMm - camera.yMm;
  const occluders: string[] = [];
  for (const segment of segments) {
    if (excludeIds.has(segment.id)) continue;
    const dx = segment.end.xMm - segment.start.xMm;
    const dy = segment.end.yMm - segment.start.yMm;
    const denom = rx * dy - ry * dx;
    // Parallel to the sightline — never crosses it.
    if (Math.abs(denom) < 1e-9) continue;
    const ax = segment.start.xMm - camera.xMm;
    const ay = segment.start.yMm - camera.yMm;
    // Sight segment camera + t·r meets occluder start + s·d.
    const t = (ax * dy - ay * dx) / denom;
    const s = (ax * ry - ay * rx) / denom;
    if (t <= 0.001 || t >= 0.999 || s < 0 || s > 1) continue;
    if (segment.facing) {
      const side =
        (camera.xMm - segment.start.xMm) * segment.facing.xMm +
        (camera.yMm - segment.start.yMm) * segment.facing.yMm;
      if (side <= 0) continue;
    }
    occluders.push(segment.id);
  }
  return occluders;
}

// Near/far bracket the camera around its orbit distance so precision stays
// even across the scene's scale — the standoff-derived clipping applyPose and
// the wheel dolly both rely on. Near rides at 1% of orbit distance (was 0.1%)
// because the framed-artwork layers in framingGeometry.ts sit only 1–2mm apart;
// at near=d/1000 the depth buffer resolves only ~d/16777 (0.6mm @10m, 1.2mm
// @20m), which z-fought those layers during camera motion. d/100 buys 10× the
// margin, and nothing is ever visible inside 1% of the viewing distance.
export function updateCameraClipping(
  camera: { near: number; far: number; updateProjectionMatrix: () => void },
  distance: number
): void {
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = Math.max(distance * 100, 100);
  camera.updateProjectionMatrix();
}
