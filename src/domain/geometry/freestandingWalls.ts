// Free-standing partitions (spec §5.2–§5.4, §6.4). A partition stores a
// centerline (inline room-local endpoints) plus thickness/height; its two
// placeable faces are DERIVED here, never stored, so they can never drift from
// the centerline. Everything downstream (plan capture, validation, elevation,
// 3D) consumes faces through the four injection choke points (spec §5.3).
import type {
  FreestandingWall,
  Project,
  Room,
  RoomPlacement,
  RoomVertex
} from "../project";
import type { GeometryEditResult } from "./editRoom";
import { getPartitionClearances } from "./partitionSpacing";
import { isPointInPolygon, type Point } from "./polygon";
import { unitLeftNormalOrZero } from "./vector";
import type { WallWithGeometry } from "./walls";

export const DEFAULT_FREESTANDING_THICKNESS_MM = 100;

// A partition endpoint this close (or closer) to its partner collapses the
// segment to zero length — rejected, same floor as the polygon constructors.
const MIN_ENDPOINT_SPACING_MM = 10;

// A derived, Wall-like face. `face` is the side; wall objects hang on the face
// id (`${freestandingWallId}#a|#b`), never on the bare partition id.
export type FreestandingFace = WallWithGeometry & {
  face: "a" | "b";
  freestandingWallId: string;
  thicknessMm: number;
};

// Centralized face-id parsing — never string-split at call sites (spec §5.3).
// The schema bans `#` in real wall/vertex/partition ids so these never collide.
export function faceWallId(freestandingWallId: string, face: "a" | "b"): string {
  return `${freestandingWallId}#${face}`;
}

export function parseFaceWallId(
  id: string
): { freestandingWallId: string; face: "a" | "b" } | null {
  const hashIndex = id.lastIndexOf("#");
  if (hashIndex === -1) return null;
  const face = id.slice(hashIndex + 1);
  if (face !== "a" && face !== "b") return null;
  return { freestandingWallId: id.slice(0, hashIndex), face };
}

// The two face ids of a partition, in a/b order — used by delete cascades and
// changedWallIds.
export function faceWallIdsOf(freestandingWallId: string): [string, string] {
  return [faceWallId(freestandingWallId, "a"), faceWallId(freestandingWallId, "b")];
}

// Derived faces for one room, in room-local coordinates (like
// getWallsWithGeometry — getFloorWalls lifts by the placement offset). Face A
// is on the LEFT normal of start→end and runs start→end; face B runs end→start
// (spec §5.3), so each face satisfies the perimeter contract "viewer on the
// left of the face's own start→end" and elevation/3D render mirror-correct with
// zero changes. Endpoints are offset ±thickness/2 along each face's OUTWARD
// normal from the centerline; length equals the centerline length.
export function getFreestandingFaces(room: Room): FreestandingFace[] {
  return room.freestandingWalls.flatMap((wall) => {
    const lengthMm = Math.hypot(wall.endXMm - wall.startXMm, wall.endYMm - wall.startYMm);
    const half = wall.thicknessMm / 2;
    // length 0 shouldn't happen (schema rejects coincident endpoints); the
    // OrZero variant preserves the never-divide-by-zero guard.
    const { xMm: nx, yMm: ny } = unitLeftNormalOrZero(
      { xMm: wall.startXMm, yMm: wall.startYMm },
      { xMm: wall.endXMm, yMm: wall.endYMm }
    );

    // Face A: viewer on the left of start→end; offset +normal, runs start→end.
    const faceA = buildFace(wall, "a", lengthMm, {
      startXMm: wall.startXMm + nx * half,
      startYMm: wall.startYMm + ny * half,
      endXMm: wall.endXMm + nx * half,
      endYMm: wall.endYMm + ny * half
    });
    // Face B: opposite side; offset -normal, runs end→start (endpoints swapped)
    // so the viewer's side is again on the left of the face's own start→end.
    const faceB = buildFace(wall, "b", lengthMm, {
      startXMm: wall.endXMm - nx * half,
      startYMm: wall.endYMm - ny * half,
      endXMm: wall.startXMm - nx * half,
      endYMm: wall.startYMm - ny * half
    });
    return [faceA, faceB];
  });
}

