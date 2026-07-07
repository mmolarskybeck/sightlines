import { MathUtils } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import { mmToWorld } from "./coordinates";
import { DashedBoxOutline, isUncertain } from "./UncertaintyOutline";

// Neutral matte volume — deliberately not textured (spec §5.3): draping an
// image over a pedestal box misleads more than it informs.
const BOX_COLOR = "#dbd8d2";

// Planning annotation, not physical (spec §5.3) — same subdued grey family
// as the 2D blocked-zone hatch, as a translucent wash.
const BLOCKED_ZONE_COLOR = "#565b60";
const BLOCKED_ZONE_OPACITY = 0.15;

// Sits just above the floor plane to avoid z-fighting.
const FLOOR_QUAD_OFFSET_MM = 2;

// Plan-space rotation (CCW in plan x/y) to a three.js yaw about +y: plan y
// maps to world +z, which flips handedness — the one place that sign lives.
function planRotationToYaw(rotationDeg: number): number {
  return -MathUtils.degToRad(rotationDeg);
}

// One floor-placed object: artwork pedestal-boxes as neutral volumes with the
// shared uncertainty edge treatment, blocked zones as flat translucent quads.
export function FloorObjectBox({ object }: { object: FloorObject3d }) {
  const x = mmToWorld(object.xMm);
  const z = mmToWorld(object.yMm);
  const yaw = planRotationToYaw(object.rotationDeg);

  if (object.kind === "blocked-zone") {
    return (
      <mesh
        position={[x, mmToWorld(FLOOR_QUAD_OFFSET_MM), z]}
        rotation={[-Math.PI / 2, 0, yaw]}
      >
        <planeGeometry args={[mmToWorld(object.widthMm), mmToWorld(object.depthMm)]} />
        <meshBasicMaterial
          color={BLOCKED_ZONE_COLOR}
          transparent
          opacity={BLOCKED_ZONE_OPACITY}
          depthWrite={false}
        />
      </mesh>
    );
  }

  const height = mmToWorld(object.heightMm);
  return (
    <group position={[x, height / 2, z]} rotation={[0, yaw, 0]}>
      <mesh>
        <boxGeometry
          args={[mmToWorld(object.widthMm), height, mmToWorld(object.depthMm)]}
        />
        <meshLambertMaterial color={BOX_COLOR} />
      </mesh>
      {isUncertain(object.status) ? (
        <DashedBoxOutline
          widthMm={object.widthMm}
          heightMm={object.heightMm}
          depthMm={object.depthMm}
          status={object.status}
        />
      ) : null}
    </group>
  );
}
