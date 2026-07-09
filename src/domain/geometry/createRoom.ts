import type { Floor, RoomPlacement, RoomVertex, Wall } from "../project";
import { feetToMm } from "../units/length";
import { getFloorBounds } from "./walls";
import { isSimplePolygon, type Point } from "./polygon";

// Consecutive draw points closer than this collapse to a zero-length wall, so
// the constructor rejects them (the draw tool guards against this too).
const MIN_VERTEX_SPACING_MM = 10;

type CreateRectangularRoomInput = {
  depthMm: number;
  heightMm: number;
  name: string;
  offsetXMm: number;
  offsetYMm: number;
  roomId: string;
  widthMm: number;
};

export function createRectangularRoomPlacement({
  depthMm,
  heightMm,
  name,
  offsetXMm,
  offsetYMm,
  roomId,
  widthMm
}: CreateRectangularRoomInput): RoomPlacement {
  if (widthMm <= 0 || depthMm <= 0 || heightMm <= 0) {
    throw new Error("Room dimensions must be greater than zero.");
  }

  return {
    roomId,
    offsetXMm,
    offsetYMm,
    rotationDeg: 0,
    room: {
      id: roomId,
      name,
      heightMm,
      freestandingWalls: [],
      vertices: [
        { id: `${roomId}-v-nw`, xMm: 0, yMm: 0 },
        { id: `${roomId}-v-ne`, xMm: widthMm, yMm: 0 },
        { id: `${roomId}-v-se`, xMm: widthMm, yMm: depthMm },
        { id: `${roomId}-v-sw`, xMm: 0, yMm: depthMm }
      ],
      walls: [
        {
          id: `${roomId}-wall-north`,
          roomId,
          name: "North wall",
          startVertexId: `${roomId}-v-nw`,
          endVertexId: `${roomId}-v-ne`,
          heightMm
        },
        {
          id: `${roomId}-wall-east`,
          roomId,
          name: "East wall",
          startVertexId: `${roomId}-v-ne`,
          endVertexId: `${roomId}-v-se`,
          heightMm
        },
        {
          id: `${roomId}-wall-south`,
          roomId,
          name: "South wall",
          startVertexId: `${roomId}-v-se`,
          endVertexId: `${roomId}-v-sw`,
          heightMm
        },
        {
          id: `${roomId}-wall-west`,
          roomId,
          name: "West wall",
          startVertexId: `${roomId}-v-sw`,
          endVertexId: `${roomId}-v-nw`,
          heightMm
        }
      ]
    }
  };
}

type CreatePolygonRoomInput = {
  roomId: string;
  name: string;
  heightMm: number;
  // Absolute floor-space points in draw order. Winding is normalised at
  // creation; the stored vertices are room-local (bbox-min origin).
  pointsFloorMm: Point[];
};

// Twice the signed area — sign is the winding: > 0 is counter-clockwise in the
// signed-area convention `deriveScene3d` uses (scene3d.ts `signedAreaMm2`).
function signedAreaMm2(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return sum / 2;
}

export function createPolygonRoomPlacement({
  roomId,
  name,
  heightMm,
  pointsFloorMm
}: CreatePolygonRoomInput): RoomPlacement {
  if (heightMm <= 0) {
    throw new Error("Room height must be greater than zero.");
  }
  const n = pointsFloorMm.length;
  if (n < 3) {
    throw new Error("A room needs at least three points.");
  }
  for (let i = 0; i < n; i += 1) {
    const a = pointsFloorMm[i];
    const b = pointsFloorMm[(i + 1) % n];
    if (Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm) < MIN_VERTEX_SPACING_MM) {
      throw new Error("Room points are too close together.");
    }
  }
  if (!isSimplePolygon(pointsFloorMm)) {
    throw new Error("Room outline can’t cross itself.");
  }

  // Placement offset = polygon bbox min, so vertices store room-local like the
  // rectangle constructor. Winding is invariant under this translation.
  const offsetXMm = Math.min(...pointsFloorMm.map((point) => point.xMm));
  const offsetYMm = Math.min(...pointsFloorMm.map((point) => point.yMm));

  let local: Point[] = pointsFloorMm.map((point) => ({
    xMm: point.xMm - offsetXMm,
    yMm: point.yMm - offsetYMm
  }));
  // Normalise to CCW ONCE, at creation only — after this, wall objects' xMm
  // depends on each wall's start/end identity, so the loop is never reversed
  // again (reshape blocks the self-intersection that could flip it).
  if (signedAreaMm2(local) <= 0) {
    local = local.slice().reverse();
  }

  const vertices: RoomVertex[] = local.map((point, index) => ({
    id: `${roomId}-v-${index}`,
    xMm: point.xMm,
    yMm: point.yMm
  }));
  const walls: Wall[] = vertices.map((vertex, index) => ({
    id: `${roomId}-wall-${index}`,
    roomId,
    name: `Wall ${index + 1}`,
    startVertexId: vertex.id,
    endVertexId: vertices[(index + 1) % vertices.length].id,
    heightMm
  }));

  return {
    roomId,
    offsetXMm,
    offsetYMm,
    rotationDeg: 0,
    room: {
      id: roomId,
      name,
      heightMm,
      freestandingWalls: [],
      vertices,
      walls
    }
  };
}

export function createNextPolygonRoom(
  floor: Floor,
  heightMm: number,
  pointsFloorMm: Point[]
): RoomPlacement {
  const roomNumber = getNextRoomNumber(floor);

  return createPolygonRoomPlacement({
    roomId: `room-${roomNumber}`,
    name: `Gallery ${roomNumber}`,
    heightMm,
    pointsFloorMm
  });
}

export function createNextRectangleRoom(
  floor: Floor,
  heightMm: number
): RoomPlacement {
  const roomNumber = getNextRoomNumber(floor);
  const roomId = `room-${roomNumber}`;
  const floorBounds = getFloorBounds(floor);

  return createRectangularRoomPlacement({
    roomId,
    name: `Gallery ${roomNumber}`,
    widthMm: feetToMm(20),
    depthMm: feetToMm(14),
    heightMm,
    offsetXMm: floorBounds.maxX + feetToMm(8),
    offsetYMm: floorBounds.minY
  });
}

function getNextRoomNumber(floor: Floor): number {
  const roomIds = new Set(floor.rooms.map((placement) => placement.roomId));
  let roomNumber = floor.rooms.length + 1;

  while (roomIds.has(`room-${roomNumber}`)) {
    roomNumber += 1;
  }

  return roomNumber;
}
