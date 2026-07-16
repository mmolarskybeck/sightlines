// Wall- and partition-aware snap targets for a partition MOVE drag (plan mode).
// Two families, both ranked above the grid so they win when in range:
//   • equidistant-between-obstacles — per world axis, cast outward from the
//     partition's two extent points (end caps along its span, slab faces across
//     its normal) toward the nearest obstacle (room perimeter OR a neighboring
//     partition); where both directions hit, offer the position whose two
//     DISPLAYED (true clear) gaps are equal. Because both extent points are
//     offset symmetrically from the midpoint, the equal-gap midpoint is simply
//     the midpoint of the two hit points (kind "centerline", priority 1).
//   • sibling-partition midpoint alignment — each OTHER partition's centerline
//     midpoint, offered on both axes so a dragged partition lines up with a
//     neighbour (kind "neighbor-center", priority 2).
// Pure: room-local geometry cast in room-local space, every emitted target
// lifted to floor space by the placement offset so it competes directly with
// the floor-space grid targets inside resolveSnap.
//
// Angled partitions: the equidistant targets only make sense once we know which
// world axis is the span (end-cap gaps) and which is the normal (face gaps).
// For a partition more than ~15° off axis-aligned that mapping breaks down, so
// we pragmatically SKIP the equidistant targets there and keep only the sibling
// alignment ones (which are orientation-agnostic). Axis-aligned partitions —
// the overwhelming common case — get the full treatment.

import type { FreestandingWall, Room, RoomPlacement } from "../project";
import {
  castRay,
  collectObstacleSegments,
  partitionSlabSegments
} from "../geometry/partitionSpacing";
import { getWallsWithGeometry, outwardWallNormal } from "../geometry/walls";
import { nearestDirectedIncrement } from "./cleanIncrement";
import type { Point, SnapTarget } from "./resolveSnap";

// sin(15°): how far off a world axis the span may tilt before we treat the
// partition as "angled" and skip the equidistant targets.
const OFF_AXIS_SIN = Math.sin((15 * Math.PI) / 180);
const AXIS_EPSILON = 1e-6;

type DirectedFace = {
  axis: "x" | "y";
  coordinateMm: number;
  direction: -1 | 1;
  id: string;
  // The producing wall's/slab segment's own two endpoints (room-local space,
  // same frame as coordinateMm) — carried through so the emitted SnapTarget
  // can offer its natural extent instead of the whole room bbox.
  start: Point;
  end: Point;
};

function axisAlignedRoomFaces(room: Room): DirectedFace[] {
  const faces: DirectedFace[] = [];
  for (const wall of getWallsWithGeometry(room)) {
    const outward = outwardWallNormal(room, wall);
    if (Math.abs(wall.start.xMm - wall.end.xMm) <= AXIS_EPSILON) {
      faces.push({
        axis: "x",
        coordinateMm: wall.start.xMm,
        direction: outward.xMm > 0 ? -1 : 1,
        id: `room-wall-${wall.id}`,
        start: wall.start,
        end: wall.end
      });
    } else if (Math.abs(wall.start.yMm - wall.end.yMm) <= AXIS_EPSILON) {
      faces.push({
        axis: "y",
        coordinateMm: wall.start.yMm,
        direction: outward.yMm > 0 ? -1 : 1,
        id: `room-wall-${wall.id}`,
        start: wall.start,
        end: wall.end
      });
    }
  }
  return faces;
}

function axisAlignedPartitionFaces(room: Room, excludedPartitionId?: string): DirectedFace[] {
  const faces: DirectedFace[] = [];
  for (const partition of room.freestandingWalls) {
    if (partition.id === excludedPartitionId) continue;
    const mid = {
      xMm: (partition.startXMm + partition.endXMm) / 2,
      yMm: (partition.startYMm + partition.endYMm) / 2
    };
    partitionSlabSegments(partition).forEach((segment, index) => {
      if (Math.abs(segment.a.xMm - segment.b.xMm) <= AXIS_EPSILON) {
        const coordinateMm = segment.a.xMm;
        if (Math.abs(coordinateMm - mid.xMm) <= AXIS_EPSILON) return;
        faces.push({
          axis: "x",
          coordinateMm,
          direction: coordinateMm < mid.xMm ? -1 : 1,
          id: `partition-face-${partition.id}-${index}`,
          start: segment.a,
          end: segment.b
        });
      } else if (Math.abs(segment.a.yMm - segment.b.yMm) <= AXIS_EPSILON) {
        const coordinateMm = segment.a.yMm;
        if (Math.abs(coordinateMm - mid.yMm) <= AXIS_EPSILON) return;
        faces.push({
          axis: "y",
          coordinateMm,
          direction: coordinateMm < mid.yMm ? -1 : 1,
          id: `partition-face-${partition.id}-${index}`,
          start: segment.a,
          end: segment.b
        });
      }
    });
  }
  return faces;
}

