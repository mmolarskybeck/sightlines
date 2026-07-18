import { describe, expect, it } from "vitest";
import type { FloorObject, WallObjectBase } from "../project";
import type { FloorWall } from "../geometry/planObjects";
import {
  GUIDE_OVERSHOOT_MM,
  MAX_NEIGHBOR_TARGETS_PER_AXIS,
  getFloorAlignSnapTargets
} from "./floorSnapTargets";
import type { SnapTarget } from "./resolveSnap";

// A zero-rotation FloorWall in room "room-1"; RoomVertex fields only satisfy the
// type. Same shape as planSnapTargets.test's makeWall.
function makeWall(
  id: string,
  startMm: { xMm: number; yMm: number },
  endMm: { xMm: number; yMm: number },
  roomId = "room-1"
): FloorWall {
  const dx = endMm.xMm - startMm.xMm;
  const dy = endMm.yMm - startMm.yMm;
  return {
    id,
    roomId,
    name: id,
    startVertexId: `${id}-a`,
    endVertexId: `${id}-b`,
    heightMm: 3000,
    start: { id: `${id}-a`, ...startMm },
    end: { id: `${id}-b`, ...endMm },
    lengthMm: Math.hypot(dx, dy),
    angleRad: Math.atan2(dy, dx),
    startFloorMm: startMm,
    endFloorMm: endMm
  };
}

// A 4000×4000 axis-aligned room at floor origin.
function rectRoomWalls(roomId = "room-1"): FloorWall[] {
  return [
    makeWall("north", { xMm: 0, yMm: 0 }, { xMm: 4000, yMm: 0 }, roomId),
    makeWall("east", { xMm: 4000, yMm: 0 }, { xMm: 4000, yMm: 4000 }, roomId),
    makeWall("south", { xMm: 4000, yMm: 4000 }, { xMm: 0, yMm: 4000 }, roomId),
    makeWall("west", { xMm: 0, yMm: 4000 }, { xMm: 0, yMm: 0 }, roomId)
  ];
}

function wallObject(overrides: Partial<WallObjectBase> & { id: string; wallId: string }): WallObjectBase {
  return {
    kind: "blocked-zone",
    xMm: 1000,
    yMm: 0,
    widthMm: 400,
    heightMm: 500,
    ...overrides
  } as WallObjectBase;
}

function floorObject(overrides: Partial<FloorObject> & { id: string }): FloorObject {
  return {
    kind: "blocked-zone",
    xMm: 0,
    yMm: 0,
    widthMm: 600,
    depthMm: 200,
    rotationDeg: 0,
    heightMm: 500,
    wallYMm: 1500,
    ...overrides
  } as FloorObject;
}

const movingSize = { widthMm: 600, heightMm: 500, depthMm: 200 };

function base() {
  return {
    proposedCenterMm: { xMm: 1800, yMm: 1900 },
    roomId: "room-1" as string | null,
    walls: rectRoomWalls(),
    wallObjects: [] as WallObjectBase[],
    floorObjects: [] as FloorObject[],
    movingSize,
    rotationDeg: 0
  };
}

function expectExtentContains(target: SnapTarget, ...points: number[]) {
  expect(target.extentMm).toBeDefined();
  const { startMm, endMm } = target.extentMm!;
  expect(startMm).toBeLessThanOrEqual(endMm);
  for (const point of points) {
    expect(startMm).toBeLessThanOrEqual(point);
    expect(endMm).toBeGreaterThanOrEqual(point);
  }
}

