import { getArtworkOuterDimensionsMm } from "../framing";
import {
  getFloorPartitions,
  type FloorPartition
} from "../geometry/freestandingWalls";
import {
  evaluateOpeningPair,
  type OpeningAlignment
} from "../geometry/openingConnections";
import {
  getFloorObjectPlanRect,
  getFloorWalls,
  getWallObjectPlanRect,
  offsetPlanRectToViewerSide,
  planRectIntersectsRect,
  segmentPlanRect,
  type PlanRect
} from "../geometry/planObjects";
import type { Point } from "../geometry/polygon";
import type {
  Artwork,
  FloorObject,
  Project,
  RoomPlacement,
  WallObject
} from "../project";

// Pure derivation: Project -> the static plan-view drawing, as plain-data
// primitives (the scene3d.ts idea applied to the 2D plan). PlanView maps
// these to SVG elements, and the upcoming PNG/PDF exports will draw the SAME
// scene — one derivation, so an export can never disagree with the canvas.
// Deliberately static-only: drag previews, ghosts, snap guides, selection
// chrome and hit targets stay in the view (they are gestures, not drawing).
//
// Entries carry a reference to their source project object (`placement` /
// `object`) alongside the derived rects: the interactive view needs the
// source record to wire selection/drag handlers without a second id lookup,
// and it's project data, so the scene stays serializable.

// One perimeter wall lifted into floor space (offset applied — rooms never
// rotate, rotationDeg is schema-pinned to 0, same as getFloorWalls).
export type PlanSceneWall = {
  wallId: string;
  startMm: Point;
  endMm: Point;
};

export type PlanSceneRoom = {
  placement: RoomPlacement;
  roomId: string;
  // World-space vertex loop — one boundary shared by the floor fill, the
  // floor hit target, and the selected-room outline/wash, so all of them
  // always trace exactly the same polygon.
  polygonMm: Point[];
  walls: PlanSceneWall[];
};

export type PlanScenePartition = {
  partition: FloorPartition;
  // The filled slab: centerline lifted to a center+size+angle rect at the
  // partition's own thickness.
  rect: PlanRect;
};

// The advisory glyph linking a connected door/window pair: a line between
// the two openings' plan centers with a status dot at its midpoint.
export type PlanSceneOpeningConnection = {
  id: string;
  aCenterMm: Point;
  bCenterMm: Point;
  midMm: Point;
  status: OpeningAlignment["status"];
};

export type PlanSceneWallObject = {
  object: WallObject;
  // The joined artwork record (undefined for openings or a dangling
  // artworkId) — exports and tooltips both read title/frame/mat from here.
  artwork?: Artwork;
  // Centered ON the wall line at true model depth — the geometric anchor
  // (drag math starts from this center/angle), NOT what paints.
  restRect: PlanRect;
  // What actually paints at rest: getRenderedWallObjectPlanRect applied to
  // restRect (artwork framed + shifted to the viewer's side, min-depth clamp).
  renderedRect: PlanRect;
};

export type PlanSceneFloorObject = {
  object: FloorObject;
  artwork?: Artwork;
  rect: PlanRect;
};

export type PlanScene = {
  rooms: PlanSceneRoom[];
  partitions: PlanScenePartition[];
  openingConnections: PlanSceneOpeningConnection[];
  wallObjects: PlanSceneWallObject[];
  floorObjects: PlanSceneFloorObject[];
};

export type PlanSceneOptions = {
  artworksById?: ReadonlyMap<string, Artwork>;
  // On-screen/on-page floor for a wall object's off-wall depth, in mm at the
  // current scale (the caller converts from px or print units). Doors and
  // windows are thin by design and would vanish to a hairline when the scale
  // is small; 0 (the default) keeps true model depth.
  minWallObjectDepthMm?: number;
};

export type PlanScenePaintEntry<W, F> =
  | { group: "wall"; entry: W }
  | { group: "floor"; entry: F };

// Paint order for plan-scene objects: cases first, then everything else,
// across BOTH the wall and floor groups. An artwork hangs above a case's
// glass top, so seen from above the artwork rect must cover the case wherever
// their footprints overlap — never the reverse, and (both fills being opaque)
// never "through" either one. The partition crosses the two groups because a
// wall artwork can sit over a wall case or over a floor case pushed flush to
// the wall. Every surface that paints a plan scene (SVG canvas, PDF export)
// must consume this one ordering so overlap resolution can never drift
// between screen and print. Order within each phase is stable.
export function planScenePaintOrder<
  W extends { object: { kind: string } },
  F extends { object: { kind: string } }
