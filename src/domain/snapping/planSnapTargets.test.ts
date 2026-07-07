import { describe, expect, it } from "vitest";
import type { OpeningWallObject, WallObjectBase } from "../project";
import { WALL_OBJECT_PLAN_DEPTH_MM, type FloorWall } from "../geometry/planObjects";
import { getGridSnapTargets } from "./gridSnapTargets";
import { resolvePlanPlacement, WALL_CAPTURE_PX } from "./planSnapTargets";

// Build a FloorWall from floor-space endpoints. The room offset is already
// baked into start/end here (offset 0), so startFloorMm === start etc.; the
// RoomVertex start/end fields are unused by the snapping/geometry paths but
// required by the type.
function makeWall(
  id: string,
  startMm: { xMm: number; yMm: number },
  endMm: { xMm: number; yMm: number }
): FloorWall {
  const dx = endMm.xMm - startMm.xMm;
  const dy = endMm.yMm - startMm.yMm;
  return {
    id,
    roomId: "room-1",
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

function wallObject(overrides: Partial<OpeningWallObject> = {}): WallObjectBase {
  return {
    id: "neighbor-1",
    kind: "blocked-zone",
    wallId: "wall-1",
    blocksPlacement: true,
    xMm: 1000,
    yMm: 1500,
    widthMm: 400,
    heightMm: 600,
    ...overrides
  } as OpeningWallObject;
}

const HORIZONTAL_WALL = makeWall("wall-1", { xMm: 0, yMm: 0 }, { xMm: 4000, yMm: 0 });

const baseArgs = {
  walls: [HORIZONTAL_WALL],
  wallObjects: [] as WallObjectBase[],
  movingSize: { widthMm: 300, heightMm: 400, depthMm: 400 },
  movingKind: "artwork" as const,
  canFloat: true,
  currentAnchorWallId: null,
  captureDistanceMm: 50,
  gridTargets: [],
  snapToGrid: false,
  thresholdMm: 20
};

describe("resolvePlanPlacement — wall capture", () => {
  it("captures onto a wall when within captureDistanceMm", () => {
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 30 }, baseArgs);

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 2000 });
    expect(result.activeGuides).toEqual([]);
    expect(result.planRect.centerXMm).toBeCloseTo(2000);
    expect(result.planRect.centerYMm).toBeCloseTo(0);
    expect(result.planRect.depthMm).toBe(WALL_OBJECT_PLAN_DEPTH_MM);
    expect(result.planRect.angleDeg).toBeCloseTo(0);
  });

  it("floats (no wall) when beyond captureDistanceMm and canFloat", () => {
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 80 }, baseArgs);

    expect(result.placement.anchor).toBe("floor");
    if (result.placement.anchor === "floor") {
      expect(result.placement).toEqual({ anchor: "floor", xMm: 2000, yMm: 80 });
    }
  });
});

describe("resolvePlanPlacement — cross-boundary hysteresis", () => {
  // Distance 60mm: beyond the 50mm base radius, within the 1.5×=75mm break-free
  // radius the current anchor wall gets.
  it("keeps the anchored wall captured between 1× and 1.5× capture distance", () => {
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 60 },
      { ...baseArgs, currentAnchorWallId: "wall-1" }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 2000 });
  });

  it("floats a non-anchored object at the same distance", () => {
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 60 },
      { ...baseArgs, currentAnchorWallId: null }
    );

    expect(result.placement.anchor).toBe("floor");
  });

  it("still re-anchors to a genuinely closer non-anchor wall", () => {
    const wallB = makeWall("wall-2", { xMm: 0, yMm: 200 }, { xMm: 4000, yMm: 200 });
    // Point 10mm from wall-2, 190mm from anchored wall-1. wall-2 wins by
    // distance even though wall-1 is the sticky anchor.
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 190 },
      { ...baseArgs, walls: [HORIZONTAL_WALL, wallB], currentAnchorWallId: "wall-1" }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-2", xMm: 2000 });
  });
});

describe("resolvePlanPlacement — doors/windows never float", () => {
  const doorArgs = {
    ...baseArgs,
    movingKind: "door" as const,
    canFloat: false,
    movingSize: { widthMm: 900, heightMm: 2100, depthMm: 100 }
  };

  it("clamps to the nearest wall at any distance", () => {
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 100000 }, doorArgs);

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 2000 });
  });

  it("re-anchors across walls to whichever is nearest", () => {
    const wallB = makeWall("wall-2", { xMm: 0, yMm: 3000 }, { xMm: 4000, yMm: 3000 });
    // Closer to wall-2 (100mm) than wall-1 (2900mm), currently anchored to A.
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 2900 },
      { ...doorArgs, walls: [HORIZONTAL_WALL, wallB], currentAnchorWallId: "wall-1" }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-2", xMm: 2000 });
  });

  it("falls back to floor (no crash) when there are no walls", () => {
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 500 },
      { ...doorArgs, walls: [] }
    );

    expect(result.placement).toEqual({ anchor: "floor", xMm: 2000, yMm: 500 });
  });
});

