// Pointer-dragging an ALREADY-PLACED object in the 3D view: the pure
// world-hit -> next-placement mapping, plus the preview patch the view applies
// to the project while a drag is live.
//
// This is the move-side twin of dropTarget.ts's drop-side mapping, and it
// deliberately reuses it: `resolveThreeDrop` already owns wall projection,
// winding, and the keep-it-on-the-wall clamp, so a dragged work can never land
// somewhere a dropped work would have been refused. The only thing added here
// is the GRAB OFFSET — a drop has none (the cursor is the placement), a move
// has one (you grabbed the work by its corner and it must keep that grip).
//
// Everything below is pure and three.js-free, so the whole gesture's geometry
// is unit-testable without a canvas.

import { projectPointToWall, type FloorWall } from "../../../domain/geometry/planObjects";
import type { Project, WallObject } from "../../../domain/project";
import {
  resolveThreeDrop,
  worldHeightToMm,
  worldToFloorMm,
  type DropDimsMm,
  type DropSurfaceTag,
  type WorldPoint
} from "./dropTarget";

// Where a drag STARTED: which object, which surface it currently occupies, and
// (for a wall object) the footprint the wall clamp must keep whole.
export type ThreeDragSource =
  | {
      anchor: "wall";
      objectId: string;
      // What is being dragged. Only an ARTWORK can stand on a shelf (a rider is
      // an artwork by definition, shelfRiders.ts), so this is what decides
      // whether the drag is offered shelf seating at all — a wall case sliding
      // past a slab must not be snapped onto it. Optional so a caller with no
      // kind to hand (tests, older call sites) keeps the un-seated behaviour.
      kind?: WallObject["kind"];
      wallId: string;
      // Wall-local centre along the wall, and centre height above the floor —
      // exactly the pair the store persists.
      xMm: number;
      yMm: number;
      dims: DropDimsMm;
    }
  | {
      anchor: "floor";
      objectId: string;
      // Floor-space centre.
      xMm: number;
      yMm: number;
      dims: DropDimsMm;
    };

// A resolved placement for the dragged object. The wall variant carries yMm
// (unlike plan's PlanPlacement, which has no notion of hang height) because a
// 3D drag moves the work in BOTH wall axes at once.
export type ThreeDragMove =
  | {
      anchor: "wall";
      wallId: string;
      xMm: number;
      yMm: number;
      // The shelf this move stands the work ON, when the drag was captured by
      // one. The view lights that slab up for the rest of the gesture.
      shelfId?: string;
    }
  | { anchor: "floor"; xMm: number; yMm: number };

// What the raycast found under the cursor, in the shape pickDropSurface returns.
export type DragSurfaceHit = { tag: DropSurfaceTag; point: WorldPoint };

// Did the pointer travel far enough for this gesture to be a DRAG rather than a
// click? Same threshold, and therefore the same boundary, as the meshes'
// click guard: at or below it the release still selects, above it the object
// moves. (Squared comparison avoids a hypot per pointermove.)
export function exceedsDragThreshold(
  dxPx: number,
  dyPx: number,
  thresholdPx: number
): boolean {
  return dxPx * dxPx + dyPx * dyPx > thresholdPx * thresholdPx;
}

// The vector from where the cursor landed ON THE SURFACE to the object's stored
// centre — held constant for the rest of the gesture so the object doesn't
// teleport its centre under the cursor on the first pointermove.
//
// Zero whenever the press didn't resolve onto the object's OWN surface (the
// cursor was over another room's floor, an unplaceable wall, nothing at all):
// no honest offset exists then, and centre-under-cursor is the right fallback.
export function grabOffsetMm(args: {
  surface: DragSurfaceHit | null;
  source: ThreeDragSource;
  walls: readonly FloorWall[];
}): { xMm: number; yMm: number } {
  const { surface, source, walls } = args;
  const none = { xMm: 0, yMm: 0 };
  if (!surface) return none;

  if (source.anchor === "floor") {
    if (surface.tag.kind !== "floor") return none;
    const hit = worldToFloorMm(surface.point);
    return { xMm: source.xMm - hit.xMm, yMm: source.yMm - hit.yMm };
  }

  if (surface.tag.kind !== "wall" || surface.tag.wallId !== source.wallId) return none;
  const wall = walls.find((candidate) => candidate.id === source.wallId);
  if (!wall || wall.lengthMm <= 0) return none;
  // The RAW projection, never resolveThreeDrop's clamped one: an object grabbed
  // near a wall's end would otherwise fold the clamp into the offset and drift
  // by that amount for the whole gesture.
  const projection = projectPointToWall(worldToFloorMm(surface.point), wall);
  return {
    xMm: source.xMm - projection.xAlongMm,
    yMm: source.yMm - worldHeightToMm(surface.point)
  };
}