describe("getFloorAlignSnapTargets — room centerlines", () => {
  it("collapses a rect room to exactly two deduped centerlines with room-spanning extents", () => {
    const targets = getFloorAlignSnapTargets(base());
    const centerlines = targets.filter((t) => t.kind === "centerline");
    expect(centerlines).toHaveLength(2);

    const centerX = centerlines.find((t) => t.axis === "x");
    const centerY = centerlines.find((t) => t.axis === "y");
    // Horizontal walls pin x at the room's x midpoint; vertical walls pin y.
    expect(centerX?.point.xMm).toBeCloseTo(2000, 6);
    expect(centerY?.point.yMm).toBeCloseTo(2000, 6);
    expect(centerX?.id).toBe("room-center:room-1:x");
    expect(centerY?.id).toBe("room-center:room-1:y");

    // x-target (vertical line) spans the room's y bounds ± overshoot; y-target
    // (horizontal line) spans the room's x bounds ± overshoot.
    expect(centerX?.extentMm).toEqual({
      startMm: 0 - GUIDE_OVERSHOOT_MM,
      endMm: 4000 + GUIDE_OVERSHOOT_MM
    });
    expect(centerY?.extentMm).toEqual({
      startMm: 0 - GUIDE_OVERSHOOT_MM,
      endMm: 4000 + GUIDE_OVERSHOOT_MM
    });
  });

  it("emits no wall-derived targets when roomId is null", () => {
    const targets = getFloorAlignSnapTargets({
      ...base(),
      roomId: null,
      wallObjects: [wallObject({ id: "w1", wallId: "north" })],
      floorObjects: [floorObject({ id: "f1", xMm: 1500, yMm: 1500 })]
    });
    // No centerlines, no wall-object targets — only the floor object's.
    expect(targets.some((t) => t.kind === "centerline")).toBe(false);
    expect(targets.some((t) => t.id.startsWith("wall-neighbor"))).toBe(false);
    expect(targets.some((t) => t.id.startsWith("floor-neighbor"))).toBe(true);
  });

  it("skips an angled wall entirely", () => {
    const walls = [makeWall("diag", { xMm: 0, yMm: 0 }, { xMm: 3000, yMm: 3000 })];
    const targets = getFloorAlignSnapTargets({
      ...base(),
      walls,
      wallObjects: [wallObject({ id: "w1", wallId: "diag" })]
    });
    expect(targets.some((t) => t.kind === "centerline")).toBe(false);
    expect(targets.some((t) => t.id.startsWith("wall-neighbor"))).toBe(false);
  });
});

describe("getFloorAlignSnapTargets — wall-object alignment", () => {
  it("a horizontal wall's object constrains x, a vertical wall's constrains y", () => {
    const targets = getFloorAlignSnapTargets({
      ...base(),
      wallObjects: [
        wallObject({ id: "onNorth", wallId: "north", xMm: 1000 }),
        wallObject({ id: "onEast", wallId: "east", xMm: 1000 })
      ]
    });
    const northCenter = targets.find((t) => t.id === "wall-neighbor-center:onNorth:x");
    const eastCenter = targets.find((t) => t.id === "wall-neighbor-center:onEast:y");
    expect(northCenter).toMatchObject({ kind: "neighbor-center", axis: "x" });
    // north wall (0,0)->(4000,0): xMm=1000 along wall → rect center x = 1000.
    expect(northCenter?.point.xMm).toBeCloseTo(1000, 6);
    expect(eastCenter).toMatchObject({ kind: "neighbor-center", axis: "y" });
    // east wall (4000,0)->(4000,4000): xMm=1000 along wall → rect center y = 1000.
    expect(eastCenter?.point.yMm).toBeCloseTo(1000, 6);
  });

  it("edge-align uses same-side collinear edges with the moving half-extent", () => {
    // Moving width=600 depth=200, rotation 0 → half-extent along x = 300.
    // North wall object at x=1000, width=400 → objLeft=800, objRight=1200.
    const targets = getFloorAlignSnapTargets({
      ...base(),
      wallObjects: [wallObject({ id: "onNorth", wallId: "north", xMm: 1000, widthMm: 400 })]
    });
    const lo = targets.find((t) => t.id === "wall-neighbor-edge:onNorth:x:lo");
    const hi = targets.find((t) => t.id === "wall-neighbor-edge:onNorth:x:hi");
    expect(lo).toMatchObject({ kind: "neighbor-edge", axis: "x" });
    expect(lo?.point.xMm).toBeCloseTo(800 + 300, 6); // objLeft + movingHalf
    expect(hi?.point.xMm).toBeCloseTo(1200 - 300, 6); // objRight − movingHalf
  });

  it("swaps the moving half-extent when the moving object is rotated 90°", () => {
    // rotation 90 → half-extent along x = depth/2 = 100 (was width/2 = 300).
    const targets = getFloorAlignSnapTargets({
      ...base(),
      rotationDeg: 90,
      wallObjects: [wallObject({ id: "onNorth", wallId: "north", xMm: 1000, widthMm: 400 })]
    });
    const lo = targets.find((t) => t.id === "wall-neighbor-edge:onNorth:x:lo");
    expect(lo?.point.xMm).toBeCloseTo(800 + 100, 6);
  });

  it("emits center-only (no edge) targets when the moving object is rotated off a right angle", () => {
    const targets = getFloorAlignSnapTargets({
      ...base(),
      rotationDeg: 45,
      wallObjects: [wallObject({ id: "onNorth", wallId: "north", xMm: 1000 })]
    });
    expect(targets.some((t) => t.id === "wall-neighbor-center:onNorth:x")).toBe(true);
    expect(targets.some((t) => t.id.startsWith("wall-neighbor-edge:onNorth"))).toBe(false);
  });

  it("gives each wall-object guide an extent spanning the object and the moving center", () => {
    const proposedCenterMm = { xMm: 1800, yMm: 1900 };
    const targets = getFloorAlignSnapTargets({
      ...base(),
      proposedCenterMm,
      wallObjects: [wallObject({ id: "onNorth", wallId: "north", xMm: 1000 })]
    });
    const center = targets.find((t) => t.id === "wall-neighbor-center:onNorth:x")!;
    // x-target: extent spans y from the object (rect center y = 0, on the wall)
    // to the moving proposed y (1900) ± overshoot.
    expectExtentContains(center, 0, proposedCenterMm.yMm);
  });
});

