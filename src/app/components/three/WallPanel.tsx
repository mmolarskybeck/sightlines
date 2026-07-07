import { useMemo } from "react";
import type { Texture } from "three";
import type { WallPanel3d } from "../../../domain/geometry/scene3d";
import { ArtworkPlane } from "./ArtworkPlane";
import { mmToWorld, MM_TO_WORLD } from "./coordinates";

// Near-white wall — MeshLambertMaterial so the single directional light shades
// adjacent walls slightly differently and the room reads as volume (spec §6.2).
const WALL_COLOR = "#f4f2ef";

// Wall blocked zones are planning annotations, not physical (spec §5.3): a
// translucent wash in the same subdued grey family as the 2D hatch, flush to
// the wall (small offset to avoid z-fighting; less than the artworks' 20 mm
// so a zone never reads as covering a work).
const BLOCKED_ZONE_COLOR = "#565b60";
const BLOCKED_ZONE_OPACITY = 0.15;
const BLOCKED_ZONE_OFFSET_MM = 6;

// One zero-thickness, single-sided wall and everything placed on it. The group
// maps wall-local coordinates to the world: local +x runs start -> end, +y up
// from the floor, and +z is the inward normal — the derivation guarantees the
// winding (scene3d.ts `wallInwardNormal`), and rotating the group's +x onto
// (end - start) puts +z exactly on that inward normal. From outside the room
// the near walls are back-face-culled (invisible) while far walls read
// normally — the dollhouse effect (spec §5.3). Children (artworks, zones) are
// therefore pure wall-local placements with no coordinate math of their own.
export function WallPanel({
  wall,
  texturesByAssetId
}: {
  wall: WallPanel3d;
  texturesByAssetId: ReadonlyMap<string, Texture>;
}) {
  const { originX, originZ, rotationY, lengthWorld, heightWorld } = useMemo(() => {
    const dxMm = wall.end.xMm - wall.start.xMm;
    const dyMm = wall.end.yMm - wall.start.yMm;
    return {
      originX: wall.start.xMm * MM_TO_WORLD,
      originZ: wall.start.yMm * MM_TO_WORLD,
      // Rotate the group's local +x (world x) onto the wall direction in the
      // xz-plane. World z = plan y, so the direction is (dx, dy) -> yaw of
      // atan2(-dy, dx); this also lands the plane's front (+z) face on the
      // inward normal.
      rotationY: Math.atan2(-dyMm, dxMm),
      lengthWorld: Math.hypot(dxMm, dyMm) * MM_TO_WORLD,
      heightWorld: wall.heightMm * MM_TO_WORLD
    };
  }, [wall]);

  return (
    <group position={[originX, 0, originZ]} rotation={[0, rotationY, 0]}>
      <mesh position={[lengthWorld / 2, heightWorld / 2, 0]}>
        <planeGeometry args={[lengthWorld, heightWorld]} />
        <meshLambertMaterial color={WALL_COLOR} />
      </mesh>
      {wall.blockedZones.map((zone, index) => (
        <mesh
          key={index}
          position={[
            mmToWorld((zone.xMinMm + zone.xMaxMm) / 2),
            mmToWorld((zone.yMinMm + zone.yMaxMm) / 2),
            mmToWorld(BLOCKED_ZONE_OFFSET_MM)
          ]}
        >
          <planeGeometry
            args={[
              mmToWorld(zone.xMaxMm - zone.xMinMm),
              mmToWorld(zone.yMaxMm - zone.yMinMm)
            ]}
          />
          <meshBasicMaterial
            color={BLOCKED_ZONE_COLOR}
            transparent
            opacity={BLOCKED_ZONE_OPACITY}
            depthWrite={false}
          />
        </mesh>
      ))}
      {wall.artworks.map((artwork) => (
        <ArtworkPlane
          key={artwork.objectId}
          artwork={artwork}
          texture={artwork.assetId ? texturesByAssetId.get(artwork.assetId) : undefined}
        />
      ))}
    </group>
  );
}
