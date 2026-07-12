import { useMemo } from "react";
import type { Texture } from "three";
import type { Artwork } from "../../../domain/project";
import type { FreestandingWall3d } from "../../../domain/geometry/scene3d";
import { MM_TO_WORLD } from "./coordinates";
import { GHOST_OPACITY, WALL_COLOR } from "./tokens";
import { WallPanel } from "./WallPanel";

// A partition slab (spec §7.1): the two derived faces render as ordinary
// single-sided WallPanels (art on both sides, backface-culled per side), plus a
// top and two end caps built from the cap outline so the slab reads solid
// rather than hollow at grazing angles. The long sides are the face panels
// themselves, so only ~3 extra quads are added here.
export function PartitionSlab({
  partition,
  texturesByAssetId,
  artworksById,
  selectedObjectIds,
  selectedArtworkId,
  selectedWallId,
  onSelectWall,
  onSelectObject,
  ghosted = false
}: {
  partition: FreestandingWall3d;
  texturesByAssetId: ReadonlyMap<string, Texture>;
  artworksById: ReadonlyMap<string, Artwork>;
  selectedObjectIds: string[];
  selectedArtworkId: string | null;
  selectedWallId: string | null;
  onSelectWall: (wallId: string) => void;
  onSelectObject: (objectId: string, opts: { additive: boolean }) => void;
  // The slab crosses the active eye-level sightline: both faces and the caps
  // fade to a hint so the viewed wall reads through.
  ghosted?: boolean;
}) {
  const { originX, originZ, rotationY, lengthWorld, thicknessWorld, heightWorld } =
    useMemo(() => {
      const { start, end, thicknessMm, heightMm } = partition.capOutline;
      const dxMm = end.xMm - start.xMm;
      const dyMm = end.yMm - start.yMm;
      return {
        originX: start.xMm * MM_TO_WORLD,
        originZ: start.yMm * MM_TO_WORLD,
        // Same yaw convention as WallPanel: local +x runs start→end.
        rotationY: Math.atan2(-dyMm, dxMm),
        lengthWorld: Math.hypot(dxMm, dyMm) * MM_TO_WORLD,
        thicknessWorld: thicknessMm * MM_TO_WORLD,
        heightWorld: heightMm * MM_TO_WORLD
      };
    }, [partition.capOutline]);

  return (
    <group>
      {partition.faces.map((face) => (
        <WallPanel
          key={face.wallId}
          wall={face}
          texturesByAssetId={texturesByAssetId}
          artworksById={artworksById}
          isSelected={face.wallId === selectedWallId}
          selectedObjectIds={selectedObjectIds}
          selectedArtworkId={selectedArtworkId}
          onSelectWall={onSelectWall}
          onSelectObject={onSelectObject}
          ghosted={ghosted}
        />
      ))}
      {/* Caps in the slab's local frame (origin at the centerline start, +x
          along the partition, +z on the left normal): top spanning the full
          length/thickness, plus a rectangle capping each end. */}
      <group position={[originX, 0, originZ]} rotation={[0, rotationY, 0]}>
        <mesh position={[lengthWorld / 2, heightWorld, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[lengthWorld, thicknessWorld]} />
          <meshLambertMaterial
            key={ghosted ? "ghosted" : "solid"}
            color={WALL_COLOR}
            side={2}
            transparent={ghosted}
            opacity={ghosted ? GHOST_OPACITY : 1}
            depthWrite={!ghosted}
          />
        </mesh>
        <mesh position={[0, heightWorld / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[thicknessWorld, heightWorld]} />
          <meshLambertMaterial
            key={ghosted ? "ghosted" : "solid"}
            color={WALL_COLOR}
            side={2}
            transparent={ghosted}
            opacity={ghosted ? GHOST_OPACITY : 1}
            depthWrite={!ghosted}
          />
        </mesh>
        <mesh position={[lengthWorld, heightWorld / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[thicknessWorld, heightWorld]} />
          <meshLambertMaterial
            key={ghosted ? "ghosted" : "solid"}
            color={WALL_COLOR}
            side={2}
            transparent={ghosted}
            opacity={ghosted ? GHOST_OPACITY : 1}
            depthWrite={!ghosted}
          />
        </mesh>
      </group>
    </group>
  );
}
