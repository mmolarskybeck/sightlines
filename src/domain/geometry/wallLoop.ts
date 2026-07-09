// Single home for the room-vertex-identity lookup and the wall-length-diff
// scan, both of which used to be copy-pasted independently in walls.ts,
// editRoom.ts, and reshapeRoom.ts. Everything here is pure and id-keyed —
// no geometry construction — so it has no reason to depend on anything but
// the project schema types plus walls.ts's wall-geometry builder.
import type { Project, Room, RoomVertex } from "../project";
import { getWallsWithGeometry } from "./walls";

// Canonical vertex-by-id lookup for a room. Walls (and callers reshaping a
// room) reference vertices by id rather than embedding them, so this is the
// one place that resolves the reference and throws if a room's vertex/wall
// data is inconsistent.
export function findVertex(room: Room, vertexId: string): RoomVertex {
  const vertex = room.vertices.find((candidate) => candidate.id === vertexId);

  if (!vertex) {
    throw new Error(`Vertex not found: ${vertexId}`);
  }

  return vertex;
}

// Which walls' lengths differ between two revisions of an entire PROJECT
// (every room, not just one) — same 0.5mm epsilon and id-matching semantics
// as walls.ts's per-room changedWallLengthIds, but scanning every placed
// room. Unlike that per-room version, a wall id that exists only in `next`
// counts as changed: a project-level diff can span an edit that adds or
// splits a wall, not just a single drag preview's length delta, so "no
// baseline to compare against" has to read as "changed," not "ignore."
export function changedWallLengthIdsForProject(previous: Project, next: Project): string[] {
  const previousLengthsById = new Map(
    previous.floor.rooms.flatMap((placement) =>
      getWallsWithGeometry(placement.room).map((wall) => [wall.id, wall.lengthMm] as const)
    )
  );

  return next.floor.rooms
    .flatMap((placement) => getWallsWithGeometry(placement.room))
    .filter((wall) => {
      const previousLengthMm = previousLengthsById.get(wall.id);
      return previousLengthMm === undefined || Math.abs(previousLengthMm - wall.lengthMm) > 0.5;
    })
    .map((wall) => wall.id);
}
