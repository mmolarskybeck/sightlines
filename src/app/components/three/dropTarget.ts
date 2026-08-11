// Checklist drop-to-place in 3D: the pure world-hit -> placement mapping.
//
// Kept OUT of `scene3d.ts` deliberately. That module is one-directional by
// contract (project -> scene), and its `toPanelLocalX` winding remap has no
// inverse — a clockwise-authored room's panel-local x runs backwards from the
// authored wall-local x that `placeArtwork` stores. Rather than invert it, this
// module never touches panel space at all: a world hit becomes a FLOOR-SPACE
// point, and `projectPointToWall` re-derives the authored xAlongMm from the
// authored wall geometry. Winding therefore cannot be got wrong here, in either
// direction, for perimeter walls or partition faces alike.
//
// Everything below is pure and three.js-free (structural types only), so the
// whole mapping is unit-testable without a canvas.

import { clamp } from "../../../domain/geometry/scalar";
import { projectPointToWall, type FloorWall } from "../../../domain/geometry/planObjects";
import { MM_TO_WORLD } from "./coordinates";

// The `userData` key wall panels and floor surfaces carry so a raycast hit can
// be recognised as a placement surface. Everything else in the scene (artwork
// planes, opening pick bands, door leaves, cases, slab caps) is untagged, so a
// hit on one falls THROUGH to whatever placement surface is behind it.
export const DROP_TARGET_USER_DATA_KEY = "sightlinesDropTarget";

export type DropSurfaceTag =
  | { kind: "wall"; wallId: string }
  | { kind: "floor"; roomId: string };

// The minimum of three's Object3D this module needs: a userData bag and a
// parent link. Wall meshes live inside a rotated/positioned group, so the tag
// is found by walking ancestors — but an intersection's `.point` is already
// world-space, so no matrix work is needed.
export type TaggedObject3d = {
  userData?: Record<string, unknown>;
  parent?: TaggedObject3d | null;
};

export type WorldPoint = { x: number; y: number; z: number };

export type DropIntersection = {
  object: TaggedObject3d;
  point: WorldPoint;
};

function isDropSurfaceTag(value: unknown): value is DropSurfaceTag {
  if (typeof value !== "object" || value === null) return false;
  const tag = value as { kind?: unknown; wallId?: unknown; roomId?: unknown };
  if (tag.kind === "wall") return typeof tag.wallId === "string";
  if (tag.kind === "floor") return typeof tag.roomId === "string";
  return false;
}

// The drop-surface tag on an object or the nearest tagged ancestor, else null.
export function findDropSurfaceTag(
  object: TaggedObject3d | null | undefined
): DropSurfaceTag | null {
  let current: TaggedObject3d | null | undefined = object;
  // Bounded walk: the scene graph is a tree, but a malformed parent cycle must
  // not hang the drag.
  for (let depth = 0; current && depth < 64; depth += 1) {
    const tag = current.userData?.[DROP_TARGET_USER_DATA_KEY];
    if (isDropSurfaceTag(tag)) return tag;
    current = current.parent;
  }
  return null;
}

// The first raycast hit that lands on a placement surface. Intersections arrive
// sorted near->far, so this is "the nearest wall or floor under the cursor,
// looking straight through anything hanging on it".
export function pickDropSurface(
  intersections: readonly DropIntersection[]
): { tag: DropSurfaceTag; point: WorldPoint } | null {
  for (const intersection of intersections) {
    const tag = findDropSurfaceTag(intersection.object);
    if (tag) return { tag, point: intersection.point };
  }
  return null;
}

// three world -> floor-space mm. Axis convention (spec §5.2): floor (x, y) maps
// to world (x, z); world +y is height.
export function worldToFloorMm(point: WorldPoint): { xMm: number; yMm: number } {
  return { xMm: point.x / MM_TO_WORLD, yMm: point.z / MM_TO_WORLD };
}

export function worldHeightToMm(point: WorldPoint): number {
  return point.y / MM_TO_WORLD;
}

// The dragged work's two footprints. A wall drop is governed by the OUTER
// (mat + frame) box — the same rule the plan drop's wall clamp uses — while a
// floor drop is governed by the floor footprint (width x depth), which framing
// never contributes to (docs/framing-dimension-contract.md §3).
export type DropDimsMm = {
  wallWidthMm: number;
  wallHeightMm: number;
  floorWidthMm: number;
  floorDepthMm: number;
};

// A render-ready description of the translucent preview, in floor-space mm.
// Deliberately NOT in world units: the view converts (and applies its own
// camera-facing standoff) so this stays testable without three.
export type DropGhost3d = {
  kind: "wall" | "floor";
  // Floor-space center of the rect (for a wall ghost: the point ON the wall
  // line, before any standoff).
  centerXMm: number;
  centerYMm: number;
  // Center height above the floor. 0 for a floor ghost.
  centerHeightMm: number;
  // Yaw about world +Y that aligns the ghost's local +x with the wall run.
  // 0 for a floor ghost (floor placements are authored rotationDeg 0).
  rotationYRad: number;
  widthMm: number;
  // Vertical extent for a wall ghost; floor-space depth for a floor ghost.
  heightMm: number;
};

export type ThreeDropResolution =
  | {
      anchor: "wall";
      wallId: string;
      // Authored wall-local center along the wall — exactly what
      // `placeArtwork(artworkId, wallId, xMm, yMm)` stores.
      xMm: number;
      // Center height above the floor.
      yMm: number;
      ghost: DropGhost3d;
    }
  | {
      anchor: "floor";
      // Floor-space center — what `placeArtworkOnFloor` stores.
      xMm: number;
      yMm: number;
      ghost: DropGhost3d;
    };

