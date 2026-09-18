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
import { clamp } from "../../../domain/geometry/scalar";
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
      // The works standing on this object, when it is a SHELF (shelfRiders.ts
      // derives them at gesture start, as every other move path does). Offsets
      // are measured from the slab's centre in the wall's own axes, and the
      // sizes are FRAMED footprints — the same box the rider test and the
      // elevation barriers use — so the assembly is clamped by what is
      // visible, not by the stored image box.
      riders?: {
        id: string;
        offsetMm: { xMm: number; yMm: number };
        widthMm: number;
        heightMm: number;
      }[];
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
      // Where the shelf's riders land, absolute and on the SAME wall as the
      // slab: one common delta, never a per-member clamp, so their spacing is
      // byte-identical before and after (the plan's rule of record,
      // resolveShelfAssemblyMove).
      riders?: { id: string; xMm: number; yMm: number }[];
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
//
// A SHELF ASSEMBLY is the one thing that hops reluctantly: it is wide, it
// carries works, and the cursor crosses a neighbouring wall constantly while
// sliding a slab toward a corner. `stickToWallId` keeps it on its own wall
// until the view decides the curator meant it (SHELF_WALL_HOP_PX below).
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
  // Resolve a SHELF against this wall whatever the cursor is over. Ignored for
  // every other kind, which keeps hopping the instant the pointer crosses.
  stickToWallId?: string;
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

  // Which wall this move resolves against. Ordinarily the one under the cursor;
  // for a stuck shelf, its own wall — the world point still projects onto it
  // (projectPointToWall clamps along the run), so the slab slides to that
  // wall's end and stays there instead of jumping to the neighbour.
  const stickToWallId = source.kind === "shelf" ? args.stickToWallId : undefined;
  const hitWallId = surface.tag.kind === "wall" ? surface.tag.wallId : null;
  const resolvedWallId =
    hitWallId !== null && (stickToWallId === undefined || hitWallId === source.wallId)
      ? hitWallId
      : stickToWallId;
  if (resolvedWallId === undefined) return null;

  const resolved = resolveThreeDrop({
    point: surface.point,
    tag: { kind: "wall", wallId: resolvedWallId },
    walls,
    dims: source.dims,
    offsetMm: resolvedWallId === source.wallId ? offsetMm : { xMm: 0, yMm: 0 },
    wallObjects: args.wallObjects,
    seatOnShelves: Boolean(args.seatOnShelves) && source.kind === "artwork",
    movingId: source.objectId
  });
  // null here means the hit wall isn't placeable (an open wall, or one from a
  // stale scene) — the drag holds its last placement rather than committing to
  // a wall the store would refuse.
  if (!resolved || resolved.anchor !== "wall") return null;

  const riders = source.riders;
  if (!riders || riders.length === 0) {
    return {
      anchor: "wall",
      wallId: resolved.wallId,
      xMm: resolved.xMm,
      yMm: resolved.yMm,
      shelfId: resolved.shelfId
    };
  }

  // RIGID ASSEMBLY (USER DECISION, planGroupMove.ts): the slab and its riders
  // take ONE common delta, and the clamp that keeps the group on the wall acts
  // on the UNION, never on each member — clamping per member is exactly what
  // squashes an assembly against a corner.
  const wall = walls.find((candidate) => candidate.id === resolved.wallId);
  if (!wall) return null;
  const union = assemblyUnionMm(source.dims, riders);
  // A union wider than a FOREIGN wall cannot be made to fit without deforming
  // it, so the hop is refused outright (the drag holds its last placement) —
  // the same refusal the plan drag makes. Its own wall is never refused: the
  // assembly is already there.
  if (
    resolved.wallId !== source.wallId &&
    union.maxXMm - union.minXMm > wall.lengthMm
  ) {
    return null;
  }
  const xMm = fitUnionSpan(resolved.xMm, union.minXMm, union.maxXMm, wall.lengthMm);
  const yMm = fitUnionSpan(resolved.yMm, union.minYMm, union.maxYMm, wall.heightMm);
  return {
    anchor: "wall",
    wallId: resolved.wallId,
    xMm,
    yMm,
    riders: riders.map((rider) => ({
      id: rider.id,
      xMm: xMm + rider.offsetMm.xMm,
      yMm: yMm + rider.offsetMm.yMm
    }))
  };
}

// The assembly's extent in slab-centre-relative mm, both axes: the slab's own
// box (its clamp footprint) unioned with every rider's framed footprint.
function assemblyUnionMm(
  dims: DropDimsMm,
  riders: readonly {
    offsetMm: { xMm: number; yMm: number };
    widthMm: number;
    heightMm: number;
  }[]
): { minXMm: number; maxXMm: number; minYMm: number; maxYMm: number } {
  const union = {
    minXMm: -dims.wallWidthMm / 2,
    maxXMm: dims.wallWidthMm / 2,
    minYMm: -dims.wallHeightMm / 2,
    maxYMm: dims.wallHeightMm / 2
  };
  for (const rider of riders) {
    union.minXMm = Math.min(union.minXMm, rider.offsetMm.xMm - rider.widthMm / 2);
    union.maxXMm = Math.max(union.maxXMm, rider.offsetMm.xMm + rider.widthMm / 2);
    union.minYMm = Math.min(union.minYMm, rider.offsetMm.yMm - rider.heightMm / 2);
    union.maxYMm = Math.max(union.maxYMm, rider.offsetMm.yMm + rider.heightMm / 2);
  }
  return union;
}

// The slab centre that keeps the whole union inside [0, extentMm]. When the
// union simply does not fit that extent there is no such centre, and the
// assembly keeps the position it already has rather than being squeezed into
// an impossible span — overhanging rigidly is the honest drawing.
function fitUnionSpan(
  centreMm: number,
  minOffsetMm: number,
  maxOffsetMm: number,
  extentMm: number
): number {
  const lowMm = -minOffsetMm;
  const highMm = extentMm - maxOffsetMm;
  if (highMm < lowMm) return centreMm;
  return clamp(centreMm, lowMm, highMm);
}

// How far the pointer must travel while held over ONE foreign wall before a
// shelf assembly is allowed to re-anchor onto it. A slab is wide and its
// riders are wider still, so the cursor crosses the neighbouring wall on the
// way to almost every corner: hopping on the first frame over it made the
// assembly bounce between walls. Past this distance the crossing is no longer
// incidental — it is where the curator is going.
export const SHELF_WALL_HOP_PX = 120;

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
    // A shelf's riders travel WITH the slab in the preview, on the same wall —
    // a slab sliding out from under its works, only to snap back to them on
    // release, would misdescribe the gesture for its whole length.
    const riderById = new Map((move.riders ?? []).map((rider) => [rider.id, rider]));
    let changed = false;
    const wallObjects = project.wallObjects.map((object) => {
      const target = object.id === objectId ? move : riderById.get(object.id);
      if (!target) return object;
      if (
        object.wallId === move.wallId &&
        object.xMm === target.xMm &&
        object.yMm === target.yMm
      ) {
        return object;
      }
      changed = true;
      return { ...object, wallId: move.wallId, xMm: target.xMm, yMm: target.yMm };
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