// A partition's floor-space centerline (offset applied) plus the fields the
// plan slab rect and labels need — the free-standing-wall counterpart of
// getFloorWalls (planObjects.ts), lifting per-room partitions by the
// placement offset into floor space.
export type FloorPartition = {
  wallId: string;
  roomId: string;
  startMm: Point;
  endMm: Point;
  thicknessMm: number;
  name: string;
};

export function getFloorPartitions(project: Project): FloorPartition[] {
  return project.floor.rooms.flatMap((placement) =>
    placement.room.freestandingWalls.map((wall) => ({
      wallId: wall.id,
      roomId: placement.roomId,
      startMm: {
        xMm: wall.startXMm + placement.offsetXMm,
        yMm: wall.startYMm + placement.offsetYMm
      },
      endMm: { xMm: wall.endXMm + placement.offsetXMm, yMm: wall.endYMm + placement.offsetYMm },
      thicknessMm: wall.thicknessMm,
      name: wall.name
    }))
  );
}

function buildFace(
  wall: FreestandingWall,
  face: "a" | "b",
  lengthMm: number,
  endpoints: { startXMm: number; startYMm: number; endXMm: number; endYMm: number }
): FreestandingFace {
  const id = faceWallId(wall.id, face);
  const start: RoomVertex = {
    id: `${id}:start`,
    xMm: endpoints.startXMm,
    yMm: endpoints.startYMm
  };
  const end: RoomVertex = {
    id: `${id}:end`,
    xMm: endpoints.endXMm,
    yMm: endpoints.endYMm
  };
  return {
    id,
    roomId: wall.roomId,
    name: `${wall.name} · Side ${face === "a" ? "A" : "B"}`,
    startVertexId: start.id,
    endVertexId: end.id,
    heightMm: wall.heightMm,
    ...(wall.defaultCenterlineHeightMm !== undefined
      ? { defaultCenterlineHeightMm: wall.defaultCenterlineHeightMm }
      : {}),
    start,
    end,
    lengthMm,
    angleRad: Math.atan2(end.yMm - start.yMm, end.xMm - start.xMm),
    face,
    freestandingWallId: wall.id,
    thicknessMm: wall.thicknessMm
  };
}

// ---------------------------------------------------------------------------
// Operations (spec §6.4). All return GeometryEditResult with both face ids in
// changedWallIds so the store's revalidation path re-checks placements on both
// sides. Previews stay local to the UI; each store gesture is one applyEdit.
// ---------------------------------------------------------------------------

function findPlacementByRoomId(project: Project, roomId: string): RoomPlacement {
  const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
  if (!placement) throw new Error(`Room not found: ${roomId}`);
  return placement;
}

