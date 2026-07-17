import { getProjectPlaceableWalls } from "../domain/geometry/placeableWalls";
import { getOrthogonalQuadWallPair } from "../domain/geometry/walls";
import type { Project, Wall } from "../domain/project";
import type { WallDimensionLink } from "./components/inspectors/WallInspector";

// Perimeter walls plus each partition's two derived faces (spec §5.3). Faces
// carry display names "Partition 1 · Side A/B" (from getFreestandingFaces) and
// stable face ids, so the sidebar/elevation wall list treats them as walls.
export { getProjectPlaceableWalls as getProjectWalls };

export function getSelectedWall(project: Project, selectedWallId: string | null) {
  const walls = getProjectPlaceableWalls(project);
  return walls.find((wall) => wall.id === selectedWallId) ?? walls[0] ?? null;
}

export function getFirstWall(project: Project): Wall | null {
  return project.floor.rooms[0]?.room.walls[0] ?? null;
}

export function getWallDimensionLink(
  project: Project,
  wallId: string
): WallDimensionLink | null {
  for (const placement of project.floor.rooms) {
    const pair = getOrthogonalQuadWallPair(placement.room, wallId);
    if (!pair) continue;

    return {
      pairedWallName: pair.pairedWall.name,
      roomName: placement.room.name
    };
  }

  return null;
}

export function getWallNames(project: Project, wallIds: string[]): string[] {
  if (wallIds.length === 0) return [];

  const namesById = new Map(
    project.floor.rooms.flatMap((placement) =>
      placement.room.walls.map((wall) => [wall.id, wall.name])
    )
  );

  return wallIds.map((wallId) => namesById.get(wallId) ?? wallId);
}
