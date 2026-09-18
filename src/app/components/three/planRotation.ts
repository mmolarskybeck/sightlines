import { MathUtils } from "three";

// Plan-space rotation (CCW in plan x/y) to a three.js yaw about +y — the same
// single sign flip FloorObjectBox owns, restated rather than imported because
// both are two lines and a shared import would make one component's render
// depend on the other's file.
export function planRotationToYaw(rotationDeg: number): number {
  return -MathUtils.degToRad(rotationDeg);
}
