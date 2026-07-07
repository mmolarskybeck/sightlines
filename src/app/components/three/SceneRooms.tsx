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
  getBlob
}: {
  scene: Scene3d;
  getBlob: (key: string) => Promise<Blob>;
}) {
  const assetIds = useMemo(
    () =>
      scene.rooms.flatMap((room) =>
        room.walls.flatMap((wall) => wall.artworks.map((artwork) => artwork.assetId))
      ),
    [scene]
  );
  const texturesByAssetId = useArtworkTextures(assetIds, getBlob);

  return (
    <>
      {scene.rooms.map((room) => (
        <group key={room.roomId}>
          <FloorSurface polygon={room.floorPolygon} />
          {room.walls.map((wall) => (
            <WallPanel
              key={wall.wallId}
              wall={wall}
              texturesByAssetId={texturesByAssetId}
            />
          ))}
        </group>
      ))}
      {scene.floorObjects.map((object) => (
        <FloorObjectBox key={object.objectId} object={object} />
      ))}
    </>
  );
}
