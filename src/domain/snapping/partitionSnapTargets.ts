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

import type { FreestandingWall, Room } from "../project";
import { castRay, collectObstacleSegments } from "../geometry/partitionSpacing";
import type { Point, SnapTarget } from "./resolveSnap";

// sin(15°): how far off a world axis the span may tilt before we treat the
// partition as "angled" and skip the equidistant targets.
const OFF_AXIS_SIN = Math.sin((15 * Math.PI) / 180);

export function getPartitionMoveSnapTargets(args: {
  room: Room;
  placementOffsetMm: Point; // lift room-local → floor space
  partition: FreestandingWall; // the dragged partition (self excluded)
  proposedMidFloorMm: Point;
}): SnapTarget[] {
  const { room, placementOffsetMm, partition, proposedMidFloorMm } = args;
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
      const midLocal: Point =
        axis === "x"
          ? { xMm: (plus.pointMm.xMm + minus.pointMm.xMm) / 2, yMm: proposedMidLocal.yMm }
          : { xMm: proposedMidLocal.xMm, yMm: (plus.pointMm.yMm + minus.pointMm.yMm) / 2 };
      targets.push({
        id,
        kind: "centerline",
        axis,
        point: { xMm: toFloorX(midLocal.xMm), yMm: toFloorY(midLocal.yMm) }
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
    targets.push({
      id: `partition-sibling-${sibling.id}-x`,
      kind: "neighbor-center",
      axis: "x",
      point: midFloor
    });
    targets.push({
      id: `partition-sibling-${sibling.id}-y`,
      kind: "neighbor-center",
      axis: "y",
      point: midFloor
    });
  }

  return targets;
}