function cleanInsetTargets(args: {
  room: Room;
  placementOffsetMm: Point;
  proposedFloorMm: Point;
  incrementMm: number;
  excludedPartitionId?: string;
  movingExtentMm?: { xMm: number; yMm: number };
}): SnapTarget[] {
  const {
    room,
    placementOffsetMm,
    proposedFloorMm,
    incrementMm,
    excludedPartitionId,
    movingExtentMm = { xMm: 0, yMm: 0 }
  } = args;
  if (!Number.isFinite(incrementMm) || incrementMm <= 0) return [];

  const proposedLocal = {
    xMm: proposedFloorMm.xMm - placementOffsetMm.xMm,
    yMm: proposedFloorMm.yMm - placementOffsetMm.yMm
  };
  const faces = [
    ...axisAlignedRoomFaces(room),
    ...axisAlignedPartitionFaces(room, excludedPartitionId)
  ];

  return faces.map((face): SnapTarget => {
    const proposedCoordinate = face.axis === "x" ? proposedLocal.xMm : proposedLocal.yMm;
    const extent = face.axis === "x" ? movingExtentMm.xMm : movingExtentMm.yMm;
    const base = face.coordinateMm + face.direction * extent;
    const snappedLocal = nearestDirectedIncrement(
      proposedCoordinate,
      base,
      face.direction,
      incrementMm
    );
    // The guide's cross axis is the OTHER world axis from the face itself: an
    // x-axis face (a vertical wall/slab edge) has its natural extent along y,
    // and vice versa. Lift the producing wall's/slab's own two endpoints by
    // the same placement offset the point above already uses.
    const crossStartLocal = face.axis === "x" ? face.start.yMm : face.start.xMm;
    const crossEndLocal = face.axis === "x" ? face.end.yMm : face.end.xMm;
    const crossOffsetMm = face.axis === "x" ? placementOffsetMm.yMm : placementOffsetMm.xMm;
    const extentMm = {
      startMm: Math.min(crossStartLocal, crossEndLocal) + crossOffsetMm,
      endMm: Math.max(crossStartLocal, crossEndLocal) + crossOffsetMm
    };
    return {
      id: `partition-clean-${face.id}`,
      kind: "neighbor-edge",
      axis: face.axis,
      point: {
        xMm:
          face.axis === "x"
            ? snappedLocal + placementOffsetMm.xMm
            : proposedFloorMm.xMm,
        yMm:
          face.axis === "y"
            ? snappedLocal + placementOffsetMm.yMm
            : proposedFloorMm.yMm
      },
      extentMm
    };
  });
}

// Room-relative draw targets keep readable wall and sibling-partition gaps
// even when the room itself is offset from the absolute floor grid. Each face
// contributes only the nearest member of its half-lattice.
export function getPartitionDrawSnapTargets(
  placement: RoomPlacement,
  pointerFloorMm: Point,
  incrementMm: number
): SnapTarget[] {
  return cleanInsetTargets({
    room: placement.room,
    placementOffsetMm: { xMm: placement.offsetXMm, yMm: placement.offsetYMm },
    proposedFloorMm: pointerFloorMm,
    incrementMm
  });
}

