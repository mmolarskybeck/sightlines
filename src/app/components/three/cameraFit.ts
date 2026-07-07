import { Box3, MathUtils, Vector3 } from "three";

// Breathing room around the fitted geometry (applied to the solved distance,
// which is already exact — this is purely aesthetic margin).
const FIT_MARGIN = 1.12;

// Never fit closer than this (meters); keeps degenerate scenes (single point,
// zero-size room) at a workable orbit distance.
const MIN_DISTANCE = 1;

const WORLD_UP = new Vector3(0, 1, 0);

// Minimal camera distance along `direction` (unit vector, bounds center ->
// camera) so that every corner of `bounds` fits inside a perspective frustum
// with vertical fov `fovDeg` at `aspect`. A plain `distance = extent * k`
// misframes rooms badly: near corners sit much closer to the camera than the
// bounds center, so their angular size is larger — solve the frustum
// constraint per corner instead.
export function fitDistance(
  bounds: Box3,
  direction: Vector3,
  fovDeg: number,
  aspect: number
): number {
  const tanVertical = Math.tan(MathUtils.degToRad(fovDeg) / 2);
  const tanHorizontal = tanVertical * aspect;

  // Camera basis for a camera looking along -direction with world-up y.
  const forward = direction.clone().negate();
  const right = new Vector3().crossVectors(forward, WORLD_UP);
  if (right.lengthSq() < 1e-12) {
    // Looking straight up/down: any horizontal right-vector works.
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }
  const up = new Vector3().crossVectors(right, forward).normalize();

  const center = bounds.getCenter(new Vector3());
  const offset = new Vector3();
  let distance = MIN_DISTANCE;

  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        offset.set(x, y, z).sub(center);
        // Corner's offset toward the camera: the frustum must be solved at
        // the corner's own depth (d - along), not the center's.
        const along = offset.dot(direction);
        const horizontal = Math.abs(offset.dot(right)) / tanHorizontal;
        const vertical = Math.abs(offset.dot(up)) / tanVertical;
        distance = Math.max(distance, along + horizontal, along + vertical);
      }
    }
  }

  return distance * FIT_MARGIN;
}
