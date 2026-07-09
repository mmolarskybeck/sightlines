// Slice 2 (polygon reshape) — vertex drag and wall split. Same result shape
// and policy as editRoom.ts's resizeWallPreservingAngles: geometry moves,
// wall objects never do. An overhanging object becomes an advisory bounds
// warning the store surfaces via validateChangedWallPlacements, never a
// silent clamp/move.
import type { Floor, Project, Room, RoomPlacement, RoomVertex, Wall, WallObject } from "../project";
import type { GeometryEditResult } from "./editRoom";
import { getFloorWalls, projectPointToWall } from "./planObjects";
import { isSimplePolygon, type Point } from "./polygon";
import { findVertex } from "./wallLoop";
import { getWallGeometry } from "./walls";
import type { Vector2 } from "./vector";
import { add, normalize as normalizeVec, scale, vectorLength } from "./vector";

// Same floor as createRoom.ts's MIN_VERTEX_SPACING_MM — a vertex landing
// this close to a neighbour collapses a wall to (near) zero length, which
// breaks angle math and reads as a degenerate spike rather than a shape edit.
const MIN_VERTEX_SPACING_MM = 10;

function findRoomPlacementByRoomId(project: Project, roomId: string): RoomPlacement {
  const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
  if (!placement) {
    throw new Error(`Room not found: ${roomId}`);
  }
  return placement;
}

function findRoomPlacementByWallId(project: Project, wallId: string): RoomPlacement {
  const placement = project.floor.rooms.find((candidate) =>
    candidate.room.walls.some((wall) => wall.id === wallId)
  );
  if (!placement) {
    throw new Error(`Wall not found: ${wallId}`);
  }
  return placement;
}


// Sine of the angle between two UNIT direction vectors (d1, d2 must already
// be normalized) — 1e-3 is about 0.057°, tight enough to only reject
// genuinely (near-)parallel adjacent walls (which would otherwise produce an
// ill-conditioned, arbitrarily-far-off intersection point) while leaving any
// everyday corner angle untouched.
const LINE_PARALLEL_EPS = 1e-3;

// Intersection of two infinite lines, each given as a point plus a UNIT
// direction vector. Returns null when the lines are parallel (or close enough
// to it that the intersection is ill-conditioned) rather than a huge,
// meaningless point.
function intersectLines(p1: Point, d1: Vector2, p2: Point, d2: Vector2): Point | null {
  const cross = d1.xMm * d2.yMm - d1.yMm * d2.xMm;
  if (Math.abs(cross) < LINE_PARALLEL_EPS) return null;

  const diff: Vector2 = { xMm: p2.xMm - p1.xMm, yMm: p2.yMm - p1.yMm };
  const t = (diff.xMm * d2.yMm - diff.yMm * d2.xMm) / cross;
  return add(p1, scale(d1, t));
}

