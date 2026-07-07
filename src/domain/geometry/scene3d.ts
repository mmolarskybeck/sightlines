import type { Dimensions, Project, RoomPlacement } from "../project";
import { getWallsWithGeometry } from "./walls";

// Pure derivation: Project -> a serializable 3D scene description. NO three.js
// imports live here so the whole thing is unit-testable. The render layer
// (src/app/components/three) consumes this and never does coordinate math.
//
// All coordinates are floor-space millimetres (plan x/y), i.e. the same space
// the Konva plan view draws in. The render layer applies the single mm->world
// scale and the plan(x,y) -> three(x,z) axis mapping.

export type Vec2 = {
  xMm: number;
  yMm: number;
};

// Door/window cutout in wall-local coordinates (x along the wall from `start`,
// y up from the floor). No holes are emitted in M1 — the type and the empty
// `holes` array exist so the scene contract is stable when openings land (M3).
export type Hole3d = {
  kind: "door" | "window";
  xMinMm: number;
  xMaxMm: number;
  yMinMm: number;
  yMaxMm: number;
  clamped: boolean; // true if the source object overflowed wall bounds
};

// Wall-local axis-aligned rectangle (blocked zones); x along wall, y up.
export type Rect3d = {
  xMinMm: number;
  xMaxMm: number;
  yMinMm: number;
  yMaxMm: number;
};

// Wall-local, center-anchored artwork placement. Not populated in M1.
export type WallArtwork3d = {
  objectId: string;
  assetId?: string;
  status: Dimensions["status"];
  xMm: number; // wall-local center along the wall
  yMm: number; // wall-local center, 0 = floor
  widthMm: number;
  heightMm: number;
};

export type WallPanel3d = {
  wallId: string;
  // Floor-space endpoints. ORIENTATION CONVENTION: walls are wound so the room
  // interior is on the LEFT of `start -> end`, so the inward normal is always
  // rotate(end - start, +90°) = (-dy, dx). See `wallInwardNormal`. The single-
  // sided dollhouse walls (spec §5.3) depend on this holding for every wall.
  start: Vec2;
  end: Vec2;
  heightMm: number;
  holes: Hole3d[];
  artworks: WallArtwork3d[];
  blockedZones: Rect3d[];
};

export type Room3d = {
  roomId: string;
  floorPolygon: Vec2[]; // floor-space, wound counter-clockwise
  walls: WallPanel3d[];
};

export type Scene3d = {
  rooms: Room3d[];
};

export function deriveScene3d(project: Project): Scene3d {
  return {
    rooms: project.floor.rooms.map(deriveRoom)
  };
}

// The inward-facing unit normal for a wall panel: the left normal of
// `start -> end`. Walls are normalised (see `deriveRoom`) so this always points
// into the room. Exposed for the render layer (to face the single-sided wall
// inward) and asserted directly in tests.
export function wallInwardNormal(panel: WallPanel3d): Vec2 {
  const dx = panel.end.xMm - panel.start.xMm;
  const dy = panel.end.yMm - panel.start.yMm;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { xMm: 0, yMm: 0 };
  return { xMm: -dy / length, yMm: dx / length };
}

function deriveRoom(placement: RoomPlacement): Room3d {
  const { room } = placement;

  // Floor polygon in floor-space, wound to a canonical CCW so the left-normal
  // convention holds. Winding is invariant under the placement transform, so
  // measuring it after transforming is safe.
  let floorPolygon = room.vertices.map((vertex) => transformPoint(vertex, placement));
  const isCounterClockwise = signedAreaMm2(floorPolygon) > 0;
  if (!isCounterClockwise) {
    floorPolygon = floorPolygon.slice().reverse();
  }

  const walls: WallPanel3d[] = getWallsWithGeometry(room).map((wall) => {
    const start = transformPoint(wall.start, placement);
    const end = transformPoint(wall.end, placement);
    // For a clockwise loop the interior sits on the right of each edge, so
    // swapping endpoints flips the left-normal to point inward. This keeps the
    // convention identical for every room regardless of authored winding.
    const oriented = isCounterClockwise ? { start, end } : { start: end, end: start };

    return {
      wallId: wall.id,
      start: oriented.start,
      end: oriented.end,
      heightMm: wall.heightMm,
      holes: [],
      artworks: [],
      blockedZones: []
    };
  });

  return {
    roomId: placement.roomId,
    floorPolygon,
    walls
  };
}

// Room-local (x, y) -> floor-space (x, y): rotate about the room origin by
// `rotationDeg`, then translate by the placement offset.
function transformPoint(point: Vec2, placement: RoomPlacement): Vec2 {
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    xMm: point.xMm * cos - point.yMm * sin + placement.offsetXMm,
    yMm: point.xMm * sin + point.yMm * cos + placement.offsetYMm
  };
}

// Twice-signed-area sign tells winding: > 0 is counter-clockwise in math y-up.
function signedAreaMm2(polygon: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return sum / 2;
}