>(wallObjects: readonly W[], floorObjects: readonly F[]): PlanScenePaintEntry<W, F>[] {
  const isCase = (entry: { object: { kind: string } }) => entry.object.kind === "case";
  return [
    ...wallObjects.filter(isCase).map((entry): PlanScenePaintEntry<W, F> => ({ group: "wall", entry })),
    ...floorObjects.filter(isCase).map((entry): PlanScenePaintEntry<W, F> => ({ group: "floor", entry })),
    ...wallObjects.filter((entry) => !isCase(entry)).map((entry): PlanScenePaintEntry<W, F> => ({ group: "wall", entry })),
    ...floorObjects.filter((entry) => !isCase(entry)).map((entry): PlanScenePaintEntry<W, F> => ({ group: "floor", entry }))
  ];
}

export type PlanMarqueeRect = {
  minXMm: number;
  maxXMm: number;
  minYMm: number;
  maxYMm: number;
};

// Hit-test the same rectangles the plan scene paints. Wall artwork is the
// important case: renderedRect includes its framed outer width and the
// viewer-side offset, while openings remain centered on the wall and floor
// objects keep their stored footprint.
export function getPlanSceneObjectIdsIntersectingRect(
  scene: Pick<PlanScene, "wallObjects" | "floorObjects">,
  marqueeRect: PlanMarqueeRect
): string[] {
  return [
    ...scene.wallObjects
      .filter(({ renderedRect }) => planRectIntersectsRect(renderedRect, marqueeRect))
      .map(({ object }) => object.id),
    ...scene.floorObjects
      .filter(({ rect }) => planRectIntersectsRect(rect, marqueeRect))
      .map(({ object }) => object.id)
  ];
}

// The SVG <polygon points> encoding of a world-space loop. Trivial, but
// keeping the one formatter here means every consumer of polygonMm renders
// the identical string.
export function svgPolygonPoints(polygonMm: Point[]): string {
  return polygonMm.map((point) => `${point.xMm},${point.yMm}`).join(" ");
}

// How a wall-anchored object's rect actually paints, given the rect it
// occupies (rest OR a live drag preview — the view calls this on preview
// rects mid-gesture so the drawing never disagrees between mid-drag and
// on-release):
// - ARTWORK widens along the wall to its mat/frame outer width (plan mode is
//   a simple dim change; the off-wall depth stays the schematic face width,
//   not a projection), then shifts to the viewer's side of the wall line
//   (spec §5.3) so back-to-back works on a shared wall's two faces don't
//   overlap. A CASE isn't widened (no mat/frame) but is likewise shifted to
//   the viewer's side: its box is cantilevered off the wall and protrudes
//   into the room, so its rest rect's long edge lands flush ON the wall line
//   with its depth protruding inward. Doors/windows/blocked-zones pass through
//   the wall, so they stay centered on it.
// - Every kind then gets the min-depth floor. The viewer-side offset is
//   deliberately computed from the PRE-clamp depth (the model's
//   WALL_OBJECT_PLAN_DEPTH_MM), so zoom never moves an artwork's center.
//
// `sizing` is the rect's PROVENANCE, a fact independent of whether the artwork
// is framed — the two must not share one channel. An "outer" rect has already
// been widened upstream (resolvePlanPlacement returns one for a single-drag
// preview) and widening it again would double the mat/frame band; an "image"
// rect carries the stored image size and still needs widening. An "outer" rect
// still needs THIS function for the viewer-side offset and the min-depth clamp,
// which apply in both cases — that is why such callers must pass sizing rather
// than skip the call.
export function getRenderedWallObjectPlanRect(
  planRect: PlanRect,
  kind: WallObject["kind"],
  artwork: Pick<Artwork, "matWidthMm" | "frame"> | undefined,
  minDepthMm: number,
  sizing: "image" | "outer" = "image"
): PlanRect {
  const framedWidthMm =
    kind === "artwork" && sizing === "image"
      ? getArtworkOuterDimensionsMm(
          planRect.widthMm,
          planRect.widthMm,
          artwork?.matWidthMm,
          artwork?.frame
        ).widthMm
      : planRect.widthMm;

  const offsetToViewerSide = kind === "artwork" || kind === "case";
  return {
    ...(offsetToViewerSide
      ? offsetPlanRectToViewerSide({ ...planRect, widthMm: framedWidthMm })
      : planRect),
    depthMm: Math.max(planRect.depthMm, minDepthMm)
  };
}