describe("getFloorAlignSnapTargets — floor-object alignment", () => {
  it("emits center targets on both axes and edge targets when both rotations are right angles", () => {
    const targets = getFloorAlignSnapTargets({
      ...base(),
      floorObjects: [floorObject({ id: "f1", xMm: 1500, yMm: 1600, widthMm: 800, depthMm: 400 })]
    });
    expect(targets.some((t) => t.id === "floor-neighbor-center:f1:x")).toBe(true);
    expect(targets.some((t) => t.id === "floor-neighbor-center:f1:y")).toBe(true);
    // Moving half along x = 300, neighbor half along x = 400 → objLeft=1100.
    const loX = targets.find((t) => t.id === "floor-neighbor-edge:f1:x:lo");
    expect(loX?.point.xMm).toBeCloseTo(1500 - 400 + 300, 6);
  });

  it("emits center-only when the neighbor floor object is rotated off a right angle", () => {
    const targets = getFloorAlignSnapTargets({
      ...base(),
      floorObjects: [floorObject({ id: "f1", xMm: 1500, yMm: 1600, rotationDeg: 30 })]
    });
    expect(targets.some((t) => t.id === "floor-neighbor-center:f1:x")).toBe(true);
    expect(targets.some((t) => t.id.startsWith("floor-neighbor-edge:f1"))).toBe(false);
  });
});

describe("getFloorAlignSnapTargets — pruning and invariants", () => {
  it("caps neighbor targets per axis at MAX_NEIGHBOR_TARGETS_PER_AXIS", () => {
    // 4 floor objects × (center + 2 edges) = 12 targets per axis → capped to 8.
    const floorObjects = Array.from({ length: 4 }, (_, i) =>
      floorObject({ id: `f${i}`, xMm: 500 + i * 400, yMm: 500 + i * 400 })
    );
    const targets = getFloorAlignSnapTargets({ ...base(), roomId: null, floorObjects });
    const perAxis = (axis: "x" | "y") =>
      targets.filter((t) => t.axis === axis && t.kind !== "centerline").length;
    expect(perAxis("x")).toBe(MAX_NEIGHBOR_TARGETS_PER_AXIS);
    expect(perAxis("y")).toBe(MAX_NEIGHBOR_TARGETS_PER_AXIS);
  });

  it("keeps all centerlines regardless of the neighbor cap", () => {
    const floorObjects = Array.from({ length: 4 }, (_, i) =>
      floorObject({ id: `f${i}`, xMm: 500 + i * 400, yMm: 500 + i * 400 })
    );
    const targets = getFloorAlignSnapTargets({ ...base(), floorObjects });
    expect(targets.filter((t) => t.kind === "centerline")).toHaveLength(2);
  });

  it("every extentMm is ordered and contains both reference points", () => {
    const proposedCenterMm = { xMm: 1800, yMm: 1900 };
    const targets = getFloorAlignSnapTargets({
      ...base(),
      proposedCenterMm,
      wallObjects: [
        wallObject({ id: "onNorth", wallId: "north", xMm: 1000 }),
        wallObject({ id: "onEast", wallId: "east", xMm: 1000 })
      ],
      floorObjects: [floorObject({ id: "f1", xMm: 1500, yMm: 1600 })]
    });
    for (const target of targets) {
      expect(target.extentMm).toBeDefined();
      const { startMm, endMm } = target.extentMm!;
      expect(startMm).toBeLessThanOrEqual(endMm);
    }
  });
});
