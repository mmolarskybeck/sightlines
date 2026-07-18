// Alignment snap targets for a FLOOR object dragged in plan view (the floor
// stage of resolvePlanPlacement). Three families, all competing against the
// floor grid inside resolveSnap:
//   • room centerlines (kind "centerline") — the along-wall midpoint of each
//     axis-aligned room wall, so a floor object centers on the room's axes;
//   • wall-object alignment (kind "neighbor-center" / "neighbor-edge") — line
//     the dragged object up with a door/window/case/etc. anchored to an
//     axis-aligned room wall, on the along-wall axis;
//   • floor-object alignment (same kinds) — line up with a neighboring floor
//     object on both axes.
// Pure: floor-space geometry only, no app-layer imports. Angled walls are
// skipped entirely — the along-wall/cross-wall axis mapping the edge-align math
// relies on only holds for axis-aligned walls (the overwhelming common case).
//
// extentMm semantics (verified against resolveSnap + PlanOverlaysLayer): the
// value is the segment ALONG the guide's drawn length — i.e. on the CROSS axis
// of the axis the target constrains. An x-axis target draws a vertical line, so
// its extentMm is a y range; a y-axis target draws a horizontal line, so its
// extentMm is an x range. resolveSnap copies extentMm from the winning target
// onto the Guide, and PlanOverlaysLayer clips the drawn line to it.

import type { FloorObject, WallObjectBase } from "../project";
import { getWallObjectPlanRect, type FloorWall } from "../geometry/planObjects";
import type { PlanMovingSize } from "./planSnapTargets";
import type { SnapTarget } from "./resolveSnap";

// How far a drawn alignment guide overshoots the reference points it connects,
// so the line reads as a deliberate axis rather than stopping exactly at the
// two object centers it aligns.
export const GUIDE_OVERSHOOT_MM = 150;

// Per-axis cap on neighbor (non-centerline) targets kept after pruning, so a
// crowded room doesn't flood resolveSnap with dozens of near-identical
// alignment candidates. The nearest N to the proposed center on each axis win.
export const MAX_NEIGHBOR_TARGETS_PER_AXIS = 8;

// Two axis-aligned floor points count as sharing a coordinate within this
// window (mm — a window, not exact equality, since floor-space endpoints are
// floats lifted through a room offset). Mirrors partitionSnapTargets' policy.
const AXIS_EPSILON_MM = 1e-6;

// How close a rotation must be to a right angle (degrees) to count as
// axis-aligned for edge-align purposes. Edge alignment needs the moving/neighbor
// footprint's world-axis half-extents, which are only well-defined at
// 90°-multiples; a tilted object gets center alignment only.
const RIGHT_ANGLE_EPSILON_DEG = 0.5;

// Center-align and edge-align are equally meaningful relationships for floor
// alignment, so both get the same explicit priority (neighbor-center's default
// rank) and the NEAREST target wins. Without this, KIND_PRIORITY ranks
// neighbor-center (2) above neighbor-edge (3), and because a similar-width
// neighbor's center target stays within the snap radius across most of its
// footprint, the edge target could never capture even when it was closer.
const NEIGHBOR_ALIGN_PRIORITY = 2;

type WallOrientation = "horizontal" | "vertical";

// A room wall that is axis-aligned in floor space, tagged with which world axis
// it spans. "horizontal" spans x at a constant y; "vertical" spans x-constant,
// spanning y.
type AxisAlignedWall = {
  wall: FloorWall;
  orientation: WallOrientation;
};

function axisAlignedOrientation(wall: FloorWall): WallOrientation | null {
  const dx = Math.abs(wall.endFloorMm.xMm - wall.startFloorMm.xMm);
  const dy = Math.abs(wall.endFloorMm.yMm - wall.startFloorMm.yMm);
  if (dy <= AXIS_EPSILON_MM && dx > AXIS_EPSILON_MM) return "horizontal";
  if (dx <= AXIS_EPSILON_MM && dy > AXIS_EPSILON_MM) return "vertical";
  return null;
}

