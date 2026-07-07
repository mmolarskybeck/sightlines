import type {
  Artwork,
  Dimensions,
  Project,
  RoomPlacement,
  WallObject
} from "../project";
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

// Wall-local, center-anchored artwork placement. The placement's stored size
// is already placeholder-resolved (placeArtwork.ts), so no sizing rules live
// here; `status` (from the joined Artwork record) drives only the uncertainty
// treatment. assetId/status are undefined when the artwork record is missing
// — same neutral fallback the elevation view uses.
export type WallArtwork3d = {
  objectId: string;
  artworkId: string;
  assetId?: string;
  status?: Dimensions["status"];
  xMm: number; // wall-local center along the wall, measured from `start`
  yMm: number; // wall-local center, 0 = floor
  widthMm: number;
  heightMm: number;
};

// A floor-placed object (artwork pedestal-box or blocked zone), floor-space
// center coordinates — floor objects are stored in floor-space already, so no
// placement transform applies. rotationDeg keeps the plan-space convention;
// the render layer owns the single plan->three yaw mapping.
export type FloorObject3d = {
  objectId: string;
  kind: "artwork" | "blocked-zone";
  artworkId?: string;
  assetId?: string;
  status?: Dimensions["status"];
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  rotationDeg: number;
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
  floorObjects: FloorObject3d[];
};

const EMPTY_ARTWORKS: ReadonlyMap<string, Artwork> = new Map();

export function deriveScene3d(
  project: Project,
  artworksById: ReadonlyMap<string, Artwork> = EMPTY_ARTWORKS
): Scene3d {
  const wallObjectsByWallId = new Map<string, WallObject[]>();
  for (const object of project.wallObjects) {
    const list = wallObjectsByWallId.get(object.wallId);
    if (list) {
      list.push(object);
    } else {
      wallObjectsByWallId.set(object.wallId, [object]);
    }
  }

  return {
    rooms: project.floor.rooms.map((placement) =>
      deriveRoom(placement, wallObjectsByWallId, artworksById)
    ),
    floorObjects: project.floorObjects.map((object) => {
      const artwork =
        object.kind === "artwork" ? artworksById.get(object.artworkId) : undefined;
      return {
        objectId: object.id,
        kind: object.kind,
        ...(object.kind === "artwork"
          ? {
              artworkId: object.artworkId,
              assetId: artwork?.assetId,
              status: artwork?.dimensions.status
            }
          : {}),
        xMm: object.xMm,
        yMm: object.yMm,
        widthMm: object.widthMm,
        depthMm: object.depthMm,
        heightMm: object.heightMm,
        rotationDeg: object.rotationDeg
      };
    })
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

function deriveRoom(
  placement: RoomPlacement,
  wallObjectsByWallId: ReadonlyMap<string, WallObject[]>,
  artworksById: ReadonlyMap<string, Artwork>
): Room3d {
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
    const lengthMm = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
    // Domain wall-local x is measured from the AUTHORED start vertex. When the
    // endpoints were swapped above, panel-local x runs the other way — this is
    // the single place that remap happens (holes reuse it in M3).
    const toPanelLocalX = (xMm: number) =>
      isCounterClockwise ? xMm : lengthMm - xMm;

    const objects = wallObjectsByWallId.get(wall.id) ?? [];
    const artworks: WallArtwork3d[] = [];
    const blockedZones: Rect3d[] = [];
    for (const object of objects) {
      if (object.kind === "artwork") {
        const artwork = artworksById.get(object.artworkId);
        artworks.push({
          objectId: object.id,
          artworkId: object.artworkId,
          assetId: artwork?.assetId,
          status: artwork?.dimensions.status,
          xMm: toPanelLocalX(object.xMm),
          yMm: object.yMm,
          widthMm: object.widthMm,
          heightMm: object.heightMm
        });
      } else if (object.kind === "blocked-zone") {
        const centerX = toPanelLocalX(object.xMm);
        blockedZones.push({
          xMinMm: centerX - object.widthMm / 2,
          xMaxMm: centerX + object.widthMm / 2,
          yMinMm: object.yMm - object.heightMm / 2,
          yMaxMm: object.yMm + object.heightMm / 2
        });
      }
      // Doors/windows become holes in M3.
    }

    return {
      wallId: wall.id,
      start: oriented.start,
      end: oriented.end,
      heightMm: wall.heightMm,
      holes: [],
      artworks,
      blockedZones
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
