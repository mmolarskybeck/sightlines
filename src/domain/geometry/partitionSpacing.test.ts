import { describe, expect, it } from "vitest";
import { createPolygonRoomPlacement, createRectangularRoomPlacement } from "./createRoom";
import { castRayToPerimeter, getPartitionClearances } from "./partitionSpacing";
import type { FreestandingWall, Room } from "../project";

function rectRoom(widthMm = 4000, depthMm = 4000): Room {
  return createRectangularRoomPlacement({
    roomId: "room-1",
    name: "Gallery",
    widthMm,
    depthMm,
    heightMm: 3000,
    offsetXMm: 0,
    offsetYMm: 0
  }).room;
}

function partition(over: Partial<FreestandingWall>): FreestandingWall {
  return {
    id: "room-1-partition-1",
    roomId: "room-1",
    name: "Partition 1",
    startXMm: 1000,
    startYMm: 2000,
    endXMm: 3000,
    endYMm: 2000,
    heightMm: 3000,
    thicknessMm: 100,
    ...over
  };
}

describe("castRayToPerimeter", () => {
  it("returns the nearest positive-t hit along a unit direction", () => {
    const room = rectRoom(4000, 3000);
    const hit = castRayToPerimeter(room, { xMm: 2000, yMm: 1500 }, { xMm: 0, yMm: 1 });
    expect(hit).not.toBeNull();
    expect(hit?.distanceMm).toBeCloseTo(1500, 6);
    expect(hit?.pointMm.yMm).toBeCloseTo(3000, 6);
  });

  it("ignores segments behind the origin (negative t)", () => {
    const room = rectRoom(4000, 3000);
    // From near the south wall, casting up should reach the NORTH wall (2000),
    // not the south wall just behind the origin.
    const hit = castRayToPerimeter(room, { xMm: 2000, yMm: 2900 }, { xMm: 0, yMm: -1 });
    expect(hit?.distanceMm).toBeCloseTo(2900, 6);
    expect(hit?.pointMm.yMm).toBeCloseTo(0, 6);
  });

  it("returns null when the origin is outside the polygon and the ray escapes", () => {
    const room = rectRoom(4000, 4000);
    expect(castRayToPerimeter(room, { xMm: 5000, yMm: 2000 }, { xMm: 0, yMm: 1 })).toBeNull();
  });

  it("returns null for a degenerate (zero) direction", () => {
    const room = rectRoom();
    expect(castRayToPerimeter(room, { xMm: 2000, yMm: 2000 }, { xMm: 0, yMm: 0 })).toBeNull();
  });
});

describe("getPartitionClearances — rectangular room", () => {
  it("is symmetric for a centered partition (normal axis)", () => {
    const room = rectRoom(4000, 4000);
    const clear = getPartitionClearances(room, partition({ startYMm: 2000, endYMm: 2000 }), "normal");
    expect(clear.plus?.distanceMm).toBeCloseTo(2000, 6);
    expect(clear.minus?.distanceMm).toBeCloseTo(2000, 6);
  });

  it("is asymmetric for an off-center partition (normal axis)", () => {
    const room = rectRoom(4000, 4000);
    // Midpoint at y=1000: down to south wall (y=4000) is 3000; up to north
    // wall (y=0) is 1000.
    const clear = getPartitionClearances(
      room,
      partition({ startYMm: 1000, endYMm: 1000 }),
      "normal"
    );
    expect(clear.plus?.distanceMm).toBeCloseTo(3000, 6);
    expect(clear.minus?.distanceMm).toBeCloseTo(1000, 6);
  });

  it("measures end clearances along the centerline (axis)", () => {
    const room = rectRoom(4000, 4000);
    // Centerline x 1000..3000, midpoint x=2000: each end is 2000 from a side wall.
    const clear = getPartitionClearances(room, partition({}), "axis");
    expect(clear.plus?.distanceMm).toBeCloseTo(2000, 6);
    expect(clear.minus?.distanceMm).toBeCloseTo(2000, 6);
  });
});

describe("getPartitionClearances — L-shaped room", () => {
  it("hits the concave (notch) wall rather than the far perimeter", () => {
    // L occupying the lower arm (x 0..3000, y 0..1500) plus an upper-right
    // arm (x 1500..3000, y 1500..3000). A partition in the lower-left arm
    // casts up into the notch's horizontal wall at y=1500, not the top at y=3000.
    const room = createPolygonRoomPlacement({
      roomId: "room-L",
      name: "L Gallery",
      heightMm: 3000,
      pointsFloorMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 3000, yMm: 0 },
        { xMm: 3000, yMm: 3000 },
        { xMm: 1500, yMm: 3000 },
        { xMm: 1500, yMm: 1500 },
        { xMm: 0, yMm: 1500 }
      ]
    }).room;
    const clear = getPartitionClearances(
      room,
      {
        id: "room-L-partition-1",
        roomId: "room-L",
        name: "P",
        startXMm: 500,
        startYMm: 1000,
        endXMm: 1000,
        endYMm: 1000,
        heightMm: 3000,
        thicknessMm: 100
      },
      "normal"
    );
    // Midpoint (750, 1000). Up hits the notch wall at y=1500 (500); down hits y=0 (1000).
    expect(clear.plus?.distanceMm).toBeCloseTo(500, 6);
    expect(clear.minus?.distanceMm).toBeCloseTo(1000, 6);
  });
});

describe("getPartitionClearances — angled partition", () => {
  it("stays symmetric for a 30°-angled partition centered in a square room", () => {
    const room = rectRoom(4000, 4000);
    const angleRad = (30 * Math.PI) / 180;
    const half = 800;
    const cx = 2000;
    const cy = 2000;
    const clear = getPartitionClearances(
      room,
      partition({
        startXMm: cx - Math.cos(angleRad) * half,
        startYMm: cy - Math.sin(angleRad) * half,
        endXMm: cx + Math.cos(angleRad) * half,
        endYMm: cy + Math.sin(angleRad) * half
      }),
      "normal"
    );
    expect(clear.plus).not.toBeNull();
    expect(clear.minus).not.toBeNull();
    // Centered origin, opposite directions → symmetric clearances.
    expect(clear.plus?.distanceMm).toBeCloseTo(clear.minus?.distanceMm ?? -1, 6);
  });
});

describe("getPartitionClearances — ray miss", () => {
  it("returns nulls when the centerline midpoint is outside the polygon", () => {
    const room = rectRoom(4000, 4000);
    const clear = getPartitionClearances(
      room,
      partition({ startXMm: 4500, startYMm: 2000, endXMm: 5500, endYMm: 2000 }),
      "normal"
    );
    expect(clear.plus).toBeNull();
    expect(clear.minus).toBeNull();
  });
});
