import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useState } from "react";
import type { Texture } from "three";
import type { WallArtwork3d } from "../../../domain/geometry/scene3d";
import { mmToWorld } from "./coordinates";
import {
  DashedRectOutline,
  isUncertain,
  SelectionRectOutline
} from "./UncertaintyOutline";

// Off-the-wall offset (spec §5.3): enough to never z-fight the wall plane,
// small enough to read as hanging flush.
const WALL_OFFSET_MM = 20;
// Outlines sit slightly proud of the artwork plane itself.
const OUTLINE_OFFSET_MM = 5;

// Neutral placeholder for artworks whose image is missing or still loading —
// a shade between the wall white and the floor grey so it reads as "a work
// goes here" rather than a hole in the wall.
const PLACEHOLDER_COLOR = "#e7e4df";

// One placed wall artwork, in WALL-LOCAL coordinates: the parent WallPanel
// group maps local +x along the wall, +y up from the floor, +z inward, so
// this component does no coordinate math beyond mm -> world (spec §5.1).
// MeshBasicMaterial + toneMapped:false keeps the image's colors faithful
// (spec §6.2) — lighting realism must never tint a work a curator is judging,
// which is also why selection is outline-only here, never a material tint.
export function ArtworkPlane({
  artwork,
  texture,
  isSelected,
  onSelect
}: {
  artwork: WallArtwork3d;
  texture: Texture | undefined;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
}) {
  const width = mmToWorld(artwork.widthMm);
  const height = mmToWorld(artwork.heightMm);
  // Desktop-only affordance (spec §4.3): a pointer cursor, nothing
  // load-bearing on hover.
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  // Event precedence (spec §4.3): the artwork consumes its click so the wall
  // beneath doesn't also select, and the canvas miss-handler doesn't clear.
  // event.delta > a few px means this "click" was an orbit drag's release.
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(artwork.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  return (
    <group
      position={[mmToWorld(artwork.xMm), mmToWorld(artwork.yMm), mmToWorld(WALL_OFFSET_MM)]}
    >
      <mesh
        onClick={handleClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[width, height]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} />
        ) : (
          <meshLambertMaterial color={PLACEHOLDER_COLOR} />
        )}
      </mesh>
      {isUncertain(artwork.status) ? (
        <group position={[0, 0, mmToWorld(OUTLINE_OFFSET_MM)]}>
          <DashedRectOutline
            widthMm={artwork.widthMm}
            heightMm={artwork.heightMm}
            status={artwork.status}
          />
        </group>
      ) : null}
      {isSelected ? (
        <group position={[0, 0, mmToWorld(OUTLINE_OFFSET_MM * 2)]}>
          <SelectionRectOutline widthMm={artwork.widthMm} heightMm={artwork.heightMm} />
        </group>
      ) : null}
    </group>
  );
}