// World-axis half-extents of a footprint at a 90°-multiple rotation: at 0/180
// the stored width runs along x and depth along y; at 90/270 they swap. Returns
// null when the rotation is not (within epsilon) a right-angle multiple, so the
// caller can fall back to center-only alignment.
function rightAngleHalfExtents(
  rotationDeg: number,
  widthMm: number,
  depthMm: number,
): { halfXMm: number; halfYMm: number } | null {
  const norm = ((rotationDeg % 180) + 180) % 180; // [0, 180)
  const nearZero = Math.min(norm, 180 - norm) <= RIGHT_ANGLE_EPSILON_DEG;
  const nearNinety = Math.abs(norm - 90) <= RIGHT_ANGLE_EPSILON_DEG;
  if (nearZero) return { halfXMm: widthMm / 2, halfYMm: depthMm / 2 };
  if (nearNinety) return { halfXMm: depthMm / 2, halfYMm: widthMm / 2 };
  return null;
}

// The guide segment ALONG a target's drawn length: for an x-axis (vertical)
// guide the cross axis is y, for a y-axis (horizontal) guide it is x. Spans the
// two reference coordinates on that cross axis, min/max ordered, padded by the
// overshoot. startMm <= endMm always holds and both references sit inside.
function crossAxisExtent(
  aCrossMm: number,
  bCrossMm: number,
): { startMm: number; endMm: number } {
  return {
    startMm: Math.min(aCrossMm, bCrossMm) - GUIDE_OVERSHOOT_MM,
    endMm: Math.max(aCrossMm, bCrossMm) + GUIDE_OVERSHOOT_MM,
  };
}

