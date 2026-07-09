import { getFreestandingFaces } from "../domain/geometry/freestandingWalls";
import { getWallsWithGeometry } from "../domain/geometry/walls";
import type { Project, Wall } from "../domain/project";

// Perimeter walls plus each partition's two derived faces (spec §5.3). Faces
// carry display names "Partition 1 — side A/B" (from getFreestandingFaces) and
// stable face ids, so the sidebar/elevation wall list treats them as walls.
export function getProjectWalls(project: Project) {
  return project.floor.rooms.flatMap((placement) => [
    ...getWallsWithGeometry(placement.room),
    ...getFreestandingFaces(placement.room)
  ]);
}

export function getSelectedWall(project: Project, selectedWallId: string | null) {
  const walls = getProjectWalls(project);
  return walls.find((wall) => wall.id === selectedWallId) ?? walls[0] ?? null;
}

export function getFirstWall(project: Project): Wall | null {
  return project.floor.rooms[0]?.room.walls[0] ?? null;
}
