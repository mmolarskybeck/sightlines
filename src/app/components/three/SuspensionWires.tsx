import { useMemo } from "react";
import type { Object3D } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import {
  SUSPENSION_WIRE_INSET_FRACTION,
  SUSPENSION_WIRE_INSET_MM
} from "../../../domain/project";
import { mmToWorld } from "./coordinates";
import { SUSPENSION_WIRE_COLOR } from "./tokens";

// Suspension: a floor object whose bottom edge sits above the floor
// (FloorObjectBase.baseHeightMm) hangs, and 3D draws the rigging that explains
// why it is in the air. The motivating case is a thin projection board angled
// off the wall on ceiling wires, but nothing here is projection-specific — the
// board IS an ordinary floor artwork with a base height.
//
// Both halves of that rule live here on purpose: the lift (where the box's
// center goes) and the wires (what holds it there) have to agree about what
// `baseHeightMm` measures, and splitting them across files is how they would
// quietly stop agreeing. See the TRAP note on FloorObjectBase.baseHeightMm —
// it is a BOTTOM EDGE, never a center, and never wallYMm.

// How far in from each top corner a wire attaches, and the per-axis cap on it,
// both from domain/project.ts — shared with the elevation ghost's wires so the
// two views cannot drift apart on where a wire meets the board. Re-exported
// here only so 3D-local readers can keep importing from their own layer.
export { SUSPENSION_WIRE_INSET_FRACTION, SUSPENSION_WIRE_INSET_MM };

export type SuspensionWirePlan = {
  // Vertical run from the object's TOP face up to the anchor, in mm. Always
  // > 0 — a plan is only produced when there is real distance to span.
  riseMm: number;
  // Attachment points in the object's OWN frame (x along its width, z along
  // its depth, both measured from its center), so they rotate with the board
  // for free: the render layer hangs them inside the same yawed group the box
  // lives in rather than re-deriving a rotation here.
  anchorsMm: { xMm: number; zMm: number }[];
};

// The y (in mm above the floor) of a suspended object's box CENTER. The stored
// value is the bottom edge, and every box mesh in this app is center-anchored,
// so this half-height shift is the whole of "the lift". A floor-resting object
// (baseHeightMm absent or 0) lands on exactly heightMm / 2 — the value the
// render layer used before suspension existed, bit for bit.
//
// Kind-agnostic by design: whether a given kind is allowed to hang at all is
// the caller's decision (see planSuspensionWires for where that decision is
// written down), not something to re-litigate in the arithmetic.
export function suspendedCenterYMm(object: FloorObject3d): number {
  return (object.baseHeightMm ?? 0) + object.heightMm / 2;
}

// Everything needed to draw one object's rigging, or null when it must draw
// none. This is the single place the "should there be wires?" decision lives.
export function planSuspensionWires(object: FloorObject3d): SuspensionWirePlan | null {
  // Only artwork hangs.
  //
  // A blocked zone is a planning annotation about FLOOR AREA (spec §5.3) — it
  // has no height at all and renders as a flat quad lying on the floor. Wires
  // over a floor annotation would claim the floor under it is usable, which is
  // the opposite of what the annotation says.
  //
  // A freestanding display case is furniture standing on four legs whose
  // heights CaseMesh derives from heightMm ("overall, floor to box top" —
  // CaseFloorObject, project.ts). A vitrine does not hang from wires, and
  // lifting one would render its legs ending in mid-air.
  if (object.kind !== "artwork") return null;

  const baseHeightMm = object.baseHeightMm ?? 0;
  if (baseHeightMm <= 0) return null;

  // No containing room means no anchor: nothing to hang from, so nothing to
  // draw. Deliberately not a fallback height — see FloorObject3d.
  const anchorHeightMm = object.suspensionAnchorHeightMm;
  if (anchorHeightMm === undefined) return null;

  // A board whose top already reaches (or passes) the wall height has no gap
  // to span; drawing zero- or negative-length wires would put a dot or an
  // inverted line at the ceiling line.
  const riseMm = anchorHeightMm - (baseHeightMm + object.heightMm);
  if (riseMm <= 0) return null;

  return { riseMm, anchorsMm: wireAnchorsMm(object.widthMm, object.depthMm) };
}

// The four top-corner attachment points, inset per axis. The inset is capped at
// SUSPENSION_WIRE_INSET_FRACTION of each extent so a genuinely thin board —
// 18mm MDF is the whole point of this feature — cannot invert: a fixed 60mm
// inset on a 20mm depth would put the "front" wires behind the back face. On a
// thin board the two wires on a side end up nearly coincident, which is exactly
// how such a board is really rigged.
function wireAnchorsMm(
  widthMm: number,
  depthMm: number
): { xMm: number; zMm: number }[] {
  const xMm =
    widthMm / 2 - Math.min(SUSPENSION_WIRE_INSET_MM, widthMm * SUSPENSION_WIRE_INSET_FRACTION);
  const zMm =
    depthMm / 2 - Math.min(SUSPENSION_WIRE_INSET_MM, depthMm * SUSPENSION_WIRE_INSET_FRACTION);
  // Perimeter order, matching the outline helpers' convention.
  return [
    { xMm: -xMm, zMm: -zMm },
    { xMm: xMm, zMm: -zMm },
    { xMm: xMm, zMm: zMm },
    { xMm: -xMm, zMm: zMm }
  ];
}

// TRAP: three's Raycaster tests Line objects with a THRESHOLD (params.Line,
// default 1 world unit = 1 m here), not against the drawn pixels — so a
// hairline wire would swallow hits within a metre of itself. That is not just a
// selection problem: CursorZoom and the double-click focus flight
// (ThreeDView.tsx) raycast `scene.children` recursively and steer the camera to
// the nearest hit, so raycastable wires would yank the camera toward a wire
// whenever the cursor passed anywhere near one. Rigging is decoration; it opts
// out of picking entirely rather than relying on having no handlers of its own.
const NO_RAYCAST: Object3D["raycast"] = () => {};

// One object's rigging: four vertical hairlines rising from the board's top
// corners to the room's wall height. Rendered INSIDE the object's own yawed
// group, so `fromLocalYMm` is a local offset (the box's half-height) and the
// board's rotation is already applied to the anchors by the parent transform.
export function SuspensionWires({
  plan,
  fromLocalYMm
}: {
  plan: SuspensionWirePlan;
  // Local y of the board's TOP face, i.e. where the wires attach.
  fromLocalYMm: number;
}) {
  const positions = useMemo(() => {
    const bottom = mmToWorld(fromLocalYMm);
    const top = mmToWorld(fromLocalYMm + plan.riseMm);
    return new Float32Array(
      plan.anchorsMm.flatMap(({ xMm, zMm }) => {
        const x = mmToWorld(xMm);
        const z = mmToWorld(zMm);
        return [x, bottom, z, x, top, z];
      })
    );
  }, [plan, fromLocalYMm]);

  return (
    <lineSegments raycast={NO_RAYCAST}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={SUSPENSION_WIRE_COLOR} />
    </lineSegments>
  );
}
