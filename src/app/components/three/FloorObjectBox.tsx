import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useState } from "react";
import { MathUtils } from "three";
import type { Texture } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import { mmToWorld } from "./coordinates";
import {
  DashedBoxOutline,
  isUncertain,
  SelectionBoxOutline
} from "./UncertaintyOutline";
import { BLOCKED_ZONE_COLOR, BOX_COLOR } from "./tokens";

// Planning annotation, not physical (spec §5.3) — same subdued grey family
// as the 2D blocked-zone hatch, as a translucent wash.
const BLOCKED_ZONE_OPACITY = 0.15;

// Sits just above the floor plane to avoid z-fighting.
const FLOOR_QUAD_OFFSET_MM = 2;

// Plan-space rotation (CCW in plan x/y) to a three.js yaw about +y: plan y
// maps to world +z, which flips handedness — the one place that sign lives.
function planRotationToYaw(rotationDeg: number): number {
  return -MathUtils.degToRad(rotationDeg);
}

// One floor-placed object: artwork boxes carry the work's image on every
// visible face (four sides + top) with the shared uncertainty edge treatment,
// blocked zones as flat translucent quads. When the artwork record or its asset
// is missing the box falls back to the neutral BOX_COLOR volume (texture
// undefined), never a broken image. Artwork boxes are click-to-select
// (spec §4.3) and consume their clicks so the floor beneath doesn't clear the
// selection; blocked zones stay inert and let the click fall through.
export function FloorObjectBox({
  object,
  texture,
  isSelected,
  onSelect
}: {
  object: FloorObject3d;
  texture: Texture | undefined;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
}) {
  const x = mmToWorld(object.xMm);
  const z = mmToWorld(object.yMm);
  const yaw = planRotationToYaw(object.rotationDeg);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && object.kind === "artwork");

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

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(object.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  const height = mmToWorld(object.heightMm);
  return (
    <group position={[x, height / 2, z]} rotation={[0, yaw, 0]}>
      <mesh
        onClick={handleClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry
          args={[mmToWorld(object.widthMm), height, mmToWorld(object.depthMm)]}
        />
        {/* Box default UVs map the full image onto each face (plain stretch per
            face, no aspect correction — acceptable for v1). Lambert lets the
            single light shade the faces so the box still reads as volume, same
            convention as the floor/walls. */}
        {texture ? (
          <meshLambertMaterial map={texture} />
        ) : (
          <meshLambertMaterial color={BOX_COLOR} />
        )}
      </mesh>
      {isUncertain(object.status) ? (
        <DashedBoxOutline
          widthMm={object.widthMm}
          heightMm={object.heightMm}
          depthMm={object.depthMm}
          status={object.status}
        />
      ) : null}
      {isSelected ? (
        <SelectionBoxOutline
          widthMm={object.widthMm + 20}
          heightMm={object.heightMm + 20}
          depthMm={object.depthMm + 20}
        />
      ) : null}
    </group>
  );
}
