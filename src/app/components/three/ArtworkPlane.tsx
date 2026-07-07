import type { Texture } from "three";
import type { WallArtwork3d } from "../../../domain/geometry/scene3d";
import { mmToWorld } from "./coordinates";
import { DashedRectOutline, isUncertain } from "./UncertaintyOutline";

// Off-the-wall offset (spec §5.3): enough to never z-fight the wall plane,
// small enough to read as hanging flush.
const WALL_OFFSET_MM = 20;
// The uncertainty outline sits slightly proud of the artwork plane itself.
const OUTLINE_OFFSET_MM = 5;

// Neutral placeholder for artworks whose image is missing or still loading —
// a shade between the wall white and the floor grey so it reads as "a work
// goes here" rather than a hole in the wall.
const PLACEHOLDER_COLOR = "#e7e4df";

// One placed wall artwork, in WALL-LOCAL coordinates: the parent WallPanel
// group maps local +x along the wall, +y up from the floor, +z inward, so
// this component does no coordinate math beyond mm -> world (spec §5.1).
// MeshBasicMaterial + toneMapped:false keeps the image's colors faithful
// (spec §6.2) — lighting realism must never tint a work a curator is judging.
export function ArtworkPlane({
  artwork,
  texture
}: {
  artwork: WallArtwork3d;
  texture: Texture | undefined;
}) {
  const width = mmToWorld(artwork.widthMm);
  const height = mmToWorld(artwork.heightMm);

  return (
    <group
      position={[mmToWorld(artwork.xMm), mmToWorld(artwork.yMm), mmToWorld(WALL_OFFSET_MM)]}
    >
      <mesh>
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
    </group>
  );
}