describe("resolvePlanPlacement — floor stage grid snapping", () => {
  // A wall at y=0, but the point is 5000mm away so nothing captures.
  const gridTargets = getGridSnapTargets(100, {
    minXMm: 0,
    maxXMm: 6000,
    minYMm: 0,
    maxYMm: 6000
  });

  it("grid-snaps both axes when snapToGrid is on", () => {
    const result = resolvePlanPlacement(
      { xMm: 205, yMm: 5305 },
      { ...baseArgs, gridTargets, snapToGrid: true }
    );

    expect(result.placement).toEqual({ anchor: "floor", xMm: 200, yMm: 5300 });
    expect(result.activeGuides.length).toBeGreaterThan(0);
  });

  it("does not grid-snap when snapToGrid is off", () => {
    const result = resolvePlanPlacement(
      { xMm: 205, yMm: 5305 },
      { ...baseArgs, gridTargets, snapToGrid: false }
    );

    expect(result.placement).toEqual({ anchor: "floor", xMm: 205, yMm: 5305 });
    expect(result.activeGuides).toEqual([]);
  });

  it("passes the moving rotation through to the floor planRect", () => {
    const result = resolvePlanPlacement(
      { xMm: 5000, yMm: 5000 },
      { ...baseArgs, rotationDeg: 42 }
    );

    expect(result.planRect.angleDeg).toBe(42);
    expect(result.planRect.widthMm).toBe(300);
    expect(result.planRect.depthMm).toBe(400);
  });
});

describe("resolvePlanPlacement — wall-local neighbor snapping", () => {
  const neighbor = wallObject({ id: "n1", wallId: "wall-1", xMm: 1000, widthMm: 400 });

  it("snaps to a neighbor's center in wall-local x", () => {
    // Pointer projects to xAlong≈1005, 5mm from the neighbor-center target at 1000.
    const result = resolvePlanPlacement(
      { xMm: 1005, yMm: 5 },
      { ...baseArgs, wallObjects: [neighbor] }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 1000 });
    expect(result.snapTargetIds.x).toBe("neighbor-center:n1:x");
  });

  it("snaps to a neighbor's edge (flush) in wall-local x", () => {
    // Neighbor left edge = 1000 - 200 = 800; moving (width 300) right-edge-flush
    // center = 800 - 150 = 650. Pointer at xAlong≈655.
    const result = resolvePlanPlacement(
      { xMm: 655, yMm: 5 },
      { ...baseArgs, wallObjects: [neighbor] }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 650 });
    expect(result.snapTargetIds.x).toBe("neighbor-edge:n1:left");
  });

  it("only considers neighbors on the captured wall", () => {
    const otherWallNeighbor = wallObject({ id: "n2", wallId: "wall-2", xMm: 1005, widthMm: 400 });
    const result = resolvePlanPlacement(
      { xMm: 1005, yMm: 5 },
      { ...baseArgs, wallObjects: [otherWallNeighbor] }
    );

    // n2 is on wall-2, not the captured wall-1, so no snap occurs.
    expect(result.snapTargetIds.x).toBeUndefined();
    expect(result.placement.anchor).toBe("wall");
    if (result.placement.anchor === "wall") {
      expect(result.placement.wallId).toBe("wall-1");
      expect(result.placement.xMm).toBeCloseTo(1005);
    }
  });

  it("snaps neighbor-center along an angled (45°) wall in wall-local x", () => {
    const cos45 = Math.SQRT1_2;
    const angled = makeWall(
      "wall-1",
      { xMm: 0, yMm: 0 },
      { xMm: 4000 * cos45, yMm: 4000 * cos45 }
    );
    // Point exactly on the wall at xAlong = 1005 (t = 1005/4000).
    const t = 1005 / 4000;
    const result = resolvePlanPlacement(
      { xMm: 4000 * cos45 * t, yMm: 4000 * cos45 * t },
      { ...baseArgs, walls: [angled], wallObjects: [neighbor] }
    );

    expect(result.placement.anchor).toBe("wall");
    if (result.placement.anchor === "wall") {
      expect(result.placement.xMm).toBeCloseTo(1000);
    }
    expect(result.snapTargetIds.x).toBe("neighbor-center:n1:x");
  });
});

describe("resolvePlanPlacement — clamping", () => {
  it("clamps the center so the object's width stays on the wall (start end)", () => {
    // Pointer just past the wall start corner projects to xAlong 0 (and stays
    // within capture distance of that corner); width 300 → min 150.
    const result = resolvePlanPlacement({ xMm: -30, yMm: 5 }, baseArgs);

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 150 });
  });

  it("clamps at the far end of the wall", () => {
    // Pointer just past the wall end corner projects to xAlong 4000; max =
    // 4000 - 150 = 3850.
    const result = resolvePlanPlacement({ xMm: 4030, yMm: 5 }, baseArgs);

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 3850 });
  });

  it("centers the object on a wall shorter than the object", () => {
    const shortWall = makeWall("wall-1", { xMm: 0, yMm: 0 }, { xMm: 200, yMm: 0 });
    const result = resolvePlanPlacement(
      { xMm: 20, yMm: 5 },
      { ...baseArgs, walls: [shortWall] }
    );

    // width 300 > length 200 → no valid range → centered at length/2 = 100.
    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 100 });
  });
});

describe("resolvePlanPlacement — determinism", () => {
  it("returns identical results for identical inputs", () => {
    const args = {
      ...baseArgs,
      wallObjects: [wallObject({ id: "n1", wallId: "wall-1", xMm: 1000, widthMm: 400 })]
    };
    const a = resolvePlanPlacement({ xMm: 1005, yMm: 5 }, args);
    const b = resolvePlanPlacement({ xMm: 1005, yMm: 5 }, args);

    expect(a).toEqual(b);
  });

  it("exposes WALL_CAPTURE_PX as the canonical px default", () => {
    expect(WALL_CAPTURE_PX).toBe(24);
  });
});
