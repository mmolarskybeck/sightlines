import { describe, expect, it } from "vitest";
import { createPolygonRoomPlacement, createRectangularRoomPlacement } from "./createRoom";
import {
  castRay,
  collectObstacleSegments,
  getPartitionClearances,
  partitionAxisForWorldAxis
} from "./partitionSpacing";
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

function withPartitions(room: Room, walls: FreestandingWall[]): Room {
  return { ...room, freestandingWalls: walls };
}

describe("castRay", () => {
  it("returns the nearest positive-t hit along a unit direction", () => {
    const room = rectRoom(4000, 3000);
    const segments = collectObstacleSegments(room, "none");
    const hit = castRay(segments, { xMm: 2000, yMm: 1500 }, { xMm: 0, yMm: 1 });
    expect(hit).not.toBeNull();
    expect(hit?.distanceMm).toBeCloseTo(1500, 6);
    expect(hit?.pointMm.yMm).toBeCloseTo(3000, 6);
  });

  it("ignores segments behind the origin (negative t)", () => {
    const room = rectRoom(4000, 3000);
    const segments = collectObstacleSegments(room, "none");
    // From near the south wall, casting up (−y) reaches the north wall (0),
    // not the south wall just behind the origin.
    const hit = castRay(segments, { xMm: 2000, yMm: 2900 }, { xMm: 0, yMm: -1 });
    expect(hit?.distanceMm).toBeCloseTo(2900, 6);
    expect(hit?.pointMm.yMm).toBeCloseTo(0, 6);
  });

  it("returns null when the origin is outside the polygon and the ray escapes", () => {
    const room = rectRoom(4000, 4000);
    const segments = collectObstacleSegments(room, "none");
    expect(castRay(segments, { xMm: 5000, yMm: 2000 }, { xMm: 0, yMm: 1 })).toBeNull();
  });

  it("returns null for a degenerate (zero) direction", () => {
    const room = rectRoom();
    const segments = collectObstacleSegments(room, "none");
    expect(castRay(segments, { xMm: 2000, yMm: 2000 }, { xMm: 0, yMm: 0 })).toBeNull();
  });
});

describe("getPartitionClearances — rectangular room (face-accurate)", () => {
  it("is symmetric for a centered partition (normal), excluding thickness/2", () => {
    const room = rectRoom(4000, 4000);
    const clear = getPartitionClearances(room, partition({ startYMm: 2000, endYMm: 2000 }));
    // Wall is 2000 from the centerline; the slab face sits 50 nearer, so the
    // TRUE clear gap is 1950 on each side — not 2000.
    expect(clear.normal.plus.hit?.distanceMm).toBeCloseTo(1950, 6);
    expect(clear.normal.minus.hit?.distanceMm).toBeCloseTo(1950, 6);
  });

  it("is asymmetric for an off-center partition (normal)", () => {
    const room = rectRoom(4000, 4000);
    // Midpoint y=1000: +y face at 1050 → south wall (4000) is 2950; −y face at
    // 950 → north wall (0) is 950.
    const clear = getPartitionClearances(room, partition({ startYMm: 1000, endYMm: 1000 }));
    expect(clear.normal.plus.hit?.distanceMm).toBeCloseTo(2950, 6);
    expect(clear.normal.minus.hit?.distanceMm).toBeCloseTo(950, 6);
  });

  it("measures end-cap gaps from the ENDPOINTS (span), excluding the length", () => {
    const room = rectRoom(4000, 4000);
    // Centerline x 1000..3000: the end cap at x=3000 is 1000 from the east
    // wall, the cap at x=1000 is 1000 from the west wall. (The old midpoint
    // cast wrongly reported 2000 — half the partition length was included.)
    const clear = getPartitionClearances(room, partition({}));
    expect(clear.span.plus.hit?.distanceMm).toBeCloseTo(1000, 6);
    expect(clear.span.minus.hit?.distanceMm).toBeCloseTo(1000, 6);
  });

  it("gives asymmetric end-cap gaps for an off-center span", () => {
    const room = rectRoom(4000, 4000);
    // Centerline x 500..1500: east cap 2500 from x=4000, west cap 500 from x=0.
    const clear = getPartitionClearances(
      room,
      partition({ startXMm: 500, endXMm: 1500 })
    );
    expect(clear.span.plus.hit?.distanceMm).toBeCloseTo(2500, 6);
    expect(clear.span.minus.hit?.distanceMm).toBeCloseTo(500, 6);
  });
});

