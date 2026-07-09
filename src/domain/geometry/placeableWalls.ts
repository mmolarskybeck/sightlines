// Canonical enumeration of "every surface an object can hang on" —
// perimeter walls ∪ partition faces (spec §5.3/§6.1). This is the one place
// that spells the union of getWallsWithGeometry and getFreestandingFaces;
// callers that need placeable surfaces (plan capture, placement validation,
// the wall list/selection in the app layer, and — eventually — the
// opening-pair UI's candidate-wall enumeration) should go through here
// rather than re-deriving the union themselves.
//
// scene3d.ts and RoomsPanel.tsx deliberately consume getFreestandingFaces
// alone (3D slab rendering, sidebar partition listing) — they want faces
// specifically, not the full placeable set, so they should NOT migrate to
// these functions.
import type { Project, Room } from "../project";
import { getFreestandingFaces } from "./freestandingWalls";
import { getWallsWithGeometry, type WallWithGeometry } from "./walls";

// Room-local geometry: perimeter walls first, then partition faces, exactly
// as produced by [...getWallsWithGeometry(room), ...getFreestandingFaces(room)].
export function getRoomPlaceableWalls(room: Room): WallWithGeometry[] {
  return [...getWallsWithGeometry(room), ...getFreestandingFaces(room)];
}

// Room-local geometry across every room on the floor (not lifted to floor
// coordinates — see getFloorWalls in planObjects.ts for the floor-space
// variant).
export function getProjectPlaceableWalls(project: Project): WallWithGeometry[] {
  return project.floor.rooms.flatMap((placement) => getRoomPlaceableWalls(placement.room));
}
