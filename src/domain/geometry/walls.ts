import type { Room, RoomPlacement, RoomVertex, Wall } from "../project";

export type WallWithGeometry = Wall & {
  start: RoomVertex;
  end: RoomVertex;
  lengthMm: number;
  angleRad: number;
};

export function getWallGeometry(room: Room, wall: Wall): WallWithGeometry {
  const start = findVertex(room, wall.startVertexId);
  const end = findVertex(room, wall.endVertexId);
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;

  return {
    ...wall,
    start,
    end,
    lengthMm: Math.hypot(dx, dy),
    angleRad: Math.atan2(dy, dx)
  };
}

export function getWallsWithGeometry(room: Room): WallWithGeometry[] {
  return room.walls.map((wall) => getWallGeometry(room, wall));
}

export function getRoomBounds(room: Room) {
  const xs = room.vertices.map((vertex) => vertex.xMm);
  const ys = room.vertices.map((vertex) => vertex.yMm);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function getPlacedRoomBounds(placement: RoomPlacement) {
  const bounds = getRoomBounds(placement.room);

  return {
    minX: bounds.minX + placement.offsetXMm,
    minY: bounds.minY + placement.offsetYMm,
    maxX: bounds.maxX + placement.offsetXMm,
    maxY: bounds.maxY + placement.offsetYMm,
    width: bounds.width,
    height: bounds.height
  };
}

function findVertex(room: Room, vertexId: string): RoomVertex {
  const vertex = room.vertices.find((candidate) => candidate.id === vertexId);

  if (!vertex) {
    throw new Error(`Wall references missing vertex: ${vertexId}`);
  }

  return vertex;
}
