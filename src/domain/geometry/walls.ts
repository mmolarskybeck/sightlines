import type { Floor, Room, RoomPlacement, RoomVertex, Wall } from "../project";

export type WallWithGeometry = Wall & {
  start: RoomVertex;
  end: RoomVertex;
  lengthMm: number;
  angleRad: number;
};

export type OrthogonalQuadWallPair = {
  selectedWall: WallWithGeometry;
  pairedWall: WallWithGeometry;
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

export function getOrthogonalQuadWallPair(
  room: Room,
  wallId: string
): OrthogonalQuadWallPair | null {
  if (room.walls.length !== 4 || room.vertices.length !== 4) return null;

  const wallIndex = room.walls.findIndex((wall) => wall.id === wallId);
  if (wallIndex === -1 || !hasLoopingWallOrder(room, wallIndex)) return null;

  const walls = getWallsWithGeometry(room);
  const pairedWall = walls[(wallIndex + 2) % walls.length];
  const selectedWall = walls[wallIndex];

  if (!pairedWall || !selectedWall) return null;

  return {
    selectedWall,
    pairedWall
  };
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

export function getFloorBounds(floor: Floor) {
  if (floor.rooms.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0
    };
  }

  const roomBounds = floor.rooms.map(getPlacedRoomBounds);
  const minX = Math.min(...roomBounds.map((bounds) => bounds.minX));
  const minY = Math.min(...roomBounds.map((bounds) => bounds.minY));
  const maxX = Math.max(...roomBounds.map((bounds) => bounds.maxX));
  const maxY = Math.max(...roomBounds.map((bounds) => bounds.maxY));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function findVertex(room: Room, vertexId: string): RoomVertex {
  const vertex = room.vertices.find((candidate) => candidate.id === vertexId);

  if (!vertex) {
    throw new Error(`Wall references missing vertex: ${vertexId}`);
  }

  return vertex;
}

function hasLoopingWallOrder(room: Room, wallIndex: number): boolean {
  const wall = room.walls[wallIndex];
  const nextWall = room.walls[(wallIndex + 1) % room.walls.length];
  const previousWall =
    room.walls[(wallIndex - 1 + room.walls.length) % room.walls.length];

  return (
    nextWall.startVertexId === wall.endVertexId &&
    previousWall.endVertexId === wall.startVertexId
  );
}
