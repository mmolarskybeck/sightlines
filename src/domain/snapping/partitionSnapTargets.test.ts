import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../geometry/createRoom";
import { getGridSnapTargets } from "./gridSnapTargets";
import {
  getPartitionDrawSnapTargets,
  getPartitionMoveSnapTargets
} from "./partitionSnapTargets";
import type { FreestandingWall, Room } from "../project";
import { resolveSnap } from "./resolveSnap";
import { feetToMm } from "../units/length";

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
    // Each guide's cross-axis extent hugs the dragged partition's own
    // half-thickness (100mm thick → 50mm) / half-length (2000mm long → 1000mm)
    // footprint, centered on its live (pre-snap) position — tight, not the
    // whole room.
    expect(centerX?.extentMm?.startMm).toBeCloseTo(1850, 6); // 1900 (mid y) - 50
    expect(centerX?.extentMm?.endMm).toBeCloseTo(1950, 6);
    expect(centerY?.extentMm?.startMm).toBeCloseTo(800, 6); // 1800 (mid x) - 1000
    expect(centerY?.extentMm?.endMm).toBeCloseTo(2800, 6);
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
    // Extent spans between the dragged partition's live position (2000, 2000)
    // and the sibling's midpoint (1000, 500) — connecting the two partitions,
    // not the whole room.
    expect(sibX?.extentMm).toEqual({ startMm: 500, endMm: 2000 });
    expect(sibY?.extentMm).toEqual({ startMm: 1000, endMm: 2000 });
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

  it("offers clean clear-gap targets from room walls and sibling slab faces", () => {
    const withSibling: Room = {
      ...room(),
      freestandingWalls: [
        dragged,
        {
          id: "room-1-partition-2",
          roomId: "room-1",
          name: "P2",
          startXMm: 3000,
          startYMm: 1000,
          endXMm: 3000,
          endYMm: 3000,
          heightMm: 3000,
          thicknessMm: 200
        }
      ]
    };
    const targets = getPartitionMoveSnapTargets({
      room: withSibling,
      placementOffsetMm: { xMm: 0, yMm: 0 },
      partition: dragged,
      proposedMidFloorMm: { xMm: 1800, yMm: 1650 },
      incrementMm: 500
    });

    const westWall = targets.find(
      (target) => target.id === "partition-clean-room-wall-room-1-wall-west"
    );
    // The horizontal partition's west end cap is 1000mm from its midpoint;
    // midpoint x=2000 therefore leaves a clean 1000mm wall gap.
    expect(westWall).toMatchObject({ kind: "neighbor-edge", axis: "x" });
    expect(westWall?.point.xMm).toBe(2000);
    // The west wall's own extent (its full run in y, i.e. the room's depth),
    // not the whole room bbox padded by 200mm.
    expect(westWall?.extentMm).toEqual({ startMm: 0, endMm: 4000 });

    const siblingWestFace = targets.find(
      (target) => target.id === "partition-clean-partition-face-room-1-partition-2-0"
    );
    expect(siblingWestFace).toMatchObject({ kind: "neighbor-edge", axis: "x" });
    expect(siblingWestFace?.point.xMm).toBe(1900);
    // The sibling slab face's own run in y (1000 to 3000), not the room bbox.
    expect(siblingWestFace?.extentMm).toEqual({ startMm: 1000, endMm: 3000 });
  });
});

describe("getPartitionDrawSnapTargets", () => {
  it("snaps to an exact 22ft room-relative inset ahead of the absolute grid", () => {
    const oddWidthMm = feetToMm(77) + 2 * 25.4;
    const placement = createRectangularRoomPlacement({
      roomId: "odd-room",
      name: "Odd Gallery",
      widthMm: oddWidthMm,
      depthMm: feetToMm(30),
      heightMm: 3000,
      offsetXMm: 0,
      offsetYMm: 0
    });
    // The east wall is 2in off the absolute foot lattice, so a clean 22ft
    // inset is at 55ft 2in rather than the absolute-grid candidate at 55ft.
    const exactInsetFloorX = oddWidthMm - feetToMm(22);
    const pointer = { xMm: exactInsetFloorX + 8, yMm: feetToMm(10) + 5 };
    const roomRelative = getPartitionDrawSnapTargets(placement, pointer, feetToMm(1));
    const grid = getGridSnapTargets(feetToMm(1), {
      minXMm: 0,
      maxXMm: feetToMm(100),
      minYMm: 0,
      maxYMm: feetToMm(40)
    });

    const resolved = resolveSnap(pointer, [...grid, ...roomRelative], { thresholdMm: 100 });

    expect(resolved.point.xMm).toBeCloseTo(exactInsetFloorX, 6);
    expect(resolved.snapTargetIds.x).toBe("partition-clean-room-wall-odd-room-wall-east");
    expect(resolved.snapTargetIds.x).not.toBe(`grid-x-${feetToMm(55)}`);
  });

  it("offers the nearest clean gap outside each face of an axis-aligned sibling slab", () => {
    const placement = createRectangularRoomPlacement({
      roomId: "room-1",
      name: "Gallery",
      widthMm: 6000,
      depthMm: 4000,
      heightMm: 3000,
      offsetXMm: 100,
      offsetYMm: 200
    });
    placement.room.freestandingWalls = [
      {
        ...dragged,
        startXMm: 2500,
        endXMm: 2500,
        startYMm: 1000,
        endYMm: 3000,
        thicknessMm: 200
      }
    ];
    const targets = getPartitionDrawSnapTargets(
      placement,
      { xMm: 3410, yMm: 2200 },
      500
    );

    const eastFace = targets.find(
      (target) => target.id === "partition-clean-partition-face-room-1-partition-1-1"
    );
    expect(eastFace).toMatchObject({ kind: "neighbor-edge", axis: "x" });
    // East slab face is local x=2600; nearest outward 500mm multiple is 3100,
    // then the room placement lifts it to floor x=3200.
    expect(eastFace?.point.xMm).toBe(3200);
  });

  it("returns no targets for a degenerate increment", () => {
    const placement = createRectangularRoomPlacement({
      roomId: "room-1",
      name: "Gallery",
      widthMm: 4000,
      depthMm: 4000,
      heightMm: 3000,
      offsetXMm: 0,
      offsetYMm: 0
    });
    expect(getPartitionDrawSnapTargets(placement, { xMm: 1000, yMm: 1000 }, 0)).toEqual([]);
  });
});
