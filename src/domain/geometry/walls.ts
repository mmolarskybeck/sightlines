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

// Unit-direction dot tolerance for "these walls meet at 90°". Grid-snapped
// drawing produces exact right angles; this only needs to absorb float noise
// from reshape intersections, so anything visibly skewed stays excluded.
const PERPENDICULAR_DOT_EPSILON = 1e-6;

// A 4-wall loop is only a rectangle if every corner is a right angle. The
// count checks alone were written when rectangles were the only possible
// 4-wall room; polygon drawing can now produce trapezoids and other quads,
// which must never see rectangle-only UI or the orthogonal resize rebuild.
export function isRectangleRoom(room: Room): boolean {
  if (room.walls.length !== 4 || room.vertices.length !== 4) return false;
  if (!hasLoopingWallOrder(room, 0)) return false;

  const walls = getWallsWithGeometry(room);
  return walls.every((wall, index) => {
    const next = walls[(index + 1) % walls.length];
    if (wall.lengthMm === 0 || next.lengthMm === 0) return false;
    const dot =
      ((wall.end.xMm - wall.start.xMm) * (next.end.xMm - next.start.xMm) +
        (wall.end.yMm - wall.start.yMm) * (next.end.yMm - next.start.yMm)) /
      (wall.lengthMm * next.lengthMm);
    return Math.abs(dot) < PERPENDICULAR_DOT_EPSILON;
  });
}

export function getOrthogonalQuadWallPair(
  room: Room,
  wallId: string
): OrthogonalQuadWallPair | null {
  if (!isRectangleRoom(room)) return null;

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

export type RectangleRoomDimensions = {
  depthMm: number;
  depthWallId: string;
  widthMm: number;
  widthWallId: string;
};

// For a four-wall orthogonal loop, one opposing wall pair reads as "width"
// and the other as "depth" — this is what lets the sidebar show one width
// and one depth field instead of four independent wall rows.
export function getRectangleRoomDimensions(room: Room): RectangleRoomDimensions | null {
  if (!isRectangleRoom(room)) return null;

  const walls = getWallsWithGeometry(room);

  return {
    widthWallId: walls[0].id,
    widthMm: walls[0].lengthMm,
    depthWallId: walls[1].id,
    depthMm: walls[1].lengthMm
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