export function buildPlanScene(project: Project, options: PlanSceneOptions = {}): PlanScene {
  const { artworksById } = options;
  const minDepthMm = options.minWallObjectDepthMm ?? 0;

  const rooms: PlanSceneRoom[] = project.floor.rooms.map((placement) => ({
    placement,
    roomId: placement.roomId,
    polygonMm: placement.room.vertices.map((vertex) => ({
      xMm: vertex.xMm + placement.offsetXMm,
      yMm: vertex.yMm + placement.offsetYMm
    })),
    walls: placement.room.walls.flatMap((wall) => {
      // Skip-on-dangling-vertex mirrors the old inline wall-lines layer
      // exactly. It's symmetry, not a stronger guarantee: getFloorWalls
      // below throws on the same data (findVertex), so a project that hits
      // this branch never produced a scene before this extraction either.
      const start = placement.room.vertices.find((vertex) => vertex.id === wall.startVertexId);
      const end = placement.room.vertices.find((vertex) => vertex.id === wall.endVertexId);
      if (!start || !end) return [];

      return [
        {
          wallId: wall.id,
          startMm: {
            xMm: start.xMm + placement.offsetXMm,
            yMm: start.yMm + placement.offsetYMm
          },
          endMm: {
            xMm: end.xMm + placement.offsetXMm,
            yMm: end.yMm + placement.offsetYMm
          }
        }
      ];
    })
  }));

  const partitions: PlanScenePartition[] = getFloorPartitions(project).map((partition) => ({
    partition,
    rect: segmentPlanRect(partition.startMm, partition.endMm, partition.thicknessMm)
  }));

  // Perimeter walls plus partition faces — wall objects can anchor to either,
  // so both connection endpoints and object rects project against this map.
  const floorWallsById = new Map(getFloorWalls(project.floor).map((wall) => [wall.id, wall]));

  const openingConnections: PlanSceneOpeningConnection[] = project.wallObjects.flatMap(
    (opening) => {
      // One glyph per pair: the lexically-smaller id owns it (both members
      // carry connectsToObjectId, so without this every pair would draw twice).
      if (
        (opening.kind !== "door" && opening.kind !== "window") ||
        !opening.connectsToObjectId ||
        opening.id > opening.connectsToObjectId
      ) {
        return [];
      }
      const partner = project.wallObjects.find(
        (candidate) => candidate.id === opening.connectsToObjectId
      );
      const wallA = floorWallsById.get(opening.wallId);
      const wallB = partner ? floorWallsById.get(partner.wallId) : undefined;
      if (
        !partner ||
        (partner.kind !== "door" && partner.kind !== "window") ||
        !wallA ||
        !wallB
      ) {
        return [];
      }
      const a = getWallObjectPlanRect(wallA, opening);
      const b = getWallObjectPlanRect(wallB, partner);
      const alignment = evaluateOpeningPair(project, opening.id, partner.id);
      return [
        {
          id: `${opening.id}:${partner.id}`,
          aCenterMm: { xMm: a.centerXMm, yMm: a.centerYMm },
          bCenterMm: { xMm: b.centerXMm, yMm: b.centerYMm },
          midMm: {
            xMm: (a.centerXMm + b.centerXMm) / 2,
            yMm: (a.centerYMm + b.centerYMm) / 2
          },
          status: alignment.status
        }
      ];
    }
  );

  const wallObjects: PlanSceneWallObject[] = project.wallObjects.flatMap((object) => {
    // A dangling wallId leaves the object out of the drawing entirely (it has
    // no geometry to project onto) — again matching the view's tolerance.
    const wall = floorWallsById.get(object.wallId);
    if (!wall) return [];

    const artwork = object.kind === "artwork" ? artworksById?.get(object.artworkId) : undefined;
    // A wall case protrudes from the wall by its real depthMm; every other
    // wall object uses the fixed nominal plan depth. The restRect stays the
    // geometric anchor centered ON the wall line (drag math reads its
    // center/angle); getRenderedWallObjectPlanRect then shifts the CASE (like
    // artwork) to the viewer's side so its box protrudes into the room flush
    // against the wall, rather than straddling the line.
    const restRect =
      object.kind === "case"
        ? getWallObjectPlanRect(wall, object, object.depthMm)
        : getWallObjectPlanRect(wall, object);
    return [
      {
        object,
        ...(artwork ? { artwork } : {}),
        restRect,
        renderedRect: getRenderedWallObjectPlanRect(restRect, object.kind, artwork, minDepthMm)
      }
    ];
  });

  const floorObjects: PlanSceneFloorObject[] = project.floorObjects.map((object) => {
    const artwork = object.kind === "artwork" ? artworksById?.get(object.artworkId) : undefined;
    return {
      object,
      ...(artwork ? { artwork } : {}),
      rect: getFloorObjectPlanRect(object)
    };
  });

  return { rooms, partitions, openingConnections, wallObjects, floorObjects };
}
