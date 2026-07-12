// Wall-aware snap targets for a partition MOVE drag (plan mode). Two families,
// both ranked above the grid so they win when in range:
//   • equidistant-between-walls — cast ±x and ±y from the proposed midpoint to
//     the room perimeter; where both directions hit, offer the span midpoint on
//     that axis. Snapping to it lands the partition exactly where the Step-2
//     "center between walls" action would (kind "centerline", priority 1).
//   • sibling-partition midpoint alignment — each OTHER partition's centerline
//     midpoint, offered on both axes so a dragged partition lines up with a
//     neighbour (kind "neighbor-center", priority 2).
// Pure: room-local geometry cast in room-local space, every emitted target
// lifted to floor space by the placement offset so it competes directly with
// the floor-space grid targets inside resolveSnap.

import type { FreestandingWall, Room } from "../project";
import { castRayToPerimeter } from "../geometry/partitionSpacing";
import type { Point, SnapTarget } from "./resolveSnap";

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

  // Equidistant-between-walls, per axis. Both rays along an axis must hit for
  // a midpoint to exist; the target snaps only that axis (the other is free).
  const equidistant = (
    dirPlus: Point,
    dirMinus: Point,
    axis: "x" | "y",
    id: string
  ) => {
    const plus = castRayToPerimeter(room, proposedMidLocal, dirPlus);
    const minus = castRayToPerimeter(room, proposedMidLocal, dirMinus);
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

  equidistant({ xMm: 1, yMm: 0 }, { xMm: -1, yMm: 0 }, "x", "partition-center-x");
  equidistant({ xMm: 0, yMm: 1 }, { xMm: 0, yMm: -1 }, "y", "partition-center-y");

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
