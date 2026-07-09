import type { Project, Room, RoomVertex } from "../project";
import { getWallGeometry, hasLoopingWallOrder, isRectangleRoom } from "./walls";
import { changedWallLengthIdsForProject, findVertex } from "./wallLoop";
import type { Vector2 } from "./vector";
import { add, dot, normalize as normalizeVec, scale, vectorLength } from "./vector";

// Which end of the wall stays fixed in WORLD space during a resize. The local
// resize always anchors the start vertex in room-local coordinates (see
// resizeOrthogonalQuad); "end" then translates the whole placement so the
// wall's end vertex, offset included, doesn't move — which is what lets a
// handle live on any of the four walls instead of only the down/right pair.
export type ResizeAnchor = "start" | "end";

export type GeometryEditResult = {
  project: Project;
  changedWallIds: string[];
  anchorVertexId: string;
};

export function resizeWallPreservingAngles(
  project: Project,
  wallId: string,
  nextLengthMm: number,
  anchor: ResizeAnchor = "start"
): GeometryEditResult {
  if (!Number.isFinite(nextLengthMm) || nextLengthMm <= 0) {
    throw new Error("Wall length must be greater than zero.");
  }

  let didUpdate = false;
  let anchorVertexId: string | null = null;

  const nextRooms = project.floor.rooms.map((placement) => {
    const wallIndex = placement.room.walls.findIndex(
      (candidate) => candidate.id === wallId
    );
    const wall = placement.room.walls[wallIndex];
    if (!wall) return placement;

    didUpdate = true;
    // Report whichever vertex actually held still in world space, so callers
    // (the store's lastGeometryEdit, the plan-view handles) can anchor UI to it.
    anchorVertexId = anchor === "end" ? wall.endVertexId : wall.startVertexId;

    if (!canResizeAsOrthogonalQuad(placement.room, wallIndex)) {
      // Rectangles are the only shape where "resize this wall" has one
      // unambiguous, still-orthogonal answer (opposite wall follows, the
      // other pair translates). For any other room shape, moving just this
      // wall's end vertex would skew its neighbor's angle — an edit numeric
      // length entry should never do silently. Reshaping non-rectangular
      // rooms is a future dedicated tool, not a side effect of this field.
      throw new Error(
        `Numeric length editing only supports rectangular rooms right now. "${placement.room.name}" isn't a simple rectangle.`
      );
    }

    const resizedRoom = resizeOrthogonalQuad(placement.room, wallIndex, nextLengthMm);
    if (anchor === "start") {
      return { ...placement, room: resizedRoom };
    }

    // resizeOrthogonalQuad grew the room away from the start vertex, so the
    // end vertex drifted by +(nextLength - previousLength) along the wall's
    // axis in room-local space. Cancelling that on the placement offset pins
    // the end vertex in world space and lets the start side move instead.
    const { lengthMm: previousLengthMm, start, end } = getWallGeometry(placement.room, wall);
    try {
      const axis = normalizeVec({ xMm: end.xMm - start.xMm, yMm: end.yMm - start.yMm });
      const shift = scale(axis, nextLengthMm - previousLengthMm);
      return {
        ...placement,
        offsetXMm: placement.offsetXMm - shift.xMm,
        offsetYMm: placement.offsetYMm - shift.yMm,
        room: resizedRoom
      };
    } catch (err) {
      throw new Error("Cannot resize a zero-length wall.");
    }
  });

  if (!didUpdate) {
    throw new Error(`Wall not found: ${wallId}`);
  }

  if (!anchorVertexId) {
    throw new Error(`Wall is missing an anchor vertex: ${wallId}`);
  }

  const nextProject = {
    ...project,
    floor: {
      rooms: nextRooms
    }
  };

  return {
    project: nextProject,
    changedWallIds: changedWallLengthIdsForProject(project, nextProject),
    anchorVertexId
  };
}

function canResizeAsOrthogonalQuad(room: Room, wallIndex: number): boolean {
  // resizeOrthogonalQuad rebuilds the quad from the wall axis and averaged
  // side lengths — run on anything but a true rectangle it silently squares
  // the shape (a trapezoid becomes a rectangle), so the right-angle check is
  // load-bearing, not just UI gating. hasLoopingWallOrder is walls.ts's own
  // closed-loop connectivity check; this gate is just that layered on top of
  // "is this room even a rectangle."
  return isRectangleRoom(room) && hasLoopingWallOrder(room, wallIndex);
}

function resizeOrthogonalQuad(
  room: Room,
  wallIndex: number,
  nextLengthMm: number
): Room {
  const wall = room.walls[wallIndex];
  const nextWall = room.walls[(wallIndex + 1) % room.walls.length];
  const previousWall =
    room.walls[(wallIndex - 1 + room.walls.length) % room.walls.length];

  const start = findVertex(room, wall.startVertexId);
  const end = findVertex(room, wall.endVertexId);
  const nextCorner = findVertex(room, nextWall.endVertexId);
  const previousCorner = findVertex(room, previousWall.startVertexId);
  const axis = normalizeVec({
    xMm: end.xMm - start.xMm,
    yMm: end.yMm - start.yMm
  });
  const sideDirection = chooseSideDirection(axis, {
    xMm: nextCorner.xMm - end.xMm,
    yMm: nextCorner.yMm - end.yMm
  });
  const sideLengthMm =
    (vectorLength({
      xMm: nextCorner.xMm - end.xMm,
      yMm: nextCorner.yMm - end.yMm
    }) +
      vectorLength({
        xMm: previousCorner.xMm - start.xMm,
        yMm: previousCorner.yMm - start.yMm
      })) /
    2;

  const nextStart = start;
  const nextEnd = add(nextStart, scale(axis, nextLengthMm));
  const nextNextCorner = add(nextEnd, scale(sideDirection, sideLengthMm));
  const nextPreviousCorner = add(
    nextStart,
    scale(sideDirection, sideLengthMm)
  );
  const replacementById = new Map<string, RoomVertex>([
    [start.id, nextStart],
    [end.id, { ...end, ...nextEnd }],
    [nextCorner.id, { ...nextCorner, ...nextNextCorner }],
    [previousCorner.id, { ...previousCorner, ...nextPreviousCorner }]
  ]);

  return {
    ...room,
    vertices: room.vertices.map((vertex) => replacementById.get(vertex.id) ?? vertex)
  };
}

function chooseSideDirection(axis: Vector2, sideVector: Vector2): Vector2 {
  const normal = { xMm: -axis.yMm, yMm: axis.xMm };

  if (dot(normal, sideVector) >= 0) {
    return normal;
  }

  return scale(normal, -1);
}
