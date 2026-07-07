import type { Scene3d } from "../../../domain/geometry/scene3d";
import { FloorSurface } from "./FloorSurface";
import { WallPanel } from "./WallPanel";

// Dumb mapper from the derived scene to meshes: one floor + one panel per wall,
// per room. No coordinate math lives here — it's all in scene3d.ts.
export function SceneRooms({ scene }: { scene: Scene3d }) {
  return (
    <>
      {scene.rooms.map((room) => (
        <group key={room.roomId}>
          <FloorSurface polygon={room.floorPolygon} />
          {room.walls.map((wall) => (
            <WallPanel key={wall.wallId} wall={wall} />
          ))}
        </group>
      ))}
    </>
  );
}