// CAD "offset/re-intersect" whole-wall drag (Sims-style): translate the
// dragged wall's infinite line by offsetMm along its own LEFT-normal (rotate
// its start→end axis 90° CCW — same convention as editRoom.ts's
// chooseSideDirection; a positive offsetMm is never sign-flipped). The
// previous and next walls stay on their existing infinite lines; only the
// dragged wall's start/end vertices move, to wherever those two lines now
// cross the translated line. Every other vertex in the room is untouched, and
// wall objects are never moved/clamped — an overhanging object becomes an
// advisory bounds warning the store surfaces, same policy as every op above.
export function moveRoomWall(
  project: Project,
  roomId: string,
  wallId: string,
  offsetMm: number
): GeometryEditResult {
  const placement = findRoomPlacementByRoomId(project, roomId);
  const room = placement.room;
  const wallIndex = room.walls.findIndex((candidate) => candidate.id === wallId);
  const wall = room.walls[wallIndex];
  if (!wall) {
    throw new Error(`Wall not found: ${wallId}`);
  }

  const n = room.walls.length;
  const previousWall = room.walls[(wallIndex - 1 + n) % n];
  const nextWall = room.walls[(wallIndex + 1) % n];

  const wallGeom = getWallGeometry(room, wall);
  const previousGeom = getWallGeometry(room, previousWall);
  const nextGeom = getWallGeometry(room, nextWall);

  try {
    var axis = normalizeVec({
      xMm: wallGeom.end.xMm - wallGeom.start.xMm,
      yMm: wallGeom.end.yMm - wallGeom.start.yMm
    });
  } catch {
    throw new Error("Cannot move a zero-length wall.");
  }
  const normal: Vector2 = { xMm: -axis.yMm, yMm: axis.xMm };
  try {
    var previousAxis = normalizeVec({
      xMm: previousGeom.end.xMm - previousGeom.start.xMm,
      yMm: previousGeom.end.yMm - previousGeom.start.yMm
    });
  } catch {
    throw new Error("Cannot move a zero-length wall.");
  }
  try {
    var nextAxis = normalizeVec({
      xMm: nextGeom.end.xMm - nextGeom.start.xMm,
      yMm: nextGeom.end.yMm - nextGeom.start.yMm
    });
  } catch {
    throw new Error("Cannot move a zero-length wall.");
  }

  const translatedPointMm = add(wallGeom.start, scale(normal, offsetMm));

  const newStart = intersectLines(previousGeom.start, previousAxis, translatedPointMm, axis);
  if (!newStart) {
    throw new Error("That wall isn’t allowed to move that way — its previous wall runs parallel to it.");
  }
  const newEnd = intersectLines(translatedPointMm, axis, nextGeom.start, nextAxis);
  if (!newEnd) {
    throw new Error("That wall isn’t allowed to move that way — its next wall runs parallel to it.");
  }

  if (
    vectorLength({
      xMm: newStart.xMm - previousGeom.start.xMm,
      yMm: newStart.yMm - previousGeom.start.yMm
    }) < MIN_VERTEX_SPACING_MM ||
    vectorLength({ xMm: newEnd.xMm - nextGeom.end.xMm, yMm: newEnd.yMm - nextGeom.end.yMm }) <
      MIN_VERTEX_SPACING_MM ||
    vectorLength({ xMm: newEnd.xMm - newStart.xMm, yMm: newEnd.yMm - newStart.yMm }) <
      MIN_VERTEX_SPACING_MM
  ) {
    throw new Error(
      "That wall isn’t allowed to move that far — it would collapse a corner too close to a neighbouring vertex."
    );
  }

  const nextVertices = room.vertices.map((vertex) => {
    if (vertex.id === wall.startVertexId) return { ...vertex, xMm: newStart.xMm, yMm: newStart.yMm };
    if (vertex.id === wall.endVertexId) return { ...vertex, xMm: newEnd.xMm, yMm: newEnd.yMm };
    return vertex;
  });

  if (!isSimplePolygon(nextVertices.map((vertex) => ({ xMm: vertex.xMm, yMm: vertex.yMm })))) {
    throw new Error("That wall isn’t allowed to move there — it would cross another wall.");
  }

  const nextRoom: Room = { ...room, vertices: nextVertices };

  return {
    project: replaceRoom(project, roomId, nextRoom),
    changedWallIds: [previousWall.id, wallId, nextWall.id],
    anchorVertexId: wall.startVertexId
  };
}

function replaceRoom(project: Project, roomId: string, nextRoom: Room): Project {
  return {
    ...project,
    floor: {
      rooms: project.floor.rooms.map((placement) =>
        placement.roomId === roomId ? { ...placement, room: nextRoom } : placement
      )
    }
  };
}

// Pure predicate: would moving `vertexId` to `nextLocalMm` keep the room a
// simple polygon with every vertex at least MIN_VERTEX_SPACING_MM from its
// neighbours? Shared by moveRoomVertex's guard and the plan view's live-drag
// validity check, so the preview and the commit can never disagree.
export function canMoveRoomVertex(room: Room, vertexId: string, nextLocalMm: Point): boolean {
  const index = room.vertices.findIndex((vertex) => vertex.id === vertexId);
  if (index === -1) return false;

  const n = room.vertices.length;
  const prev = room.vertices[(index - 1 + n) % n];
  const next = room.vertices[(index + 1) % n];
  if (
    Math.hypot(nextLocalMm.xMm - prev.xMm, nextLocalMm.yMm - prev.yMm) < MIN_VERTEX_SPACING_MM ||
    Math.hypot(nextLocalMm.xMm - next.xMm, nextLocalMm.yMm - next.yMm) < MIN_VERTEX_SPACING_MM
  ) {
    return false;
  }

  const candidatePoints: Point[] = room.vertices.map((vertex, candidateIndex) =>
    candidateIndex === index ? nextLocalMm : { xMm: vertex.xMm, yMm: vertex.yMm }
  );
  return isSimplePolygon(candidatePoints);
}

