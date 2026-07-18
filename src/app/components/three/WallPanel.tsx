import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Path, Shape, ShapeGeometry, type Texture } from "three";
import type { Artwork } from "../../../domain/project";
import { effectiveFraming } from "../../../domain/framing";
import type { WallPanel3d } from "../../../domain/geometry/scene3d";
import { ArtworkPlane } from "./ArtworkPlane";
import { WallTextPanel } from "./WallTextPanel";
import { mmToWorld, MM_TO_WORLD } from "./coordinates";
import {
  BLOCKED_ZONE_COLOR,
  GHOST_OPACITY,
  OPENING_CAP_COLOR,
  WALL_COLOR,
  WALL_SELECTED_COLOR,
  WINDOW_CAP_COLOR
} from "./tokens";

// Wall blocked zones are planning annotations, not physical (spec §5.3): a
// translucent wash in the same subdued grey family as the 2D hatch, flush to
// the wall (small offset to avoid z-fighting; less than the artworks' 20 mm
// so a zone never reads as covering a work).
const BLOCKED_ZONE_OPACITY = 0.15;
const BLOCKED_ZONE_OFFSET_MM = 6;
const OPENING_CAP_RECESS_MM = -30;
const WINDOW_CAP_OPACITY = 0.48;

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
  texturesByAssetId,
  artworksById,
  isSelected,
  selectedObjectIds,
  selectedArtworkId,
  onSelectWall,
  onSelectObject,
  ghosted = false
}: {
  wall: WallPanel3d;
  texturesByAssetId: ReadonlyMap<string, Texture>;
  // Source of the optional schematic framing (matWidthMm / frame): these live
  // on the Artwork record, not the derived WallArtwork3d, so the render layer
  // looks them up here rather than the domain carrying them through.
  artworksById: ReadonlyMap<string, Artwork>;
  isSelected: boolean;
  selectedObjectIds: string[];
  selectedArtworkId: string | null;
  onSelectWall: (wallId: string) => void;
  onSelectObject: (objectId: string, opts: { additive: boolean }) => void;
  // The wall crosses the active eye-level sightline: fade it (and everything
  // riding on it) to a hint so the viewed wall reads through.
  ghosted?: boolean;
}) {
  const { originX, originZ, rotationY, lengthWorld, heightWorld } = useMemo(() => {
    const dxMm = wall.end.xMm - wall.start.xMm;
    const dyMm = wall.end.yMm - wall.start.yMm;
    return {
      originX: wall.start.xMm * MM_TO_WORLD,
      originZ: wall.start.yMm * MM_TO_WORLD,
      // Rotate the group's local +x (world x) onto the wall direction in the
      // xz-plane. World z = plan y, so the direction is (dx, dy) -> yaw of
      // atan2(-dyMm, dxMm); this also lands the plane's front (+z) face on the
      // inward normal.
      rotationY: Math.atan2(-dyMm, dxMm),
      lengthWorld: Math.hypot(dxMm, dyMm) * MM_TO_WORLD,
      heightWorld: wall.heightMm * MM_TO_WORLD
    };
  }, [wall]);

  // The wall rectangle with door/window cutouts punched through as Shape
  // holes (spec §5.3). Shape coordinates are wall-local world units with the
  // origin at the wall's start-bottom corner, which is exactly the group's
  // local frame — so the mesh sits at the group origin, un-centered.
  const geometry = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(lengthWorld, 0);
    shape.lineTo(lengthWorld, heightWorld);
    shape.lineTo(0, heightWorld);
    shape.closePath();

    for (const hole of wall.holes) {
      const path = new Path();
      path.moveTo(mmToWorld(hole.xMinMm), mmToWorld(hole.yMinMm));
      path.lineTo(mmToWorld(hole.xMaxMm), mmToWorld(hole.yMinMm));
      path.lineTo(mmToWorld(hole.xMaxMm), mmToWorld(hole.yMaxMm));
      path.lineTo(mmToWorld(hole.xMinMm), mmToWorld(hole.yMaxMm));
      path.closePath();
      shape.holes.push(path);
    }

    return new ShapeGeometry(shape);
  }, [wall.holes, lengthWorld, heightWorld]);

  // R3F only auto-disposes on unmount; a geometry replaced by a re-derive
  // (resize, opening added) must be released here.
  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  // Event precedence (spec §4.3): artworks consume their clicks before this
  // fires; a bare wall click selects the wall and stops so the canvas
  // miss-handler doesn't also clear the selection.
  const handleWallClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    onSelectWall(wall.wallId);
  };

  return (
    <group position={[originX, 0, originZ]} rotation={[0, rotationY, 0]}>
      <mesh geometry={geometry} onClick={handleWallClick}>
        <meshLambertMaterial
          key={ghosted ? "ghosted" : "solid"}
          color={isSelected ? WALL_SELECTED_COLOR : WALL_COLOR}
          transparent={ghosted}
          opacity={ghosted ? GHOST_OPACITY : 1}
          depthWrite={!ghosted}
        />
      </mesh>
      {wall.holes
        .filter((hole) => hole.treatment === "capped")
        .map((hole, index) => (
          <mesh
            key={`cap-${index}`}
            onClick={handleWallClick}
            position={[
              mmToWorld((hole.xMinMm + hole.xMaxMm) / 2),
              mmToWorld((hole.yMinMm + hole.yMaxMm) / 2),
              mmToWorld(OPENING_CAP_RECESS_MM)
            ]}
          >
            <planeGeometry
              args={[
                mmToWorld(hole.xMaxMm - hole.xMinMm),
                mmToWorld(hole.yMaxMm - hole.yMinMm)
              ]}
            />
            <meshLambertMaterial
              key={ghosted ? "ghosted" : "solid"}
              color={hole.kind === "window" ? WINDOW_CAP_COLOR : OPENING_CAP_COLOR}
              transparent={ghosted || hole.kind === "window"}
              opacity={
                ghosted
                  ? GHOST_OPACITY
                  : hole.kind === "window"
                    ? WINDOW_CAP_OPACITY
                    : 1
              }
              depthWrite={!ghosted}
            />
          </mesh>
        ))}
      {wall.blockedZones.map((zone, index) => (
        <mesh
          key={index}
          visible={!ghosted}
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
      {wall.wallTexts.map((wallText) => (
        <WallTextPanel
          key={wallText.objectId}
          wallText={wallText}
          isSelected={selectedObjectIds.includes(wallText.objectId)}
          onSelect={onSelectObject}
          ghosted={ghosted}
        />
      ))}
      {wall.artworks.map((artwork) => {
        const record = artworksById.get(artwork.artworkId);
        // Single interpreter of frameIncludedInImage: a flagged work is handed
        // no band, so ArtworkPlane draws none (the frame is already in the photo).
        const framing = effectiveFraming(record);
        return (
          <ArtworkPlane
            key={artwork.objectId}
            artwork={artwork}
            texture={artwork.assetId ? texturesByAssetId.get(artwork.assetId) : undefined}
            matWidthMm={framing.matWidthMm}
            frame={framing.frame}
            isSelected={
              selectedObjectIds.includes(artwork.objectId) ||
              artwork.artworkId === selectedArtworkId
            }
            onSelect={onSelectObject}
            ghosted={ghosted}
          />
        );
      })}
    </group>
  );
}
