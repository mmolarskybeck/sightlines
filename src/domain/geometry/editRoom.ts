import type { Project, Room, RoomVertex } from "../project";
import { getWallsWithGeometry } from "./walls";

type Vector = {
  xMm: number;
  yMm: number;
};

export type GeometryEditResult = {
  project: Project;
  changedWallIds: string[];
  anchorVertexId: string;
};

export function resizeWallPreservingAngles(
  project: Project,
  wallId: string,
  nextLengthMm: number
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
    anchorVertexId = wall.startVertexId;

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

    return {
      ...placement,
      room: resizeOrthogonalQuad(placement.room, wallIndex, nextLengthMm)
    };
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
    changedWallIds: getChangedWallIdsByLength(project, nextProject),
    anchorVertexId
  };
}

function canResizeAsOrthogonalQuad(room: Room, wallIndex: number): boolean {
  if (room.walls.length !== 4 || room.vertices.length !== 4) return false;

  const wall = room.walls[wallIndex];
  const nextWall = room.walls[(wallIndex + 1) % room.walls.length];
  const previousWall =
    room.walls[(wallIndex - 1 + room.walls.length) % room.walls.length];

  return (
    nextWall.startVertexId === wall.endVertexId &&
    previousWall.endVertexId === wall.startVertexId
  );
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
  const axis = normalize({
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
  const nextEnd = translate(nextStart, scale(axis, nextLengthMm));
  const nextNextCorner = translate(nextEnd, scale(sideDirection, sideLengthMm));
  const nextPreviousCorner = translate(
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

function findVertex(room: Room, vertexId: string): RoomVertex {
  const vertex = room.vertices.find((candidate) => candidate.id === vertexId);

  if (!vertex) {
    throw new Error(`Wall references missing vertex: ${vertexId}`);
  }

  return vertex;
}

function getChangedWallIdsByLength(
  previousProject: Project,
  nextProject: Project
): string[] {
  const previousLengthsById = new Map(
    previousProject.floor.rooms.flatMap((placement) =>
      getWallsWithGeometry(placement.room).map((wall) => [wall.id, wall.lengthMm])
    )
  );

  return nextProject.floor.rooms
    .flatMap((placement) => getWallsWithGeometry(placement.room))
    .filter((wall) => {
      const previousLength = previousLengthsById.get(wall.id);
      return previousLength === undefined || Math.abs(previousLength - wall.lengthMm) > 0.5;
    })
    .map((wall) => wall.id);
}

function chooseSideDirection(axis: Vector, sideVector: Vector): Vector {
  const normal = { xMm: -axis.yMm, yMm: axis.xMm };

  if (dot(normal, sideVector) >= 0) {
    return normal;
  }

  return scale(normal, -1);
}

function normalize(vector: Vector): Vector {
  const length = vectorLength(vector);

  if (length === 0) {
    throw new Error("Cannot resize a zero-length wall.");
  }

  return {
    xMm: vector.xMm / length,
    yMm: vector.yMm / length
  };
}

function vectorLength(vector: Vector): number {
  return Math.hypot(vector.xMm, vector.yMm);
}

function dot(a: Vector, b: Vector): number {
  return a.xMm * b.xMm + a.yMm * b.yMm;
}

function scale(vector: Vector, scalar: number): Vector {
  return {
    xMm: vector.xMm * scalar,
    yMm: vector.yMm * scalar
  };
}

function translate(
  point: Pick<RoomVertex, "xMm" | "yMm">,
  vector: Vector
): Pick<RoomVertex, "xMm" | "yMm"> {
  return {
    xMm: point.xMm + vector.xMm,
    yMm: point.yMm + vector.yMm
  };
}