describe("getPartitionClearances — neighboring partition as an obstacle", () => {
  it("a sibling intercepts the normal-axis ray before the perimeter", () => {
    const subject = partition({ startYMm: 2000, endYMm: 2000 });
    const sibling: FreestandingWall = {
      id: "room-1-partition-2",
      roomId: "room-1",
      name: "P2",
      startXMm: 1000,
      startYMm: 1000,
      endXMm: 3000,
      endYMm: 1000,
      heightMm: 3000,
      thicknessMm: 100
    };
    const room = withPartitions(rectRoom(4000, 4000), [subject, sibling]);
    const clear = getPartitionClearances(room, subject);
    // −y face at 1950; sibling's near (upper) face is at y=1050 → gap 900,
    // landing on the sibling, not the perimeter.
    expect(clear.normal.minus.hit?.distanceMm).toBeCloseTo(900, 6);
    expect(clear.normal.minus.hit?.obstacleId).toBe("room-1-partition-2");
    // +y still reaches the south wall.
    expect(clear.normal.plus.hit?.distanceMm).toBeCloseTo(1950, 6);
  });

  it("a sibling intercepts the span-axis (end-cap) ray before the perimeter", () => {
    const subject = partition({});
    const sibling: FreestandingWall = {
      id: "room-1-partition-2",
      roomId: "room-1",
      name: "P2",
      startXMm: 3500,
      startYMm: 1500,
      endXMm: 3500,
      endYMm: 2500,
      heightMm: 3000,
      thicknessMm: 100
    };
    const room = withPartitions(rectRoom(4000, 4000), [subject, sibling]);
    const clear = getPartitionClearances(room, subject);
    // East end cap at x=3000 → sibling's near (west) face at x=3450 → gap 450.
    expect(clear.span.plus.hit?.distanceMm).toBeCloseTo(450, 6);
    expect(clear.span.plus.hit?.obstacleId).toBe("room-1-partition-2");
    // West cap still reaches the west wall (1000).
    expect(clear.span.minus.hit?.distanceMm).toBeCloseTo(1000, 6);
  });
});

describe("getPartitionClearances — L-shaped room", () => {
  it("hits the concave (notch) wall rather than the far perimeter", () => {
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
    const clear = getPartitionClearances(room, {
      id: "room-L-partition-1",
      roomId: "room-L",
      name: "P",
      startXMm: 500,
      startYMm: 1000,
      endXMm: 1000,
      endYMm: 1000,
      heightMm: 3000,
      thicknessMm: 100
    });
    // Midpoint (750, 1000), faces at y=1050/950. Up (+y) hits the notch wall at
    // y=1500 → 450; down (−y) hits y=0 → 950.
    expect(clear.normal.plus.hit?.distanceMm).toBeCloseTo(450, 6);
    expect(clear.normal.minus.hit?.distanceMm).toBeCloseTo(950, 6);
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
      })
    );
    expect(clear.normal.plus.hit).not.toBeNull();
    expect(clear.normal.minus.hit).not.toBeNull();
    expect(clear.span.plus.hit).not.toBeNull();
    expect(clear.span.minus.hit).not.toBeNull();
    // Centered origin, opposite directions → symmetric clearances on both axes.
    expect(clear.normal.plus.hit?.distanceMm).toBeCloseTo(
      clear.normal.minus.hit?.distanceMm ?? -1,
      6
    );
    expect(clear.span.plus.hit?.distanceMm).toBeCloseTo(
      clear.span.minus.hit?.distanceMm ?? -1,
      6
    );
  });
});

describe("getPartitionClearances — ray miss", () => {
  it("returns null on every side when the partition is outside the polygon", () => {
    const room = rectRoom(4000, 4000);
    const clear = getPartitionClearances(
      room,
      partition({ startXMm: 4500, startYMm: 2000, endXMm: 5500, endYMm: 2000 })
    );
    expect(clear.normal.plus.hit).toBeNull();
    expect(clear.normal.minus.hit).toBeNull();
    expect(clear.span.plus.hit).toBeNull();
    // The −span cap at x=4500 casts back toward x=0 and DOES cross the room, so
    // that single ray hits; the other three escape. The centering guard needs
    // only one side to miss to refuse, which it does here.
    expect(clear.span.minus.hit).not.toBeNull();
  });
});

describe("partitionAxisForWorldAxis", () => {
  it("maps a horizontal partition: left–right → span (axis), up–down → normal", () => {
    const wall = partition({ startXMm: 1000, startYMm: 2000, endXMm: 3000, endYMm: 2000 });
    expect(partitionAxisForWorldAxis(wall, "x")).toBe("axis");
    expect(partitionAxisForWorldAxis(wall, "y")).toBe("normal");
  });

  it("mirrors for a vertical partition: left–right → normal, up–down → span (axis)", () => {
    const wall = partition({ startXMm: 2000, startYMm: 1000, endXMm: 2000, endYMm: 3000 });
    expect(partitionAxisForWorldAxis(wall, "x")).toBe("normal");
    expect(partitionAxisForWorldAxis(wall, "y")).toBe("axis");
  });

  it("classifies a shallow (30°) partition by its dominant span component", () => {
    // Span ≈ (0.866, 0.5): x-dominant, so it behaves like a horizontal one.
    const wall = partition({ startXMm: 0, startYMm: 0, endXMm: 866, endYMm: 500 });
    expect(partitionAxisForWorldAxis(wall, "x")).toBe("axis");
    expect(partitionAxisForWorldAxis(wall, "y")).toBe("normal");
  });

  it("breaks the exact 45° tie toward the span being x-dominant", () => {
    // |span.x| == |span.y|: world x favors the span (axis), world y the normal,
    // so the two world axes never resolve to the same direction.
    const wall = partition({ startXMm: 0, startYMm: 0, endXMm: 1000, endYMm: 1000 });
    expect(partitionAxisForWorldAxis(wall, "x")).toBe("axis");
    expect(partitionAxisForWorldAxis(wall, "y")).toBe("normal");
  });
});