// Keep the work's full width on the wall, and center it outright when the wall
// is shorter than the work (no valid range exists). Identical rule to
// resolveOnWall's clamp in planSnapTargets.ts and to setArtworkPlacementForm's
// floor->wall conversion, so a 3D drop can't land somewhere the other two
// surfaces would have refused to put it.
function clampSpan(rawMm: number, spanMm: number, extentMm: number): number {
  const halfMm = spanMm / 2;
  const maxMm = extentMm - halfMm;
  if (maxMm < halfMm) return extentMm / 2;
  return clamp(rawMm, halfMm, maxMm);
}

// Where a world-space raycast hit on a tagged placement surface should place
// the dragged work. Returns null when the hit names a wall that isn't
// placeable (an open wall, or one from another floor/stale scene) — the drop
// is then a no-op, matching plan's rejected-drop behavior.
//
// INTENT WINS (docs/interaction-improvements-2026-08.md §3): the artwork's own
// placementForm is never consulted. A wall hit places on the wall and a floor
// hit places on the floor, for any work.
export function resolveThreeDrop(args: {
  point: WorldPoint;
  tag: DropSurfaceTag;
  walls: readonly FloorWall[];
  dims: DropDimsMm;
}): ThreeDropResolution | null {
  const { point, tag, walls, dims } = args;
  const floorPointMm = worldToFloorMm(point);

  if (tag.kind === "floor") {
    return {
      anchor: "floor",
      xMm: floorPointMm.xMm,
      yMm: floorPointMm.yMm,
      ghost: {
        kind: "floor",
        centerXMm: floorPointMm.xMm,
        centerYMm: floorPointMm.yMm,
        centerHeightMm: 0,
        rotationYRad: 0,
        widthMm: dims.floorWidthMm,
        heightMm: dims.floorDepthMm
      }
    };
  }

  const wall = walls.find((candidate) => candidate.id === tag.wallId);
  if (!wall || wall.lengthMm <= 0) return null;

  const projection = projectPointToWall(floorPointMm, wall);
  const xMm = clampSpan(projection.xAlongMm, dims.wallWidthMm, wall.lengthMm);
  const yMm = clampSpan(worldHeightToMm(point), dims.wallHeightMm, wall.heightMm);

  // The ghost rides the clamped x (not the raw hit), so the preview shows the
  // placement that will actually commit.
  const dxMm = wall.endFloorMm.xMm - wall.startFloorMm.xMm;
  const dyMm = wall.endFloorMm.yMm - wall.startFloorMm.yMm;
  const t = xMm / wall.lengthMm;

  return {
    anchor: "wall",
    wallId: wall.id,
    xMm,
    yMm,
    ghost: {
      kind: "wall",
      centerXMm: wall.startFloorMm.xMm + dxMm * t,
      centerYMm: wall.startFloorMm.yMm + dyMm * t,
      centerHeightMm: yMm,
      // Same yaw convention as WallPanel/PartitionSlab: local +x runs
      // start->end. The ghost plane is double-sided, so the 180° difference
      // between the authored wall direction and the panel's (possibly swapped)
      // one is immaterial.
      rotationYRad: Math.atan2(-dyMm, dxMm),
      widthMm: dims.wallWidthMm,
      heightMm: dims.wallHeightMm
    }
  };
}

// How far the ghost floats off the surface it previews, so it can't z-fight the
// wall face or the floor. Millimetres, matching the scale WallPanel's own
// offsets work at (sub-millimetre steps shimmer under camera motion).
export const DROP_GHOST_STANDOFF_MM = 25;

export type DropGhostTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  widthWorld: number;
  heightWorld: number;
};

// The ghost's three.js transform. A wall ghost is nudged toward the camera
// rather than along a face normal: the hit came from the camera, so "toward the
// eye" is always the visible side, for perimeter walls and both partition faces
// alike, with no side-of-wall bookkeeping. A floor ghost simply lifts.
export function dropGhostTransform(
  ghost: DropGhost3d,
  cameraWorld: WorldPoint
): DropGhostTransform {
  const standoffWorld = DROP_GHOST_STANDOFF_MM * MM_TO_WORLD;
  const baseX = ghost.centerXMm * MM_TO_WORLD;
  const baseY = ghost.centerHeightMm * MM_TO_WORLD;
  const baseZ = ghost.centerYMm * MM_TO_WORLD;
  const widthWorld = ghost.widthMm * MM_TO_WORLD;
  const heightWorld = ghost.heightMm * MM_TO_WORLD;

  if (ghost.kind === "floor") {
    // Same orientation as FloorSurface (rotate +90° about x): local +y becomes
    // world +z, so the rect's `heightMm` reads as floor-space depth.
    return {
      position: [baseX, baseY + standoffWorld, baseZ],
      rotation: [Math.PI / 2, 0, 0],
      widthWorld,
      heightWorld
    };
  }

  const toCameraX = cameraWorld.x - baseX;
  const toCameraY = cameraWorld.y - baseY;
  const toCameraZ = cameraWorld.z - baseZ;
  const length = Math.hypot(toCameraX, toCameraY, toCameraZ);
  // Degenerate only if the camera sits exactly on the wall point; then leave
  // the ghost flush rather than divide by zero.
  const scale = length > 1e-6 ? standoffWorld / length : 0;

  return {
    position: [
      baseX + toCameraX * scale,
      baseY + toCameraY * scale,
      baseZ + toCameraZ * scale
    ],
    rotation: [0, ghost.rotationYRad, 0],
    widthWorld,
    heightWorld
  };
}
