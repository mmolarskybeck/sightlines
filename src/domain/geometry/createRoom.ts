import type { Floor, RoomPlacement, RoomVertex, Wall } from "../project";
import { feetToMm } from "../units/length";
import { getFloorBounds } from "./walls";
import { isSimplePolygon, signedAreaMm2, type Point } from "./polygon";

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

// A drawn vertex sitting mid-straight-run rather than at a genuine corner —
// e.g. the user clicked several points along one wall while drawing. It's
// "straight" when its perpendicular deviation from the prev→next line is
// under 1mm, and "through" (not a backtrack/spike) when the walk prev→vertex
// and vertex→next continue in the same direction.
const COLLINEAR_DEVIATION_MM = 1;

function isStraightThroughVertex(prev: Point, vertex: Point, next: Point): boolean {
  const runLengthMm = Math.hypot(next.xMm - prev.xMm, next.yMm - prev.yMm);
  if (runLengthMm === 0) return false; // prev/next coincide — not this check's job

  const crossZ =
    (next.xMm - prev.xMm) * (vertex.yMm - prev.yMm) -
    (next.yMm - prev.yMm) * (vertex.xMm - prev.xMm);
  const deviationMm = Math.abs(crossZ) / runLengthMm;
  if (deviationMm >= COLLINEAR_DEVIATION_MM) return false;

  const dot =
    (vertex.xMm - prev.xMm) * (next.xMm - vertex.xMm) +
    (vertex.yMm - prev.yMm) * (next.yMm - vertex.yMm);
  return dot > 0;
}

// Drop every vertex that's a straight-through point relative to its ORIGINAL
// neighbours (wrap-around included, so a seam where drawing started mid-wall
// collapses too). A single pass keyed off the original array is sufficient:
// several extra points strung along one straight edge each compare against
// neighbours still on that same line, so every one of them drops out.
function dropStraightThroughVertices(points: Point[]): Point[] {
  const n = points.length;
  return points.filter((vertex, index) => {
    const prev = points[(index - 1 + n) % n];
    const next = points[(index + 1) % n];
    return !isStraightThroughVertex(prev, vertex, next);
  });
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

  // Merge draw-time collinear points (extra clicks along one straight wall,
  // including a seam where drawing started mid-wall) into their corners.
  local = dropStraightThroughVertices(local);
  if (local.length < 3) {
    throw new Error("A room needs at least three points.");
  }

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

export function createNextDrawnRectangleRoom(
  floor: Floor,
  heightMm: number,
  rect: { offsetXMm: number; offsetYMm: number; widthMm: number; depthMm: number }
): RoomPlacement {
  const roomNumber = getNextRoomNumber(floor);

  return createRectangularRoomPlacement({
    roomId: `room-${roomNumber}`,
    name: `Gallery ${roomNumber}`,
    heightMm,
    ...rect
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
