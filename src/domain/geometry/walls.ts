import type { Floor, Room, RoomPlacement, RoomVertex, Wall } from "../project";
import { isPointInPolygon } from "./polygon";
import { findVertex } from "./wallLoop";

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

// The single canonical "which perpendicular points OUT of the room" for a
// wall: a 1mm probe along the left normal against the room polygon finds
// which side the interior is on. Exact for concave shapes (an L's inner
// walls), where a centroid heuristic can pick the wrong side, and immune to
// winding assumptions. Room-local coordinates throughout — normals are
// placement-invariant since rooms never rotate (rotationDeg is
// schema-pinned to 0), so callers may pass either room-local or
// world-translated wall geometry.
export function outwardWallNormal(
  room: Room,
  wall: WallWithGeometry
): { xMm: number; yMm: number } {
  const dxMm = wall.end.xMm - wall.start.xMm;
  const dyMm = wall.end.yMm - wall.start.yMm;
  const lengthMm = Math.hypot(dxMm, dyMm) || 1;
  const left = { xMm: -dyMm / lengthMm, yMm: dxMm / lengthMm };

  const probe = {
    xMm: (wall.start.xMm + wall.end.xMm) / 2 + left.xMm,
    yMm: (wall.start.yMm + wall.end.yMm) / 2 + left.yMm
  };
  return isPointInPolygon(probe, room.vertices)
    ? { xMm: -left.xMm, yMm: -left.yMm }
    : left;
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

// Which walls' lengths differ between two revisions of the same room — the
// walls a live drag preview is actually changing, whatever the gesture
// (chip resize, wall slide, vertex drag). Matched by wall id (stable across
// every drag preview); walls that exist in only one revision are ignored (no
// mid-drag topology change produces those today). The epsilon absorbs float
// noise from intersection math, not real edits — a sub-half-millimetre
// "change" is nothing a curator can act on.
export function changedWallLengthIds(
  baseline: Room,
  preview: Room,
  epsilonMm = 0.5
): string[] {
  const baselineLengths = new Map(
    getWallsWithGeometry(baseline).map((wall) => [wall.id, wall.lengthMm])
  );

  return getWallsWithGeometry(preview)
    .filter((wall) => {
      const baselineLengthMm = baselineLengths.get(wall.id);
      return (
        baselineLengthMm !== undefined &&
        Math.abs(wall.lengthMm - baselineLengthMm) > epsilonMm
      );
    })
    .map((wall) => wall.id);
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

// Whether `wallIndex`'s wall connects to its neighbours in a proper closed
// loop (each wall's end is the next wall's start, going both directions) —
// shared with editRoom.ts, whose orthogonal-resize gate needs exactly this
// check layered on top of isRectangleRoom.
export function hasLoopingWallOrder(room: Room, wallIndex: number): boolean {
  const wall = room.walls[wallIndex];
  const nextWall = room.walls[(wallIndex + 1) % room.walls.length];
  const previousWall =
    room.walls[(wallIndex - 1 + room.walls.length) % room.walls.length];

  return (
    nextWall.startVertexId === wall.endVertexId &&
    previousWall.endVertexId === wall.startVertexId
  );
}