export function getPartitionMoveSnapTargets(args: {
  room: Room;
  placementOffsetMm: Point; // lift room-local → floor space
  partition: FreestandingWall; // the dragged partition (self excluded)
  proposedMidFloorMm: Point;
  incrementMm?: number;
}): SnapTarget[] {
  const { room, placementOffsetMm, partition, proposedMidFloorMm, incrementMm } = args;
  const targets: SnapTarget[] = [];

  const proposedMidLocal: Point = {
    xMm: proposedMidFloorMm.xMm - placementOffsetMm.xMm,
    yMm: proposedMidFloorMm.yMm - placementOffsetMm.yMm
  };
  const toFloorX = (xMm: number) => xMm + placementOffsetMm.xMm;
  const toFloorY = (yMm: number) => yMm + placementOffsetMm.yMm;

  // Partition extents (unchanged by a move): half its length along the span,
  // half its thickness across the normal.
  const dx = partition.endXMm - partition.startXMm;
  const dy = partition.endYMm - partition.startYMm;
  const lengthMm = Math.hypot(dx, dy);
  const halfLen = lengthMm / 2;
  const halfThick = partition.thicknessMm / 2;

  // Orientation: which world axis is the span? (Skip equidistant if neither is
  // within ~15°.) For a roughly-horizontal partition world-x ≈ span (end-cap
  // gaps) and world-y ≈ normal (face gaps); vertical is the mirror.
  const spanUnitX = lengthMm > 0 ? dx / lengthMm : 0;
  const spanUnitY = lengthMm > 0 ? dy / lengthMm : 0;
  const horizontal = Math.abs(spanUnitY) <= OFF_AXIS_SIN;
  const vertical = Math.abs(spanUnitX) <= OFF_AXIS_SIN;

  if (lengthMm > 0 && (horizontal || vertical)) {
    const segments = collectObstacleSegments(room, partition.id);
    // Extent from the midpoint to each cast origin: the end cap along the span
    // world axis, the slab face across the normal world axis.
    const extentX = horizontal ? halfLen : halfThick;
    const extentY = horizontal ? halfThick : halfLen;

    // Equidistant-between-obstacles on one world axis. Origins are the extent
    // points, so a hit's coordinate on that axis is the obstacle's own face —
    // the equal-DISPLAYED-gap position is exactly the midpoint of the two hits.
    const equidistant = (axis: "x" | "y", extent: number, id: string) => {
      const plusOrigin: Point =
        axis === "x"
          ? { xMm: proposedMidLocal.xMm + extent, yMm: proposedMidLocal.yMm }
          : { xMm: proposedMidLocal.xMm, yMm: proposedMidLocal.yMm + extent };
      const minusOrigin: Point =
        axis === "x"
          ? { xMm: proposedMidLocal.xMm - extent, yMm: proposedMidLocal.yMm }
          : { xMm: proposedMidLocal.xMm, yMm: proposedMidLocal.yMm - extent };
      const plus = castRay(
        segments,
        plusOrigin,
        axis === "x" ? { xMm: 1, yMm: 0 } : { xMm: 0, yMm: 1 }
      );
      const minus = castRay(
        segments,
        minusOrigin,
        axis === "x" ? { xMm: -1, yMm: 0 } : { xMm: 0, yMm: -1 }
      );
      if (!plus || !minus) return;
      // A zero hit means an extent already overlaps a solid sibling slab.
      // There is no open interval to center within on this axis.
      if (plus.distanceMm <= 0 || minus.distanceMm <= 0) return;
      const midLocal: Point =
        axis === "x"
          ? { xMm: (plus.pointMm.xMm + minus.pointMm.xMm) / 2, yMm: proposedMidLocal.yMm }
          : { xMm: proposedMidLocal.xMm, yMm: (plus.pointMm.yMm + minus.pointMm.yMm) / 2 };
      // The guide's cross-axis extent can't come from plus/minus themselves:
      // both rays travel purely along `axis`, so plus.pointMm and
      // minus.pointMm are mathematically guaranteed to share the exact same
      // cross-axis coordinate (the ray's perpendicular position never
      // changes) — using them directly would always collapse to a
      // zero-length, invisible guide. Use the partition's own already-computed
      // cross-axis half-extent instead (extentY/extentX, i.e. halfThick/
      // halfLen), centered on the resolved midpoint, so the guide stays a
      // short, visible segment hugging the partition rather than sweeping
      // the room.
      const crossExtentMm = axis === "x" ? extentY : extentX;
      const crossLocalMm = axis === "x" ? midLocal.yMm : midLocal.xMm;
      const crossFloorMm = axis === "x" ? toFloorY(crossLocalMm) : toFloorX(crossLocalMm);
      targets.push({
        id,
        kind: "centerline",
        axis,
        point: { xMm: toFloorX(midLocal.xMm), yMm: toFloorY(midLocal.yMm) },
        extentMm: {
          startMm: crossFloorMm - crossExtentMm,
          endMm: crossFloorMm + crossExtentMm
        }
      });
    };

    equidistant("x", extentX, "partition-center-x");
    equidistant("y", extentY, "partition-center-y");
  }

  // Sibling-partition midpoint alignment: line up with each OTHER partition's
  // centerline midpoint on either axis.
  for (const sibling of room.freestandingWalls) {
    if (sibling.id === partition.id) continue;
    const midFloor: Point = {
      xMm: toFloorX((sibling.startXMm + sibling.endXMm) / 2),
      yMm: toFloorY((sibling.startYMm + sibling.endYMm) / 2)
    };
    // Span between the dragged partition's own (live, pre-snap) midpoint and
    // the sibling's midpoint, so the guide visibly connects the two
    // partitions it's aligning rather than sweeping the whole room.
    targets.push({
      id: `partition-sibling-${sibling.id}-x`,
      kind: "neighbor-center",
      axis: "x",
      point: midFloor,
      extentMm: {
        startMm: Math.min(proposedMidFloorMm.yMm, midFloor.yMm),
        endMm: Math.max(proposedMidFloorMm.yMm, midFloor.yMm)
      }
    });
    targets.push({
      id: `partition-sibling-${sibling.id}-y`,
      kind: "neighbor-center",
      axis: "y",
      point: midFloor,
      extentMm: {
        startMm: Math.min(proposedMidFloorMm.xMm, midFloor.xMm),
        endMm: Math.max(proposedMidFloorMm.xMm, midFloor.xMm)
      }
    });
  }

  if (incrementMm !== undefined) {
    // Bounding extents make the clean multiple describe the visible clear gap
    // from the moved slab edge, rather than its centerline, to an obstacle.
    const halfExtentX = Math.abs(spanUnitX) * halfLen + Math.abs(spanUnitY) * halfThick;
    const halfExtentY = Math.abs(spanUnitY) * halfLen + Math.abs(spanUnitX) * halfThick;
    targets.push(
      ...cleanInsetTargets({
        room,
        placementOffsetMm,
        proposedFloorMm: proposedMidFloorMm,
        incrementMm,
        excludedPartitionId: partition.id,
        movingExtentMm: { xMm: halfExtentX, yMm: halfExtentY }
      })
    );
  }

  return targets;
}
