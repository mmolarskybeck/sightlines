import type {
  Artwork,
  Dimensions,
  Project,
  RoomPlacement,
  WallObject
} from "../project";
import { getFreestandingFaces } from "./freestandingWalls";
import { evaluateOpeningPair } from "./openingConnections";
import { signedAreaMm2 } from "./polygon";
import { unitLeftNormalOrZero } from "./vector";
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
  treatment: "open" | "capped";
  connectedRoomId?: string;
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

// Wall-local, center-anchored didactic text panel. Like artworks it rides the
// wall face; the render layer draws the shared skeleton look (no real text).
export type WallText3d = {
  objectId: string;
  xMm: number; // wall-local center along the wall, from `start`
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
  wallTexts: WallText3d[];
};

// A partition slab (spec §7.1): two single-sided face panels (reusing
// WallPanel3d, so the render layer needs no new mesh logic) plus a cap outline
// the render layer thickens into top + 2 end caps so the slab reads solid.
export type FreestandingWall3d = {
  freestandingWallId: string;
  faces: [WallPanel3d, WallPanel3d];
  capOutline: { start: Vec2; end: Vec2; thicknessMm: number; heightMm: number };
};

export type Room3d = {
  roomId: string;
  floorPolygon: Vec2[]; // floor-space, wound counter-clockwise
  walls: WallPanel3d[];
  freestandingWalls: FreestandingWall3d[];
};

export type Scene3d = {
  rooms: Room3d[];
  floorObjects: FloorObject3d[];
};

const EMPTY_ARTWORKS: ReadonlyMap<string, Artwork> = new Map();

type OpenConnection3d = {
  clearX: { xMinMm: number; xMaxMm: number };
  clearY: { yMinMm: number; yMaxMm: number };
  connectedRoomId?: string;
};

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

  const roomIdByWallId = new Map(
    project.floor.rooms.flatMap((placement) =>
      placement.room.walls.map((wall) => [wall.id, placement.roomId] as const)
    )
  );
  const openConnectionsByObjectId = new Map<string, OpenConnection3d>();
  for (const a of project.wallObjects) {
    if (
      (a.kind !== "door" && a.kind !== "window") ||
      !a.connectsToObjectId ||
      a.id > a.connectsToObjectId
    ) {
      continue;
    }
    const b = project.wallObjects.find((candidate) => candidate.id === a.connectsToObjectId);
    if (
      !b ||
      (b.kind !== "door" && b.kind !== "window") ||
      b.connectsToObjectId !== a.id
    ) {
      continue;
    }
    const alignment = evaluateOpeningPair(project, a.id, b.id);
    if (alignment.status !== "aligned") continue;

    const verticalA = openingVerticalExtent(a);
    const verticalB = openingVerticalExtent(b);
    const clearY = {
      yMinMm: Math.max(verticalA.yMinMm, verticalB.yMinMm),
      yMaxMm: Math.min(verticalA.yMaxMm, verticalB.yMaxMm)
    };
    openConnectionsByObjectId.set(a.id, {
      clearX: alignment.clearA,
      clearY,
      connectedRoomId: roomIdByWallId.get(b.wallId)
    });
    openConnectionsByObjectId.set(b.id, {
      clearX: alignment.clearB,
      clearY,
      connectedRoomId: roomIdByWallId.get(a.wallId)
    });
  }

  return {
    rooms: project.floor.rooms.map((placement) =>
      deriveRoom(placement, wallObjectsByWallId, artworksById, openConnectionsByObjectId)
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
// into the room. This is the documented orientation contract the render layer
// relies on (WallPanel derives its yaw from the same start->end convention);
// asserted directly in tests via point-in-polygon probes.
export function wallInwardNormal(panel: WallPanel3d): Vec2 {
  return unitLeftNormalOrZero(panel.start, panel.end);
}

function deriveRoom(
  placement: RoomPlacement,
  wallObjectsByWallId: ReadonlyMap<string, WallObject[]>,
  artworksById: ReadonlyMap<string, Artwork>,
  openConnectionsByObjectId: ReadonlyMap<string, OpenConnection3d>
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

    const contents = derivePanelContents(
      wallObjectsByWallId.get(wall.id) ?? [],
      lengthMm,
      wall.heightMm,
      toPanelLocalX,
      artworksById,
      true,
      openConnectionsByObjectId
    );

    return {
      wallId: wall.id,
      start: oriented.start,
      end: oriented.end,
      heightMm: wall.heightMm,
      ...contents
    };
  });

  // Partition faces (spec §7.1). Each face keeps its DERIVED start→end (its
  // outward normal already points away from the slab, independent of room
  // winding), so no isCounterClockwise swap and panel-local x = object.xMm.
  // No holes in v1 (openings on partitions are disallowed, §2); blocked zones
  // and artworks are allowed. The centerline (unoffset) drives the cap outline.
  const faceById = new Map(getFreestandingFaces(room).map((face) => [face.id, face]));
  const freestandingWalls: FreestandingWall3d[] = room.freestandingWalls.map((partition) => {
    const faces = (["a", "b"] as const).map((side) => {
      const face = faceById.get(`${partition.id}#${side}`)!;
      const start = transformPoint(face.start, placement);
      const end = transformPoint(face.end, placement);
      const lengthMm = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
      const contents = derivePanelContents(
        wallObjectsByWallId.get(face.id) ?? [],
        lengthMm,
        face.heightMm,
        (xMm) => xMm,
        artworksById,
        false,
        openConnectionsByObjectId
      );
      return {
        wallId: face.id,
        start,
        end,
        heightMm: face.heightMm,
        ...contents
      };
    }) as [WallPanel3d, WallPanel3d];

    return {
      freestandingWallId: partition.id,
      faces,
      capOutline: {
        start: transformPoint({ xMm: partition.startXMm, yMm: partition.startYMm }, placement),
        end: transformPoint({ xMm: partition.endXMm, yMm: partition.endYMm }, placement),
        thicknessMm: partition.thicknessMm,
        heightMm: partition.heightMm
      }
    };
  });

  return {
    roomId: placement.roomId,
    floorPolygon,
    walls,
    freestandingWalls
  };
}