function findPlacementByPartitionId(project: Project, wallId: string): RoomPlacement {
  const placement = project.floor.rooms.find((candidate) =>
    candidate.room.freestandingWalls.some((wall) => wall.id === wallId)
  );
  if (!placement) throw new Error(`Partition not found: ${wallId}`);
  return placement;
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

function updatePartition(
  project: Project,
  wallId: string,
  update: (wall: FreestandingWall) => FreestandingWall
): GeometryEditResult {
  const placement = findPlacementByPartitionId(project, wallId);
  const nextRoom: Room = {
    ...placement.room,
    freestandingWalls: placement.room.freestandingWalls.map((wall) =>
      wall.id === wallId ? update(wall) : wall
    )
  };
  const [faceA, faceB] = faceWallIdsOf(wallId);
  return {
    project: replaceRoom(project, placement.roomId, nextRoom),
    changedWallIds: [faceA, faceB],
    anchorVertexId: wallId
  };
}

// The room whose floor polygon (floor-space) contains a point — partition
// room-assignment (spec §6.4). First match wins.
export function roomIdContainingPoint(project: Project, pointFloorMm: Point): string | null {
  for (const placement of project.floor.rooms) {
    const polygon = placement.room.vertices.map((vertex) => ({
      xMm: vertex.xMm + placement.offsetXMm,
      yMm: vertex.yMm + placement.offsetYMm
    }));
    if (isPointInPolygon(pointFloorMm, polygon)) return placement.roomId;
  }
  return null;
}

function getNextPartitionNumber(room: Room): number {
  const ids = new Set(room.freestandingWalls.map((wall) => wall.id));
  let n = room.freestandingWalls.length + 1;
  while (ids.has(`${room.id}-partition-${n}`)) n += 1;
  return n;
}

// Create a partition from floor-space endpoints in a given room. Default
// thickness 100 mm, height = room.heightMm (spec §6.4). Endpoints are stored
// room-local (offset removed).
export function createFreestandingWall(
  project: Project,
  roomId: string,
  startFloorMm: Point,
  endFloorMm: Point
): { project: Project; wallId: string } {
  const placement = findPlacementByRoomId(project, roomId);
  const lengthMm = Math.hypot(
    endFloorMm.xMm - startFloorMm.xMm,
    endFloorMm.yMm - startFloorMm.yMm
  );
  if (lengthMm < MIN_ENDPOINT_SPACING_MM) {
    throw new Error("A partition needs two distinct endpoints.");
  }

  const number = getNextPartitionNumber(placement.room);
  const wall: FreestandingWall = {
    id: `${roomId}-partition-${number}`,
    roomId,
    name: `Partition ${number}`,
    startXMm: startFloorMm.xMm - placement.offsetXMm,
    startYMm: startFloorMm.yMm - placement.offsetYMm,
    endXMm: endFloorMm.xMm - placement.offsetXMm,
    endYMm: endFloorMm.yMm - placement.offsetYMm,
    heightMm: placement.room.heightMm,
    thicknessMm: DEFAULT_FREESTANDING_THICKNESS_MM
  };

  const nextRoom: Room = {
    ...placement.room,
    freestandingWalls: [...placement.room.freestandingWalls, wall]
  };
  return {
    project: replaceRoom(project, roomId, nextRoom),
    wallId: wall.id
  };
}

// Translate both endpoints by a floor-space delta (delta is a vector, so the
// placement offset cancels — room-local delta equals floor delta).
export function moveFreestandingWall(
  project: Project,
  wallId: string,
  deltaFloorMm: Point
): GeometryEditResult {
  return updatePartition(project, wallId, (wall) => ({
    ...wall,
    startXMm: wall.startXMm + deltaFloorMm.xMm,
    startYMm: wall.startYMm + deltaFloorMm.yMm,
    endXMm: wall.endXMm + deltaFloorMm.xMm,
    endYMm: wall.endYMm + deltaFloorMm.yMm
  }));
}

export function moveFreestandingEndpoint(
  project: Project,
  wallId: string,
  end: "start" | "end",
  nextFloorMm: Point
): GeometryEditResult {
  const placement = findPlacementByPartitionId(project, wallId);
  const localX = nextFloorMm.xMm - placement.offsetXMm;
  const localY = nextFloorMm.yMm - placement.offsetYMm;
  return updatePartition(project, wallId, (wall) => {
    const other =
      end === "start"
        ? { xMm: wall.endXMm, yMm: wall.endYMm }
        : { xMm: wall.startXMm, yMm: wall.startYMm };
    if (Math.hypot(localX - other.xMm, localY - other.yMm) < MIN_ENDPOINT_SPACING_MM) {
      throw new Error("A partition needs two distinct endpoints.");
    }
    return end === "start"
      ? { ...wall, startXMm: localX, startYMm: localY }
      : { ...wall, endXMm: localX, endYMm: localY };
  });
}

// Center a partition between whatever bounds it (spec §6.4) — perimeter walls
// AND neighboring partitions both count as boundaries. "normal" centers across
// the centerline's normal (equal FACE gap to the things the partition faces —
// the headline action); "axis" centers along the centerline direction (equal
// end-cap gap to the things off its ends). Clearances are the new four-sided,
// face-accurate set; if either side of the chosen axis misses (nothing on that
// side to measure against), the edit fails through the standard error path.
// Translating the centerline by half the difference of the two clearances
// equalizes them: after a shift of (plus − minus)/2 along the +side direction,
// both sides read (plus + minus)/2. (Span sides originate from opposite
// endpoints, but the same translation equalizes the two end gaps.)
export function centerFreestandingWallBetweenWalls(
  project: Project,
  wallId: string,
  axis: "normal" | "axis"
): GeometryEditResult {
  const placement = findPlacementByPartitionId(project, wallId);
  const partition = placement.room.freestandingWalls.find((wall) => wall.id === wallId);
  if (!partition) throw new Error(`Partition not found: ${wallId}`);

  const clearances = getPartitionClearances(placement.room, partition);
  const side = axis === "normal" ? clearances.normal : clearances.span;
  if (!side.plus.hit || !side.minus.hit) {
    throw new Error("Nothing on both sides to center between.");
  }

  const plusDir = side.plus.dirUnit;
  const shift = (side.plus.hit.distanceMm - side.minus.hit.distanceMm) / 2;
  const dx = plusDir.xMm * shift;
  const dy = plusDir.yMm * shift;
  return updatePartition(project, wallId, (wall) => ({
    ...wall,
    startXMm: wall.startXMm + dx,
    startYMm: wall.startYMm + dy,
    endXMm: wall.endXMm + dx,
    endYMm: wall.endYMm + dy
  }));
}

// Rotate to an absolute angle (degrees) about the centerline midpoint,
// preserving length (spec §6.4; drives the inspector's angle field).
export function rotateFreestandingWall(
  project: Project,
  wallId: string,
  angleDeg: number
): GeometryEditResult {
  return updatePartition(project, wallId, (wall) => {
    const midX = (wall.startXMm + wall.endXMm) / 2;
    const midY = (wall.startYMm + wall.endYMm) / 2;
    const half = Math.hypot(wall.endXMm - wall.startXMm, wall.endYMm - wall.startYMm) / 2;
    const angleRad = (angleDeg * Math.PI) / 180;
    const ux = Math.cos(angleRad) * half;
    const uy = Math.sin(angleRad) * half;
    return {
      ...wall,
      startXMm: midX - ux,
      startYMm: midY - uy,
      endXMm: midX + ux,
      endYMm: midY + uy
    };
  });
}

// Set the centerline length, keeping the angle. anchor "start" pins the start
// endpoint (end moves), "end" pins the end (start moves) — ResizeAnchor
// semantics mirroring editRoom.ts.
export function setFreestandingLength(
  project: Project,
  wallId: string,
  lengthMm: number,
  anchor: "start" | "end"
): GeometryEditResult {
  if (!Number.isFinite(lengthMm) || lengthMm < MIN_ENDPOINT_SPACING_MM) {
    throw new Error("Partition length must be greater than zero.");
  }
  return updatePartition(project, wallId, (wall) => {
    const dx = wall.endXMm - wall.startXMm;
    const dy = wall.endYMm - wall.startYMm;
    const current = Math.hypot(dx, dy);
    const ux = current === 0 ? 1 : dx / current;
    const uy = current === 0 ? 0 : dy / current;
    if (anchor === "start") {
      return {
        ...wall,
        endXMm: wall.startXMm + ux * lengthMm,
        endYMm: wall.startYMm + uy * lengthMm
      };
    }
    return {
      ...wall,
      startXMm: wall.endXMm - ux * lengthMm,
      startYMm: wall.endYMm - uy * lengthMm
    };
  });
}

export function setFreestandingThickness(
  project: Project,
  wallId: string,
  thicknessMm: number
): GeometryEditResult {
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    throw new Error("Partition thickness must be greater than zero.");
  }
  return updatePartition(project, wallId, (wall) => ({ ...wall, thicknessMm }));
}

export function setFreestandingHeight(
  project: Project,
  wallId: string,
  heightMm: number
): GeometryEditResult {
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    throw new Error("Partition height must be greater than zero.");
  }
  return updatePartition(project, wallId, (wall) => ({ ...wall, heightMm }));
}

// Geometry helpers for the inspector/plan tool.
export function getFreestandingLengthMm(wall: FreestandingWall): number {
  return Math.hypot(wall.endXMm - wall.startXMm, wall.endYMm - wall.startYMm);
}

export function getFreestandingAngleDeg(wall: FreestandingWall): number {
  return (
    (Math.atan2(wall.endYMm - wall.startYMm, wall.endXMm - wall.startXMm) * 180) / Math.PI
  );
}
