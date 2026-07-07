import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import type { Scene3d } from "../../../domain/geometry/scene3d";
import { FloorObjectBox } from "./FloorObjectBox";
import { FloorSurface } from "./FloorSurface";
import { useArtworkTextures } from "./useArtworkTextures";
import { WallPanel } from "./WallPanel";

// Dumb mapper from the derived scene to meshes: one floor + one panel per wall
// per room, plus floor objects. No coordinate math lives here — it's all in
// scene3d.ts. Owns the texture lifecycle for every artwork visible in the
// scene (wall planes only — floor boxes are deliberately untextured, §5.3).
export function SceneRooms({
  scene,
  getBlob,
  selectedObjectIds,
  selectedArtworkId,
  selectedWallId,
  onSelectWall,
  onSelectObject,
  onClearSelection
}: {
  scene: Scene3d;
  getBlob: (key: string) => Promise<Blob>;
  selectedObjectIds: string[];
  selectedArtworkId: string | null;
  selectedWallId: string | null;
  onSelectWall: (wallId: string) => void;
  onSelectObject: (objectId: string, opts: { additive: boolean }) => void;
  onClearSelection: () => void;
}) {
  const assetIds = useMemo(
    () =>
      scene.rooms.flatMap((room) =>
        room.walls.flatMap((wall) => wall.artworks.map((artwork) => artwork.assetId))
      ),
    [scene]
  );
  const texturesByAssetId = useArtworkTextures(assetIds, getBlob);

  // Clicking bare floor settles/clears the object selection, same semantics
  // as Plan (spec §4.3). Floor objects consume their own clicks first; an
  // orbit drag's release (delta > a few px) never clears.
  const handleFloorClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > 6) return;
    onClearSelection();
  };

  return (
    <>
      {scene.rooms.map((room) => (
        <group key={room.roomId}>
          <FloorSurface polygon={room.floorPolygon} onClick={handleFloorClick} />
          {room.walls.map((wall) => (
            <WallPanel
              key={wall.wallId}
              wall={wall}
              texturesByAssetId={texturesByAssetId}
              isSelected={wall.wallId === selectedWallId}
              selectedObjectIds={selectedObjectIds}
              selectedArtworkId={selectedArtworkId}
              onSelectWall={onSelectWall}
              onSelectObject={onSelectObject}
            />
          ))}
        </group>
      ))}
      {scene.floorObjects.map((object) => (
        <FloorObjectBox
          key={object.objectId}
          object={object}
          isSelected={
            selectedObjectIds.includes(object.objectId) ||
            (object.artworkId !== undefined && object.artworkId === selectedArtworkId)
          }
          onSelect={onSelectObject}
        />
      ))}
    </>
  );
}