// The placement one pointermove resolves to, or null to KEEP THE LAST ONE.
//
// Null (not a fallback placement) is what makes the drag stay honest at the
// edges: dragging a hung work across the empty space between two rooms, or over
// the floor, simply parks the preview at the last valid spot instead of
// inventing a placement the release would then commit.
//
// SURFACE TYPE IS PINNED FOR THE GESTURE (v1): a wall object only follows wall
// hits and a floor object only follows floor hits. Wall<->floor CONVERSION
// mid-drag is a different operation — it rewrites depth, hang height and floor
// memory (planMoveWallToFloor / planMoveFloorToWall) — and belongs to a later
// round; the inspector's Type toggle and the plan drag both still do it.
//
// Wall-HOPPING within the wall surface IS supported: a work dragged onto
// another wall re-anchors there. The grab offset is dropped on the hop (it was
// measured in the origin wall's frame and means nothing in another's), so the
// work centres under the cursor from that moment on.
export function resolveDragMove(args: {
  surface: DragSurfaceHit | null;
  source: ThreeDragSource;
  offsetMm: { xMm: number; yMm: number };
  walls: readonly FloorWall[];
  // Shelf seating, forwarded to resolveThreeDrop. Opt-in from the view, which
  // also drops it while the precision-bypass modifier is held; gated again here
  // on the source being an artwork, because only an artwork can be a rider.
  wallObjects?: readonly WallObject[];
  seatOnShelves?: boolean;
}): ThreeDragMove | null {
  const { surface, source, offsetMm, walls } = args;
  if (!surface) return null;

  if (source.anchor === "floor") {
    if (surface.tag.kind !== "floor") return null;
    const resolved = resolveThreeDrop({
      point: surface.point,
      tag: surface.tag,
      walls,
      dims: source.dims,
      offsetMm
    });
    if (!resolved || resolved.anchor !== "floor") return null;
    return { anchor: "floor", xMm: resolved.xMm, yMm: resolved.yMm };
  }

  if (surface.tag.kind !== "wall") return null;
  const resolved = resolveThreeDrop({
    point: surface.point,
    tag: surface.tag,
    walls,
    dims: source.dims,
    offsetMm: surface.tag.wallId === source.wallId ? offsetMm : { xMm: 0, yMm: 0 },
    wallObjects: args.wallObjects,
    seatOnShelves: Boolean(args.seatOnShelves) && source.kind === "artwork",
    movingId: source.objectId
  });
  // null here means the hit wall isn't placeable (an open wall, or one from a
  // stale scene) — the drag holds its last placement rather than committing to
  // a wall the store would refuse.
  if (!resolved || resolved.anchor !== "wall") return null;
  return {
    anchor: "wall",
    wallId: resolved.wallId,
    xMm: resolved.xMm,
    yMm: resolved.yMm,
    shelfId: resolved.shelfId
  };
}

// Did the drag actually move the object? A sub-millimetre release is a click
// that wobbled, and must not push an undo entry (plan's own commit applies the
// same 0.5mm floor).
export const DRAG_COMMIT_EPSILON_MM = 0.5;

export function dragMoveIsMeaningful(
  source: ThreeDragSource,
  move: ThreeDragMove
): boolean {
  if (move.anchor === "wall") {
    if (source.anchor !== "wall") return true;
    if (move.wallId !== source.wallId) return true;
    return (
      Math.hypot(move.xMm - source.xMm, move.yMm - source.yMm) >= DRAG_COMMIT_EPSILON_MM
    );
  }
  if (source.anchor !== "floor") return true;
  return (
    Math.hypot(move.xMm - source.xMm, move.yMm - source.yMm) >= DRAG_COMMIT_EPSILON_MM
  );
}

// The project as it would be if the live preview were committed — what the view
// hands to deriveScene3d for the duration of the gesture, so what the curator
// sees moving is the REAL mesh (with its real framing, texture, wires, shadows
// under the eye-level ghosting) and not a stand-in rectangle.
//
// Returns the ORIGINAL project reference when nothing changes, so the view's
// scene memo is a no-op outside a drag.
export function projectWithDragPreview(
  project: Project,
  objectId: string,
  move: ThreeDragMove | null
): Project {
  if (!move) return project;

  if (move.anchor === "wall") {
    let changed = false;
    const wallObjects = project.wallObjects.map((object) => {
      if (object.id !== objectId) return object;
      if (
        object.wallId === move.wallId &&
        object.xMm === move.xMm &&
        object.yMm === move.yMm
      ) {
        return object;
      }
      changed = true;
      return { ...object, wallId: move.wallId, xMm: move.xMm, yMm: move.yMm };
    });
    return changed ? { ...project, wallObjects } : project;
  }

  let changed = false;
  const floorObjects = project.floorObjects.map((object) => {
    if (object.id !== objectId) return object;
    if (object.xMm === move.xMm && object.yMm === move.yMm) return object;
    changed = true;
    return { ...object, xMm: move.xMm, yMm: move.yMm };
  });
  return changed ? { ...project, floorObjects } : project;
}
