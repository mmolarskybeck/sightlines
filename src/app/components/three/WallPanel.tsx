import { useMemo } from "react";
import type { WallPanel3d } from "../../../domain/geometry/scene3d";
import { MM_TO_WORLD } from "./coordinates";

// Near-white wall — MeshLambertMaterial so the single directional light shades
// adjacent walls slightly differently and the room reads as volume (spec §6.2).
const WALL_COLOR = "#f4f2ef";

// A dumb mapper: one zero-thickness, single-sided plane per wall, positioned
// and rotated so its FRONT face points into the room. From outside the room the
// near walls are back-face-culled (invisible) while far walls read normally —
// the dollhouse effect (spec §5.3). The derivation guarantees the winding: the
// wall's inward normal is the left normal of start -> end, and rotating the
// plane's +x onto (end - start) puts its +z (front) exactly on that inward
// normal (see scene3d.ts `wallInwardNormal`).
export function WallPanel({ wall }: { wall: WallPanel3d }) {
  const { positionX, positionY, positionZ, rotationY, lengthWorld, heightWorld } =
    useMemo(() => {
      const dxMm = wall.end.xMm - wall.start.xMm;
      const dyMm = wall.end.yMm - wall.start.yMm;
      const lengthMm = Math.hypot(dxMm, dyMm);
      const heightMm = wall.heightMm;

      return {
        // Plane geometry is centered, so the mesh sits at the wall midpoint,
        // lifted to half its height.
        positionX: ((wall.start.xMm + wall.end.xMm) / 2) * MM_TO_WORLD,
        positionY: (heightMm / 2) * MM_TO_WORLD,
        positionZ: ((wall.start.yMm + wall.end.yMm) / 2) * MM_TO_WORLD,
        // Rotate the plane's local +x (world x) onto the wall direction in the
        // xz-plane. World z = plan y, so the direction is (dx, dy) -> yaw of
        // atan2(-dy, dx); this also lands the front (+z) face on the inward
        // normal.
        rotationY: Math.atan2(-dyMm, dxMm),
        lengthWorld: lengthMm * MM_TO_WORLD,
        heightWorld: heightMm * MM_TO_WORLD
      };
    }, [wall]);

  return (
    <mesh position={[positionX, positionY, positionZ]} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[lengthWorld, heightWorld]} />
      <meshLambertMaterial color={WALL_COLOR} />
    </mesh>
  );
}