export function moveRoomVertex(
  project: Project,
  roomId: string,
  vertexId: string,
  nextLocalMm: Point
): GeometryEditResult {
  const placement = findRoomPlacementByRoomId(project, roomId);
  const room = placement.room;
  findVertex(room, vertexId); // throws if missing

  if (!canMoveRoomVertex(room, vertexId, nextLocalMm)) {
    throw new Error(
      "That vertex position isn’t allowed — it would cross another wall or sit too close to a neighbouring corner."
    );
  }

  const nextRoom: Room = {
    ...room,
    vertices: room.vertices.map((vertex) =>
      vertex.id === vertexId ? { ...vertex, xMm: nextLocalMm.xMm, yMm: nextLocalMm.yMm } : vertex
    )
  };

  const changedWallIds = room.walls
    .filter((wall) => wall.startVertexId === vertexId || wall.endVertexId === vertexId)
    .map((wall) => wall.id);

  return {
    project: replaceRoom(project, roomId, nextRoom),
    changedWallIds,
    anchorVertexId: vertexId
  };
}

// Pure id-generation, same idiom as createRoom.ts's getNextRoomNumber: the
// lowest unused `${prefix}-${n}` for the ids that already exist. Keeping it
// pure (no module-level counter) means splitWall stays a deterministic
// function of its inputs, like every other domain edit here.
function nextRoomLocalId(existingIds: Set<string>, prefix: string): string {
  let n = 1;
  while (existingIds.has(`${prefix}-${n}`)) {
    n += 1;
  }
  return `${prefix}-${n}`;
}

export function splitWall(
  project: Project,
  wallId: string,
  xAlongMm: number
): GeometryEditResult & { newWallId: string } {
  const placement = findRoomPlacementByWallId(project, wallId);
  const room = placement.room;
  const wallIndex = room.walls.findIndex((wall) => wall.id === wallId);
  const wall = room.walls[wallIndex];
  const geometry = getWallGeometry(room, wall);

  if (
    !Number.isFinite(xAlongMm) ||
    xAlongMm < MIN_VERTEX_SPACING_MM ||
    xAlongMm > geometry.lengthMm - MIN_VERTEX_SPACING_MM
  ) {
    throw new Error("Can’t split this close to a wall’s end — drag the split point further in.");
  }

  const t = xAlongMm / geometry.lengthMm;
  const newVertex: RoomVertex = {
    id: nextRoomLocalId(new Set(room.vertices.map((vertex) => vertex.id)), `${room.id}-v-split`),
    xMm: geometry.start.xMm + (geometry.end.xMm - geometry.start.xMm) * t,
    yMm: geometry.start.yMm + (geometry.end.yMm - geometry.start.yMm) * t
  };
  const newWallId = nextRoomLocalId(new Set(room.walls.map((candidate) => candidate.id)), `${room.id}-wall-split`);

  // First segment keeps the original id/name (preserves wallContextId,
  // selection, and its objects with center xMm <= xAlongMm unchanged); the
  // second gets a fresh id/name and the far half of the objects.
  const firstWall: Wall = { ...wall, endVertexId: newVertex.id };
  const secondWall: Wall = {
    ...wall,
    id: newWallId,
    name: `${wall.name} (split)`,
    startVertexId: newVertex.id,
    endVertexId: wall.endVertexId
  };

  // Insert the vertex right after the wall's start vertex, and the new wall
  // right after the original, so both arrays keep walking the loop in order
  // (vertex array order isn't schema-load-bearing, but keeping it parallel to
  // wall order is what "the right position" means in practice).
  const startVertexIndex = room.vertices.findIndex((vertex) => vertex.id === wall.startVertexId);
  const nextVertices = [
    ...room.vertices.slice(0, startVertexIndex + 1),
    newVertex,
    ...room.vertices.slice(startVertexIndex + 1)
  ];
  const nextWalls = [
    ...room.walls.slice(0, wallIndex),
    firstWall,
    secondWall,
    ...room.walls.slice(wallIndex + 1)
  ];

  const nextRoom: Room = { ...room, vertices: nextVertices, walls: nextWalls };

  const nextWallObjects: WallObject[] = project.wallObjects.map((wallObject) => {
    if (wallObject.wallId !== wallId || wallObject.xMm <= xAlongMm) return wallObject;
    return { ...wallObject, wallId: newWallId, xMm: wallObject.xMm - xAlongMm };
  });

  const nextProject: Project = {
    ...replaceRoom(project, placement.roomId, nextRoom),
    wallObjects: nextWallObjects
  };

  return {
    project: nextProject,
    changedWallIds: [wallId, newWallId],
    anchorVertexId: newVertex.id,
    newWallId
  };
}

