import type { PointerEvent as ReactPointerEvent } from "react";
import type { Vector2 } from "../../../domain/geometry/dragResize";
import type { PlanRect } from "../../../domain/geometry/planObjects";

// The angle increment a rotate drag lands on while the Snap toggle is on.
// 15° is the whole common-angle family in one number — 15/30/45/60/75/90 are
// all multiples of it, so the "snap to common angles" behavior needs no second
// coarse tier. Deliberately NO Shift handling: the project's nudge convention
// (getNudgeStepMm) makes Shift a 4x coarsening, and 4 × 15° = 60° is a worse
// step than the base one, not a better one. Alt/Option is the escape hatch,
// matching that same convention's documented role for Alt — "honest fine
// precision, the deliberate opt-in to unclean values."
export const ROTATE_SNAP_DEG = 15;

// Decimal places a free (Alt) rotation is stored to. Keeps a hand-dragged angle
// readable in the inspector's Angle field instead of writing 47.318472...°.
// Rounded by multiply-then-divide rather than round(deg / step) * step: the
// latter reintroduces exactly the float dust it is meant to remove
// (round(47.34 / 0.1) * 0.1 === 47.300000000000004).
const FREE_ROTATION_DECIMALS = 1;

// Fold any angle into [0, 360). rotationDeg is stored unbounded by the schema,
// but a drag that crosses the seam should read 350°, never -10°.
export function normalizeRotationDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

// The FRONT-FACE direction for a plan rotation, in floor space: the unit vector
// along the object's local +y (+depth) axis. See PlanObject.tsx's FRONT-FACE
// CONVENTION block — this is the same "left normal" (-sin θ, cos θ) that
// offsetPlanRectToViewerSide uses for the viewer's side of a wall, which is
// what makes plan, elevation and 3D agree on which face is the front.
export function floorObjectFrontNormal(rotationDeg: number): Vector2 {
  const rad = (rotationDeg * Math.PI) / 180;
  return { xMm: -Math.sin(rad), yMm: Math.cos(rad) };
}

// The rotation that would point the object's FRONT at `pointerMm`. Inverts
// floorObjectFrontNormal: we want (-sin θ, cos θ) ∝ (vx, vy), so
// sin θ = -vx/|v| and cos θ = vy/|v|, i.e. θ = atan2(-vx, vy). Returns null
// within `deadZoneMm` of the pivot, where the pointer has no direction at all
// and the angle would spin wildly on sub-pixel jitter.
export function rotationDegForPointer(
  centerMm: Vector2,
  pointerMm: Vector2,
  deadZoneMm: number
): number | null {
  const vxMm = pointerMm.xMm - centerMm.xMm;
  const vyMm = pointerMm.yMm - centerMm.yMm;
  if (Math.hypot(vxMm, vyMm) <= deadZoneMm) return null;
  return normalizeRotationDeg((Math.atan2(-vxMm, vyMm) * 180) / Math.PI);
}

// Applies the project's snapping convention to a raw dragged angle. `snapToGrid`
// is the toolbar's Snap toggle — the same switch that governs every other plan
// gesture — and altKey is the per-drag opt-out. Both off/absent means the angle
// lands wherever the pointer put it (rounded only enough to stay readable).
export function snapRotationDeg(
  rawDeg: number,
  { snapToGrid, altKey }: { snapToGrid: boolean; altKey: boolean }
): number {
  if (snapToGrid && !altKey) {
    return normalizeRotationDeg(Math.round(rawDeg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG);
  }
  const scale = 10 ** FREE_ROTATION_DECIMALS;
  return normalizeRotationDeg(Math.round(rawDeg * scale) / scale);
}

// The rotate affordance for a single selected floor object: a stem running out
// of the object's FRONT face to a handle chip, in the same hollow-petrol-square
// language as every other plan handle (this design language has no circles).
//
// Pointing out of the front face is the whole point — the handle is also the
// facing indicator, so "drag the stem to where the work should face" is the
// entire gesture. It matters most for a projection board, whose footprint is a
// hairline with no body to grab and no obvious front.
//
// The chip deliberately carries `.resize-handle` alongside its own modifier:
// that class is load-bearing beyond styling. PlanView's
// handleSvgPointerDownCapture arms suppressNextToolClickRef off
// `.resize-handle, .plan-object:not(.is-ghost)`, and without the match the
// trailing click after a rotate release would reach handleSvgClick and clear
// the selection the user just rotated.
export function FloorObjectRotateHandle({
  handleSizeMm,
  isActive,
  planRect,
  onBeginDrag
}: {
  // Screen-constant handle size in mm at the current zoom (PlanView's
  // SELECTED_HANDLE_PX / pixelsPerMm), same input every plan handle takes.
  handleSizeMm: number;
  isActive: boolean;
  // The object's CURRENT rect — the live preview angle during a rotate drag, so
  // the handle stays under the pointer instead of snapping back to the
  // committed angle between frames.
  planRect: PlanRect;
  onBeginDrag: (event: ReactPointerEvent<SVGRectElement>) => void;
}) {
  if (handleSizeMm <= 0) return null;

  const normal = floorObjectFrontNormal(planRect.angleDeg);
  // Anchor on the front face, then stand the chip clear of it. The stem is
  // measured from the face rather than from the center so a deep object and a
  // hairline board both get the same visual gap.
  const stemMm = handleSizeMm * 3;
  const faceOffsetMm = planRect.depthMm / 2;
  const anchorXMm = planRect.centerXMm + normal.xMm * faceOffsetMm;
  const anchorYMm = planRect.centerYMm + normal.yMm * faceOffsetMm;
  const chipXMm = planRect.centerXMm + normal.xMm * (faceOffsetMm + stemMm);
  const chipYMm = planRect.centerYMm + normal.yMm * (faceOffsetMm + stemMm);

  // Same generous multiplier the room resize handles use (~2.8x the visible
  // chip). Safe to be this forgiving here: the handle renders after
  // PlacedObjectsLayer, so it wins over the object it belongs to, and it only
  // exists while exactly one floor object is selected.
  const paddedSizeMm = handleSizeMm * 2.8;
  const chipClassName = isActive
    ? "resize-handle rotate-handle active"
    : "resize-handle rotate-handle";

  return (
    <g aria-hidden="true" className="rotate-handle-group">
      {/* Inert: the stem is a facing cue, not a second grab target — giving it
          pointer-events would let it swallow clicks over the open floor the
          object's front looks onto. */}
      <line
        className="rotate-handle-stem"
        vectorEffect="non-scaling-stroke"
        x1={anchorXMm}
        x2={chipXMm}
        y1={anchorYMm}
        y2={chipYMm}
      />
      <rect
        className={`${chipClassName} handle-hit`}
        height={paddedSizeMm}
        width={paddedSizeMm}
        x={chipXMm - paddedSizeMm / 2}
        y={chipYMm - paddedSizeMm / 2}
        onPointerDown={onBeginDrag}
      />
      <rect
        className={chipClassName}
        height={handleSizeMm}
        width={handleSizeMm}
        x={chipXMm - handleSizeMm / 2}
        y={chipYMm - handleSizeMm / 2}
        onPointerDown={onBeginDrag}
      />
    </g>
  );
}