export function getFloorAlignSnapTargets(args: {
  proposedCenterMm: { xMm: number; yMm: number };
  roomId: string | null;
  walls: FloorWall[]; // all floor walls; filtered internally by wall.roomId
  wallObjects: WallObjectBase[]; // moving object already excluded by caller
  floorObjects: FloorObject[]; // moving excluded + same-room filtered by caller
  movingSize: PlanMovingSize; // widthMm/depthMm of the moving object
  rotationDeg: number; // moving object rotation
}): SnapTarget[] {
  const {
    proposedCenterMm,
    roomId,
    walls,
    wallObjects,
    floorObjects,
    movingSize,
    rotationDeg,
  } = args;

  const centerlines: SnapTarget[] = [];
  const neighbors: SnapTarget[] = [];

  // Moving object's world-axis half-extents (null when tilted off a right
  // angle), reused by every edge-align family below.
  const movingHalf = rightAngleHalfExtents(
    rotationDeg,
    movingSize.widthMm,
    movingSize.depthMm,
  );

  // Wall-derived families require a containing room (null roomId → floor
  // objects only). Filter walls to the room and keep only axis-aligned ones.
  const roomWalls: AxisAlignedWall[] = [];
  if (roomId !== null) {
    for (const wall of walls) {
      if (wall.roomId !== roomId) continue;
      const orientation = axisAlignedOrientation(wall);
      if (orientation) roomWalls.push({ wall, orientation });
    }
  }

  // --- Room centerlines ---------------------------------------------------
  // Each axis-aligned wall's along-wall midpoint constrains the along-wall
  // coordinate: a vertical wall pins y (its midpoint yMid), a horizontal wall
  // pins x. Dedupe by (axis, rounded position) so a rectangular room collapses
  // to exactly two centerlines. The drawn guide spans the room's bounds on its
  // own drawn axis (the cross axis), padded by the overshoot, so it reads as a
  // room centerline clipped to the room.
  if (roomWalls.length > 0) {
    const roomBounds = roomWallBounds(roomWalls);
    const seen = new Set<string>();
    for (const { wall, orientation } of roomWalls) {
      const axis = orientation === "vertical" ? "y" : "x";
      const positionMm =
        orientation === "vertical"
          ? (wall.startFloorMm.yMm + wall.endFloorMm.yMm) / 2
          : (wall.startFloorMm.xMm + wall.endFloorMm.xMm) / 2;
      const key = `${axis}:${Math.round(positionMm)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // The line is drawn along the cross axis: an x-target (vertical line)
      // spans y over the room's y bounds; a y-target (horizontal line) spans x.
      const extentMm =
        axis === "x"
          ? crossAxisExtent(roomBounds.minYMm, roomBounds.maxYMm)
          : crossAxisExtent(roomBounds.minXMm, roomBounds.maxXMm);
      centerlines.push({
        id: `room-center:${roomId}:${axis}`,
        kind: "centerline",
        axis,
        point: {
          xMm: axis === "x" ? positionMm : proposedCenterMm.xMm,
          yMm: axis === "y" ? positionMm : proposedCenterMm.yMm,
        },
        extentMm,
      });
    }
  }

  // --- Wall-object alignment ---------------------------------------------
  // Each object on an axis-aligned room wall constrains the along-wall axis at
  // its floor-space rect center. No viewer-side offset: that offset is
  // perpendicular to the wall and never changes the along-wall coordinate.
  const wallById = new Map<string, AxisAlignedWall>();
  for (const entry of roomWalls) wallById.set(entry.wall.id, entry);

  for (const object of wallObjects) {
    const entry = wallById.get(object.wallId);
    if (!entry) continue;
    const rect = getWallObjectPlanRect(entry.wall, object);
    const horizontal = entry.orientation === "horizontal";
    // Constrained axis = the along-wall axis (x for a horizontal wall).
    const axis = horizontal ? "x" : "y";
    // Object center + proposed center on the constrained axis...
    const objCenterMm = horizontal ? rect.centerXMm : rect.centerYMm;
    // ...and on the cross axis (where the guide is drawn), spanning from the
    // object to the moving object's proposed position.
    const objCrossMm = horizontal ? rect.centerYMm : rect.centerXMm;
    const movingCrossMm = horizontal
      ? proposedCenterMm.yMm
      : proposedCenterMm.xMm;
    const extentMm = crossAxisExtent(objCrossMm, movingCrossMm);

    const pointFor = (positionMm: number) => ({
      xMm: axis === "x" ? positionMm : proposedCenterMm.xMm,
      yMm: axis === "y" ? positionMm : proposedCenterMm.yMm,
    });

    neighbors.push({
      id: `wall-neighbor-center:${object.id}:${axis}`,
      kind: "neighbor-center",
      priority: NEIGHBOR_ALIGN_PRIORITY,
      axis,
      point: pointFor(objCenterMm),
      extentMm,
    });

    // Edge-align: same-side edges collinear (NOT flush). Only when the moving
    // object sits at a right angle, so its half-extent along the constrained
    // axis is well-defined. object.widthMm runs along the wall (= the
    // constrained axis) for both orientations.
    if (movingHalf) {
      const objHalfMm = object.widthMm / 2;
      const objLoMm = objCenterMm - objHalfMm;
      const objHiMm = objCenterMm + objHalfMm;
      const movingHalfAlongMm = horizontal
        ? movingHalf.halfXMm
        : movingHalf.halfYMm;
      neighbors.push({
        id: `wall-neighbor-edge:${object.id}:${axis}:lo`,
        kind: "neighbor-edge",
        priority: NEIGHBOR_ALIGN_PRIORITY,
        axis,
        point: pointFor(objLoMm + movingHalfAlongMm),
        guidePositionMm: objLoMm,
        extentMm,
      });
      neighbors.push({
        id: `wall-neighbor-edge:${object.id}:${axis}:hi`,
        kind: "neighbor-edge",
        priority: NEIGHBOR_ALIGN_PRIORITY,
        axis,
        point: pointFor(objHiMm - movingHalfAlongMm),
        guidePositionMm: objHiMm,
        extentMm,
      });
    }
  }

  // --- Floor-object alignment --------------------------------------------
  // Neighbor floor objects align on BOTH axes: center-align always, edge-align
  // only when BOTH the moving and neighbor rotations are right-angle multiples
  // (so both world-axis half-extents exist).
  for (const object of floorObjects) {
    const neighborHalf = rightAngleHalfExtents(
      object.rotationDeg,
      object.widthMm,
      object.depthMm,
    );
    for (const axis of ["x", "y"] as const) {
      const objCenterMm = axis === "x" ? object.xMm : object.yMm;
      const objCrossMm = axis === "x" ? object.yMm : object.xMm;
      const movingCrossMm =
        axis === "x" ? proposedCenterMm.yMm : proposedCenterMm.xMm;
      const extentMm = crossAxisExtent(objCrossMm, movingCrossMm);

      const pointFor = (positionMm: number) => ({
        xMm: axis === "x" ? positionMm : proposedCenterMm.xMm,
        yMm: axis === "y" ? positionMm : proposedCenterMm.yMm,
      });

      neighbors.push({
        id: `floor-neighbor-center:${object.id}:${axis}`,
        kind: "neighbor-center",
        priority: NEIGHBOR_ALIGN_PRIORITY,
        axis,
        point: pointFor(objCenterMm),
        extentMm,
      });

      if (movingHalf && neighborHalf) {
        const objHalfMm =
          axis === "x" ? neighborHalf.halfXMm : neighborHalf.halfYMm;
        const movingHalfAlongMm =
          axis === "x" ? movingHalf.halfXMm : movingHalf.halfYMm;
        const objLoMm = objCenterMm - objHalfMm;
        const objHiMm = objCenterMm + objHalfMm;
        neighbors.push({
          id: `floor-neighbor-edge:${object.id}:${axis}:lo`,
          kind: "neighbor-edge",
          priority: NEIGHBOR_ALIGN_PRIORITY,
          axis,
          point: pointFor(objLoMm + movingHalfAlongMm),
          guidePositionMm: objLoMm,
          extentMm,
        });
        neighbors.push({
          id: `floor-neighbor-edge:${object.id}:${axis}:hi`,
          kind: "neighbor-edge",
          priority: NEIGHBOR_ALIGN_PRIORITY,
          axis,
          point: pointFor(objHiMm - movingHalfAlongMm),
          guidePositionMm: objHiMm,
          extentMm,
        });
      }
    }
  }

  // --- Pruning ------------------------------------------------------------
  // Keep every centerline; per axis keep only the nearest N neighbor targets to
  // the proposed center on that axis.
  return [...centerlines, ...pruneNeighbors(neighbors, proposedCenterMm)];
}

// Bounds of a room from its axis-aligned walls' floor-space endpoints. Used to
// clip centerline guides to the room.
function roomWallBounds(roomWalls: AxisAlignedWall[]): {
  minXMm: number;
  maxXMm: number;
  minYMm: number;
  maxYMm: number;
} {
  let minXMm = Infinity;
  let maxXMm = -Infinity;
  let minYMm = Infinity;
  let maxYMm = -Infinity;
  for (const { wall } of roomWalls) {
    for (const end of [wall.startFloorMm, wall.endFloorMm]) {
      minXMm = Math.min(minXMm, end.xMm);
      maxXMm = Math.max(maxXMm, end.xMm);
      minYMm = Math.min(minYMm, end.yMm);
      maxYMm = Math.max(maxYMm, end.yMm);
    }
  }
  return { minXMm, maxXMm, minYMm, maxYMm };
}

// Per axis, keep only the MAX_NEIGHBOR_TARGETS_PER_AXIS targets nearest the
// proposed center on that axis. Ties break on id for determinism.
function pruneNeighbors(
  targets: SnapTarget[],
  proposedCenterMm: { xMm: number; yMm: number },
): SnapTarget[] {
  const kept: SnapTarget[] = [];
  for (const axis of ["x", "y"] as const) {
    const proposed = axis === "x" ? proposedCenterMm.xMm : proposedCenterMm.yMm;
    const onAxis = targets.filter((target) => target.axis === axis);
    onAxis
      .map((target) => ({
        target,
        distance: Math.abs(
          (axis === "x" ? target.point.xMm : target.point.yMm) - proposed,
        ),
      }))
      .sort((a, b) => {
        const delta = a.distance - b.distance;
        if (delta !== 0) return delta;
        return a.target.id.localeCompare(b.target.id);
      })
      .slice(0, MAX_NEIGHBOR_TARGETS_PER_AXIS)
      .forEach(({ target }) => kept.push(target));
  }
  return kept;
}