// The wall-local artworks/blockedZones/holes for one panel. Shared by perimeter
// walls (which may punch door/window holes) and partition faces (allowHoles
// false — openings on partitions are disallowed in v1, spec §2).
function derivePanelContents(
  objects: WallObject[],
  lengthMm: number,
  heightMm: number,
  toLocalX: (xMm: number) => number,
  artworksById: ReadonlyMap<string, Artwork>,
  allowHoles: boolean,
  openConnectionsByObjectId: ReadonlyMap<string, OpenConnection3d>
): {
  holes: Hole3d[];
  artworks: WallArtwork3d[];
  blockedZones: Rect3d[];
  wallTexts: WallText3d[];
} {
  const artworks: WallArtwork3d[] = [];
  const blockedZones: Rect3d[] = [];
  const holes: Hole3d[] = [];
  const wallTexts: WallText3d[] = [];
  for (const object of objects) {
    if (object.kind === "artwork") {
      const artwork = artworksById.get(object.artworkId);
      artworks.push({
        objectId: object.id,
        artworkId: object.artworkId,
        assetId: artwork?.assetId,
        status: artwork?.dimensions.status,
        xMm: toLocalX(object.xMm),
        yMm: object.yMm,
        widthMm: object.widthMm,
        heightMm: object.heightMm
      });
    } else if (object.kind === "wall-text") {
      wallTexts.push({
        objectId: object.id,
        xMm: toLocalX(object.xMm),
        yMm: object.yMm,
        widthMm: object.widthMm,
        heightMm: object.heightMm
      });
    } else if (object.kind === "blocked-zone") {
      const centerX = toLocalX(object.xMm);
      blockedZones.push({
        xMinMm: centerX - object.widthMm / 2,
        xMaxMm: centerX + object.widthMm / 2,
        yMinMm: object.yMm - object.heightMm / 2,
        yMaxMm: object.yMm + object.heightMm / 2
      });
    } else if (allowHoles) {
      // Door/window -> cutout. Doors run floor-to-top regardless of the stored
      // center (spec §5.1); windows keep their floating extent. The render layer
      // punches these through the wall verbatim.
      const openConnection = openConnectionsByObjectId.get(object.id);
      const ownVertical = openingVerticalExtent(object);
      const rawAuthoredXMin = openConnection?.clearX.xMinMm ?? object.xMm - object.widthMm / 2;
      const rawAuthoredXMax = openConnection?.clearX.xMaxMm ?? object.xMm + object.widthMm / 2;
      const panelX1 = toLocalX(rawAuthoredXMin);
      const panelX2 = toLocalX(rawAuthoredXMax);
      const rawXMin = Math.min(panelX1, panelX2);
      const rawXMax = Math.max(panelX1, panelX2);
      const rawYMin = openConnection?.clearY.yMinMm ?? ownVertical.yMinMm;
      const rawYMax = openConnection?.clearY.yMaxMm ?? ownVertical.yMaxMm;

      const xMinMm = Math.max(rawXMin, 0);
      const xMaxMm = Math.min(rawXMax, lengthMm);
      const yMinMm = Math.max(rawYMin, 0);
      const yMaxMm = Math.min(rawYMax, heightMm);

      // A hole clamped to nothing (entirely off the wall) would be a degenerate
      // Shape hole — drop it rather than break triangulation.
      if (xMinMm >= xMaxMm || yMinMm >= yMaxMm) continue;

      holes.push({
        kind: object.kind,
        xMinMm,
        xMaxMm,
        yMinMm,
        yMaxMm,
        clamped:
          xMinMm !== rawXMin ||
          xMaxMm !== rawXMax ||
          yMinMm !== rawYMin ||
          yMaxMm !== rawYMax,
        treatment: openConnection ? "open" : "capped",
        ...(openConnection?.connectedRoomId
          ? { connectedRoomId: openConnection.connectedRoomId }
          : {})
      });
    }
  }
  return { holes, artworks, blockedZones, wallTexts };
}

function openingVerticalExtent(
  opening: Extract<WallObject, { kind: "door" | "window" }>
): { yMinMm: number; yMaxMm: number } {
  return {
    yMinMm: opening.kind === "door" ? 0 : opening.yMm - opening.heightMm / 2,
    yMaxMm: opening.yMm + opening.heightMm / 2
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
