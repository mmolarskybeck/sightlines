import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { MathUtils } from "three";
import type { Texture } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import { mmToWorld } from "./coordinates";
import {
  planSuspensionWires,
  suspendedCenterYMm,
  SuspensionWires
} from "./SuspensionWires";
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
//
// An artwork box may also be SUSPENDED (baseHeightMm > 0): the box lifts off
// the floor and hangs from wires drawn up to the room's wall height. See
// SuspensionWires.tsx, which owns both halves of that rule.
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
  // Above the blocked-zone early return so the hook order never depends on the
  // object's kind. Memoized on the scene entry itself (deriveScene3d hands out
  // a fresh object only when the project actually changed) so the wire vertex
  // buffer downstream isn't rebuilt on every orbit frame.
  const wires = useMemo(() => planSuspensionWires(object), [object]);

  if (object.kind === "blocked-zone") {
    // A blocked zone deliberately IGNORES baseHeightMm and stays on the floor.
    // It is a planning annotation about floor AREA (spec §5.3) — "do not put
    // anything in this footprint" — not a physical volume; the 2D views draw it
    // as a hatched footprint for the same reason. Floating it would say the
    // floor beneath it is free, which inverts the annotation's meaning, and it
    // has no height to hover with (heightMm is 0 for zones).
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
  // The box is center-anchored, so its center rides at bottom edge + half the
  // height. With no baseHeightMm that is heightMm / 2 exactly as before —
  // halving is exact in binary floating point either side of the mm->world
  // scale, so a floor-resting box lands on the identical world y it always did.
  return (
    <group
      position={[x, mmToWorld(suspendedCenterYMm(object)), z]}
      rotation={[0, yaw, 0]}
    >
      <mesh
        onClick={handleClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry
          args={[mmToWorld(object.widthMm), height, mmToWorld(object.depthMm)]}
        />
        {/* Box default UVs map the full image onto each face (plain stretch per
            face, no aspect correction — acceptable for v1).

            The TEXTURED branch is MeshBasicMaterial + toneMapped:false, exactly
            like ArtworkPlane (spec §6.2: lighting realism must never tint a
            work a curator is judging). It is not a style choice — Lambert here
            was a bug. AMBIENT_LIGHT_INTENSITY is 2.9 (sceneConstants.ts), tuned
            to wash the near-white walls, so a Lambert-shaded artwork texture
            was multiplied ~3x and saturated to flat white: floor-placed works
            rendered as blank boxes while the same image on a wall rendered
            correctly. Most visible on a suspended projection board, whose whole
            purpose is showing the projected image.

            The UNTEXTURED fallback stays Lambert: with no image to be faithful
            to, per-face shading is what makes the neutral box read as a volume
            rather than a flat silhouette. */}
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} />
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
      {/* Inside the yawed group on purpose: the wires attach to the board's
          top corners, so the same rotation that turns the box has to turn
          them. `fromLocalYMm` is the box's half-height because this group's
          origin is the box CENTER, not its top. */}
      {wires ? (
        <SuspensionWires plan={wires} fromLocalYMm={object.heightMm / 2} />
      ) : null}
    </group>
  );
}
