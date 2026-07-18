import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import type { Texture, Vector3 } from "three";
import type { Artwork } from "../../../domain/project";
import type { Scene3d } from "../../../domain/geometry/scene3d";
import { FloorCaseMesh } from "./CaseMesh";
import { FloorObjectBox } from "./FloorObjectBox";
import { FloorSurface } from "./FloorSurface";
import { PartitionSlab } from "./PartitionSlab";
import { useArtworkTextures } from "./useArtworkTextures";
import { WallPanel } from "./WallPanel";

// Every assetId drawn by the scene: wall/partition-face artworks plus floor
// objects. Exported so a caller that already owns a texture map (the offscreen
// snapshot renderer) can build it from the identical id list rather than
// re-deriving a slightly different one.
export function sceneArtworkAssetIds(scene: Scene3d): (string | undefined)[] {
  return [
    ...scene.rooms.flatMap((room) => [
      ...room.walls.flatMap((wall) => wall.artworks.map((artwork) => artwork.assetId)),
      ...room.freestandingWalls.flatMap((partition) =>
        partition.faces.flatMap((face) => face.artworks.map((artwork) => artwork.assetId))
      )
    ]),
    ...scene.floorObjects.map((object) => object.assetId)
  ];
}

// Dumb mapper from the derived scene to meshes: one floor + one panel per wall
// per room, plus floor objects. No coordinate math lives here — it's all in
// scene3d.ts. Owns the texture lifecycle for every artwork visible in the
// scene — wall planes and floor-placed artwork boxes share one texture per
// assetId — unless a caller passes its own prebuilt map (texturesByAssetId),
// in which case that map is used verbatim and no second load is started.
export function SceneRooms({
  scene,
  getBlob,
  artworksById,
  selectedObjectIds,
  selectedArtworkId,
  selectedWallId,
  onSelectWall,
  onSelectObject,
  onClearSelection,
  onFocusPoint,
  ghostedWallIds,
  texturesByAssetId: providedTextures
}: {
  scene: Scene3d;
  getBlob: (key: string) => Promise<Blob>;
  // Passed to wall panels so framed/matted works can read matWidthMm / frame
  // off the Artwork record (the derived scene doesn't carry them).
  artworksById: ReadonlyMap<string, Artwork>;
  selectedObjectIds: string[];
  selectedArtworkId: string | null;
  selectedWallId: string | null;
  onSelectWall: (wallId: string) => void;
  onSelectObject: (objectId: string, opts: { additive: boolean }) => void;
  onClearSelection: () => void;
  onFocusPoint: (point: Vector3) => void;
  // Walls (by wallId) and partitions (by freestandingWallId) crossing the
  // active eye-level sightline — rendered ghosted so the viewed wall stays
  // readable behind them (spec §4.2).
  ghostedWallIds: ReadonlySet<string>;
  // Optional caller-owned texture map (see sceneArtworkAssetIds above).
  texturesByAssetId?: ReadonlyMap<string, Texture>;
}) {
  const assetIds = useMemo(() => sceneArtworkAssetIds(scene), [scene]);
  const ownTextures = useArtworkTextures(providedTextures ? [] : assetIds, getBlob);
  const texturesByAssetId = providedTextures ?? ownTextures;

  // Clicking bare floor settles/clears the object selection, same semantics
  // as Plan (spec §4.3). Floor objects consume their own clicks first; an
  // orbit drag's release (delta > a few px) never clears.
  const handleFloorClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > 6) return;
    onClearSelection();
  };

  // One root-level double-click handler covers every surface: r3f reports the
  // nearest intersection's world point, so walls, floors, partitions, artworks
  // and floor objects all route to the same focus flight (spec §4.2).
  const handleFocusPoint = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onFocusPoint(event.point.clone());
  };

  return (
    <group onDoubleClick={handleFocusPoint}>
      {scene.rooms.map((room) => (
        <group key={room.roomId}>
          <FloorSurface polygon={room.floorPolygon} onClick={handleFloorClick} />
          {room.walls.map((wall) => (
            <WallPanel
              key={wall.wallId}
              wall={wall}
              texturesByAssetId={texturesByAssetId}
              artworksById={artworksById}
              isSelected={wall.wallId === selectedWallId}
              selectedObjectIds={selectedObjectIds}
              selectedArtworkId={selectedArtworkId}
              onSelectWall={onSelectWall}
              onSelectObject={onSelectObject}
              ghosted={ghostedWallIds.has(wall.wallId)}
            />
          ))}
          {room.freestandingWalls.map((partition) => (
            <PartitionSlab
              key={partition.freestandingWallId}
              partition={partition}
              texturesByAssetId={texturesByAssetId}
              artworksById={artworksById}
              selectedObjectIds={selectedObjectIds}
              selectedArtworkId={selectedArtworkId}
              selectedWallId={selectedWallId}
              onSelectWall={onSelectWall}
              onSelectObject={onSelectObject}
              ghosted={ghostedWallIds.has(partition.freestandingWallId)}
            />
          ))}
        </group>
      ))}
      {scene.floorObjects.map((object) => {
        const isSelected =
          selectedObjectIds.includes(object.objectId) ||
          (object.artworkId !== undefined && object.artworkId === selectedArtworkId);
        if (object.kind === "case") {
          return (
            <FloorCaseMesh
              key={object.objectId}
              object={object}
              isSelected={isSelected}
              onSelect={onSelectObject}
            />
          );
        }
        return (
          <FloorObjectBox
            key={object.objectId}
            object={object}
            texture={
              object.assetId ? texturesByAssetId.get(object.assetId) : undefined
            }
            isSelected={isSelected}
            onSelect={onSelectObject}
          />
        );
      })}
    </group>
  );
}
