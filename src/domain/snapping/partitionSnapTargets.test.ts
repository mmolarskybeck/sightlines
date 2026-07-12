import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../geometry/createRoom";
import { getPartitionMoveSnapTargets } from "./partitionSnapTargets";
import type { FreestandingWall, Room } from "../project";

function room(): Room {
  return createRectangularRoomPlacement({
    roomId: "room-1",
    name: "Gallery",
    widthMm: 4000,
    depthMm: 4000,
    heightMm: 3000,
    offsetXMm: 0,
    offsetYMm: 0
  }).room;
}

const dragged: FreestandingWall = {
  id: "room-1-partition-1",
  roomId: "room-1",
  name: "P1",
  startXMm: 1000,
  startYMm: 2000,
  endXMm: 3000,
  endYMm: 2000,
  heightMm: 3000,
  thicknessMm: 100
};

describe("getPartitionMoveSnapTargets", () => {
  it("emits equidistant-between-walls targets (kind centerline) on both axes", () => {
    const targets = getPartitionMoveSnapTargets({
      room: room(),
      placementOffsetMm: { xMm: 0, yMm: 0 },
      partition: dragged,
      proposedMidFloorMm: { xMm: 1800, yMm: 1900 }
    });
    const centerX = targets.find((t) => t.id === "partition-center-x");
    const centerY = targets.find((t) => t.id === "partition-center-y");
    // 4000x4000 room → the equidistant point is the room center on each axis.
    expect(centerX).toMatchObject({ kind: "centerline", axis: "x" });
    expect(centerX?.point.xMm).toBeCloseTo(2000, 6);
    expect(centerY).toMatchObject({ kind: "centerline", axis: "y" });
    expect(centerY?.point.yMm).toBeCloseTo(2000, 6);
  });

  it("lifts targets to floor space by the placement offset", () => {
    const targets = getPartitionMoveSnapTargets({
      room: room(),
      placementOffsetMm: { xMm: 500, yMm: 300 },
      partition: dragged,
      proposedMidFloorMm: { xMm: 2500, yMm: 2300 } // room-local (2000, 2000)
    });
    const centerX = targets.find((t) => t.id === "partition-center-x");
    const centerY = targets.find((t) => t.id === "partition-center-y");
    expect(centerX?.point.xMm).toBeCloseTo(2500, 6); // 2000 local + 500 offset
    expect(centerY?.point.yMm).toBeCloseTo(2300, 6); // 2000 local + 300 offset
  });

  it("emits sibling midpoint alignment targets on both axes, excluding self", () => {
    const withSibling: Room = {
      ...room(),
      freestandingWalls: [
        dragged,
        {
          id: "room-1-partition-2",
          roomId: "room-1",
          name: "P2",
          startXMm: 500,
          startYMm: 500,
          endXMm: 1500,
          endYMm: 500,
          heightMm: 3000,
          thicknessMm: 100
        }
      ]
    };
    const targets = getPartitionMoveSnapTargets({
      room: withSibling,
      placementOffsetMm: { xMm: 0, yMm: 0 },
      partition: dragged,
      proposedMidFloorMm: { xMm: 2000, yMm: 2000 }
    });
    // No target references the dragged partition's own id.
    expect(targets.some((t) => t.id.includes("room-1-partition-1"))).toBe(false);
    const sibX = targets.find((t) => t.id === "partition-sibling-room-1-partition-2-x");
    const sibY = targets.find((t) => t.id === "partition-sibling-room-1-partition-2-y");
    expect(sibX).toMatchObject({ kind: "neighbor-center", axis: "x" });
    expect(sibX?.point.xMm).toBeCloseTo(1000, 6); // sibling midpoint x
    expect(sibY).toMatchObject({ kind: "neighbor-center", axis: "y" });
    expect(sibY?.point.yMm).toBeCloseTo(500, 6); // sibling midpoint y
  });

  it("bounds an equidistant axis on a neighboring partition, not the far wall", () => {
    // A vertical sibling at x=3500 (faces at 3450/3550) sits to the east of the
    // dragged horizontal partition. The +x end-cap ray stops on the sibling's
    // near face (3450) instead of the east wall (4000); the −x ray reaches the
    // west wall (0). Equidistant x = midpoint of the two hits = 1725.
    const withSibling: Room = {
      ...room(),
      freestandingWalls: [
        {
          id: "room-1-partition-2",
          roomId: "room-1",
          name: "P2",
          startXMm: 3500,
          startYMm: 1500,
          endXMm: 3500,
          endYMm: 2500,
          heightMm: 3000,
          thicknessMm: 100
        }
      ]
    };
    const targets = getPartitionMoveSnapTargets({
      room: withSibling,
      placementOffsetMm: { xMm: 0, yMm: 0 },
      partition: dragged,
      proposedMidFloorMm: { xMm: 2000, yMm: 2000 }
    });
    const centerX = targets.find((t) => t.id === "partition-center-x");
    expect(centerX).toMatchObject({ kind: "centerline", axis: "x" });
    expect(centerX?.point.xMm).toBeCloseTo(1725, 6);
  });

  it("omits an equidistant target on an axis where an extent overlaps a sibling", () => {
    const withSibling: Room = {
      ...room(),
      freestandingWalls: [
        {
          id: "room-1-partition-2",
          roomId: "room-1",
          name: "P2",
          startXMm: 2950,
          startYMm: 1500,
          endXMm: 2950,
          endYMm: 2500,
          heightMm: 3000,
          thicknessMm: 200
        }
      ]
    };

    const targets = getPartitionMoveSnapTargets({
      room: withSibling,
      placementOffsetMm: { xMm: 0, yMm: 0 },
      partition: dragged,
      proposedMidFloorMm: { xMm: 2000, yMm: 2000 }
    });

    expect(targets.some((target) => target.id === "partition-center-x")).toBe(false);
    expect(targets.some((target) => target.id === "partition-center-y")).toBe(true);
  });
});