export function deleteRoomVertex(project: Project, roomId: string, vertexId: string): GeometryEditResult {
  const placement = findRoomPlacementByRoomId(project, roomId);
  const room = placement.room;
  findVertex(room, vertexId); // throws if missing

  if (room.vertices.length <= 3) {
    throw new Error("A room needs at least three corners — this is the last one that can go.");
  }

  const enteringWallIndex = room.walls.findIndex((wall) => wall.endVertexId === vertexId);
  const exitingWallIndex = room.walls.findIndex((wall) => wall.startVertexId === vertexId);
  const enteringWall = room.walls[enteringWallIndex];
  const exitingWall = room.walls[exitingWallIndex];
  if (!enteringWall || !exitingWall) {
    throw new Error(`Vertex ${vertexId} isn’t shared by exactly two walls.`);
  }

  const candidateVertices = room.vertices.filter((vertex) => vertex.id !== vertexId);
  if (!isSimplePolygon(candidateVertices.map((vertex) => ({ xMm: vertex.xMm, yMm: vertex.yMm })))) {
    throw new Error("Removing that corner would cross another wall.");
  }

  // Merged wall keeps the entering wall's id/name (the "first" wall in loop
  // order) and now runs from the entering wall's start straight to the
  // exiting wall's end.
  const mergedWall: Wall = { ...enteringWall, endVertexId: exitingWall.endVertexId };

  // The two walls are adjacent in loop order (enteringWall.end === vertexId
  // === exitingWall.start), so exitingWallIndex is always right after
  // enteringWallIndex, cyclically — splice the exiting wall out and swap the
  // entering wall for its merged replacement in place.
  const nextWalls = room.walls
    .filter((wall) => wall.id !== exitingWall.id)
    .map((wall) => (wall.id === enteringWall.id ? mergedWall : wall));

  const nextRoom: Room = { ...room, vertices: candidateVertices, walls: nextWalls };

  // Reproject both walls' objects onto the merged segment by floor-space
  // center — the same math findNearestWall/projectPointToWall already do for
  // live placement capture, just run once here instead of interactively.
  const oldFloor: Floor = { rooms: [placement] };
  const oldFloorWalls = getFloorWalls(oldFloor);
  const oldEnteringFloorWall = oldFloorWalls.find((wall) => wall.id === enteringWall.id)!;
  const oldExitingFloorWall = oldFloorWalls.find((wall) => wall.id === exitingWall.id)!;

  const newPlacement: RoomPlacement = { ...placement, room: nextRoom };
  const newFloorWalls = getFloorWalls({ rooms: [newPlacement] });
  const mergedFloorWall = newFloorWalls.find((wall) => wall.id === mergedWall.id)!;

  const nextWallObjects: WallObject[] = project.wallObjects.map((wallObject) => {
    const sourceFloorWall =
      wallObject.wallId === enteringWall.id
        ? oldEnteringFloorWall
        : wallObject.wallId === exitingWall.id
          ? oldExitingFloorWall
          : null;
    if (!sourceFloorWall) return wallObject;

    const t = sourceFloorWall.lengthMm === 0 ? 0 : wallObject.xMm / sourceFloorWall.lengthMm;
    const floorPointMm: Point = {
      xMm: sourceFloorWall.startFloorMm.xMm + (sourceFloorWall.endFloorMm.xMm - sourceFloorWall.startFloorMm.xMm) * t,
      yMm: sourceFloorWall.startFloorMm.yMm + (sourceFloorWall.endFloorMm.yMm - sourceFloorWall.startFloorMm.yMm) * t
    };
    const projection = projectPointToWall(floorPointMm, mergedFloorWall);
    return { ...wallObject, wallId: mergedWall.id, xMm: projection.xAlongMm };
  });

  const nextProject: Project = {
    ...replaceRoom(project, roomId, nextRoom),
    wallObjects: nextWallObjects
  };

  return {
    project: nextProject,
    changedWallIds: [mergedWall.id],
    anchorVertexId: mergedWall.startVertexId
  };
}
