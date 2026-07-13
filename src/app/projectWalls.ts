import { getProjectPlaceableWalls } from "../domain/geometry/placeableWalls";
import type { Project, Wall } from "../domain/project";

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
