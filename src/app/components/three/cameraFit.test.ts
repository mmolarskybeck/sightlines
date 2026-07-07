import { describe, expect, it } from "vitest";
import { Box3, MathUtils, PerspectiveCamera, Vector3 } from "three";
import { fitDistance } from "./cameraFit";

const FOV_DEG = 50;

// The offset direction the entry framing uses: ~40° elevation from a 45°
// azimuth corner (unit vector from the bounds center toward the camera).
function entryDirection(): Vector3 {
  const elevation = MathUtils.degToRad(40);
  const azimuth = MathUtils.degToRad(45);
  return new Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth)
  ).normalize();
}

// True when every corner of `box` lands inside the camera frustum (in NDC).
function cornersInsideFrustum(box: Box3, camera: PerspectiveCamera): boolean {
  const { min, max } = box;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        const ndc = new Vector3(x, y, z).project(camera);
        if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return false;
      }
    }
  }
  return true;
}

function cameraFittedTo(box: Box3, aspect: number): PerspectiveCamera {
  const direction = entryDirection();
  const distance = fitDistance(box, direction, FOV_DEG, aspect);
  const center = box.getCenter(new Vector3());
  const camera = new PerspectiveCamera(FOV_DEG, aspect, 0.01, 1000);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  return camera;
}

describe("fitDistance", () => {
  // The sample gallery that exposed the bug: 28ft x 18ft x 12ft room on a
  // portrait-ish canvas. The old extent-times-margin heuristic cut the near
  // floor corner off at this aspect.
  it("keeps a wide room fully in frame on a portrait canvas", () => {
    const box = new Box3(new Vector3(0, 0, 0), new Vector3(8.53, 3.66, 5.49));
    expect(cornersInsideFrustum(box, cameraFittedTo(box, 0.75))).toBe(true);
  });

  it("keeps the room in frame on a wide canvas", () => {
    const box = new Box3(new Vector3(0, 0, 0), new Vector3(8.53, 3.66, 5.49));
    expect(cornersInsideFrustum(box, cameraFittedTo(box, 2.2))).toBe(true);
  });

  it("is tight, not just huge: some corner sits near the frame edge", () => {
    const box = new Box3(new Vector3(0, 0, 0), new Vector3(8.53, 3.66, 5.49));
    const camera = cameraFittedTo(box, 0.75);
    let maxNdc = 0;
    const { min, max } = box;
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          const ndc = new Vector3(x, y, z).project(camera);
          maxNdc = Math.max(maxNdc, Math.abs(ndc.x), Math.abs(ndc.y));
        }
      }
    }
    // Inside the frame, but using most of it (margin keeps it under 1).
    expect(maxNdc).toBeLessThanOrEqual(1);
    expect(maxNdc).toBeGreaterThan(0.6);
  });

  it("returns a sane positive distance for a degenerate (point) box", () => {
    const box = new Box3(new Vector3(1, 0, 1), new Vector3(1, 0, 1));
    const distance = fitDistance(box, entryDirection(), FOV_DEG, 1.5);
    expect(distance).toBeGreaterThan(0);
    expect(Number.isFinite(distance)).toBe(true);
  });
});
