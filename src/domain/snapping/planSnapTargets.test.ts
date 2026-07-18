import { describe, expect, it } from "vitest";
import type { CaseFloorObject, OpeningWallObject, WallObjectBase } from "../project";
import { WALL_OBJECT_PLAN_DEPTH_MM, type FloorWall } from "../geometry/planObjects";
import { unitLeftNormal } from "../geometry/vector";
import { getGridSnapTargets } from "./gridSnapTargets";
import { floatPolicyForKind, resolvePlanPlacement, WALL_CAPTURE_PX } from "./planSnapTargets";

// Build a zero-offset FloorWall; RoomVertex fields only satisfy the type.
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
  // Generic floor-stage tests opt into floating; artwork rejection is tested separately.
  floatPolicy: "float" as const,
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
    floatPolicy: "capture-any" as const,
    movingSize: { widthMm: 900, heightMm: 2100, depthMm: 100 }
  };

  it("clamps to the nearest wall at any distance", () => {
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 100000 }, doorArgs);

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 2000 });
  });

  it("re-anchors across walls to whichever is nearest", () => {
    const wallB = makeWall("wall-2", { xMm: 0, yMm: 3000 }, { xMm: 4000, yMm: 3000 });
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
  const gridTargets = getGridSnapTargets(100, {
    minXMm: 0,
    maxXMm: 6000,
    minYMm: 0,
    maxYMm: 6000
  });

  it("grid-snaps an EDGE (not the center) to the lattice when snapToGrid is on", () => {
    // movingSize is 300×400 (width×depth), rotation 0 (unrotated) → halfW=150,
    // halfD=200. Proposed (45, 5105) sits within threshold of the edge-hi
    // candidates of grid lines x=200 (200−150=50) and y=5300 (5300−200=5100) —
    // the object's right/bottom edge lands on the line, not its center.
    const result = resolvePlanPlacement(
      { xMm: 45, yMm: 5105 },
      { ...baseArgs, gridTargets, snapToGrid: true }
    );

    expect(result.placement).toEqual({ anchor: "floor", xMm: 50, yMm: 5100 });
  });

  it("never draws guide lines for grid snaps (showGuide false)", () => {
    const result = resolvePlanPlacement(
      { xMm: 45, yMm: 5105 },
      { ...baseArgs, gridTargets, snapToGrid: true }
    );

    expect(result.activeGuides.length).toBeGreaterThan(0);
    for (const guide of result.activeGuides) {
      expect(guide.showGuide).toBe(false);
    }
  });

  it("does not grid-snap when snapToGrid is off", () => {
    const result = resolvePlanPlacement(
      { xMm: 205, yMm: 5305 },
      { ...baseArgs, gridTargets, snapToGrid: false }
    );

    expect(result.placement).toEqual({ anchor: "floor", xMm: 205, yMm: 5305 });
    expect(result.activeGuides).toEqual([]);
  });

  it("swaps width/depth for the edge half-extent at a 90° rotation", () => {
    // At 90°, the object's stored width (300) runs along floor-y and its depth
    // (400) runs along floor-x, so the x-edge offset becomes halfD (200) and
    // the y-edge offset becomes halfW (150) — the reverse of the unrotated case.
    // Uses its own coarser (1000mm) grid so the edge-candidate arithmetic below
    // stays unambiguous relative to neighboring lines.
    const rotatedGridTargets = getGridSnapTargets(1000, {
      minXMm: 0,
      maxXMm: 6000,
      minYMm: 0,
      maxYMm: 6000
    });
    const result = resolvePlanPlacement(
      { xMm: 1795, yMm: 1845 },
      { ...baseArgs, gridTargets: rotatedGridTargets, snapToGrid: true, rotationDeg: 90 }
    );

    // edge-hi of line x=2000 with halfW(swapped)=200 → center 1800.
    // edge-hi of line y=2000 with halfD(swapped)=150 → center 1850.
    expect(result.placement).toEqual({ anchor: "floor", xMm: 1800, yMm: 1850 });
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
    const result = resolvePlanPlacement(
      { xMm: 1005, yMm: 5 },
      { ...baseArgs, wallObjects: [neighbor] }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 1000 });
    expect(result.snapTargetIds.x).toBe("neighbor-center:n1:x");
  });

  it("snaps to a neighbor's edge (flush) in wall-local x", () => {
    const result = resolvePlanPlacement(
      { xMm: 655, yMm: 5 },
      { ...baseArgs, wallObjects: [neighbor] }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 650 });
    expect(result.snapTargetIds.x).toBe("neighbor-edge:n1:left");
  });

  it("aligns framed outer edges when callers provide adapted footprints", () => {
    const framedNeighbor = wallObject({
      id: "framed-neighbor",
      wallId: "wall-1",
      xMm: 1000,
      widthMm: 600
    });
    const result = resolvePlanPlacement(
      { xMm: 455, yMm: 5 },
      {
        ...baseArgs,
        wallObjects: [framedNeighbor],
        // Stored image width is 300; mat + frame make the painted width 500.
        wallFootprintWidthMm: 500
      }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 450 });
    expect(result.snapTargetIds.x).toBe("neighbor-edge:framed-neighbor:left");
    // moving right edge 700 is tangent to neighbor left edge 700.
    expect(result.planRect.centerXMm + result.planRect.widthMm / 2).toBe(700);
  });

  it("only considers neighbors on the captured wall", () => {
    const otherWallNeighbor = wallObject({ id: "n2", wallId: "wall-2", xMm: 1005, widthMm: 400 });
    const result = resolvePlanPlacement(
      { xMm: 1005, yMm: 5 },
      { ...baseArgs, wallObjects: [otherWallNeighbor] }
    );

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
    const result = resolvePlanPlacement({ xMm: -30, yMm: 5 }, baseArgs);

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 150 });
  });

  it("clamps at the far end of the wall", () => {
    const result = resolvePlanPlacement({ xMm: 4030, yMm: 5 }, baseArgs);

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 3850 });
  });

  it("clamps a framed footprint at the wall edge", () => {
    const result = resolvePlanPlacement(
      { xMm: -30, yMm: 5 },
      { ...baseArgs, wallFootprintWidthMm: 500 }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 250 });
    expect(result.planRect.widthMm).toBe(500);
  });

  it("uses the outer width for a wall ghost but preserves image width on the floor", () => {
    const args = { ...baseArgs, wallFootprintWidthMm: 500 };
    const wallGhost = resolvePlanPlacement({ xMm: 2000, yMm: 5 }, args);
    const floorGhost = resolvePlanPlacement({ xMm: 2000, yMm: 100 }, args);

    expect(wallGhost.planRect.widthMm).toBe(500);
    expect(floorGhost.placement.anchor).toBe("floor");
    expect(floorGhost.planRect.widthMm).toBe(300);
  });

  it("a floor-only placement keeps the image width even if a footprint width is passed", () => {
    // Floor geometry is framing-agnostic by decision (Phase 6b): the floor stage
    // never widens, even on a wall and even when handed an outer width.
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 5 },
      {
        ...baseArgs,
        floatPolicy: floatPolicyForKind("artwork", "floor"),
        wallFootprintWidthMm: 500
      }
    );

    expect(result.placement.anchor).toBe("floor");
    expect(result.planRect.widthMm).toBe(300);
  });

  it("centers the object on a wall shorter than the object", () => {
    const shortWall = makeWall("wall-1", { xMm: 0, yMm: 0 }, { xMm: 200, yMm: 0 });
    const result = resolvePlanPlacement(
      { xMm: 20, yMm: 5 },
      { ...baseArgs, walls: [shortWall] }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 100 });
  });
});

describe("resolvePlanPlacement — side-aware capture on coincident twin walls", () => {
  // Coincident anti-parallel faces require an interior-side tie-break.
  const wallB = makeWall("wall-B", { xMm: 0, yMm: 1000 }, { xMm: 4000, yMm: 1000 });
  const wallA = makeWall("wall-A", { xMm: 4000, yMm: 1000 }, { xMm: 0, yMm: 1000 });
  const twinWalls = [wallA, wallB];

  it("captures the wall whose unitLeftNormal (interior/left) side holds the cursor", () => {
    // Derive the interior side from unitLeftNormal rather than assuming its sign.
    const leftB = unitLeftNormal(wallB.startFloorMm, wallB.endFloorMm); // (0, +1)
    const onWall = { xMm: 2000, yMm: 1000 };

    const cursorInB = { xMm: onWall.xMm + leftB.xMm * 30, yMm: onWall.yMm + leftB.yMm * 30 };
    const resultB = resolvePlanPlacement(cursorInB, { ...baseArgs, walls: twinWalls });
    expect(resultB.placement.anchor).toBe("wall");
    if (resultB.placement.anchor === "wall") expect(resultB.placement.wallId).toBe("wall-B");

    const cursorInA = { xMm: onWall.xMm - leftB.xMm * 30, yMm: onWall.yMm - leftB.yMm * 30 };
    const resultA = resolvePlanPlacement(cursorInA, { ...baseArgs, walls: twinWalls });
    expect(resultA.placement.anchor).toBe("wall");
    if (resultA.placement.anchor === "wall") expect(resultA.placement.wallId).toBe("wall-A");
  });

  it("lets the interior side win even when the other wall is closer within the tie epsilon", () => {
    // Within the distance epsilon, interior side outranks the slightly nearer face.
    const wallHigh = makeWall("wall-high", { xMm: 4000, yMm: 1000.5 }, { xMm: 0, yMm: 1000.5 });
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 1000.8 },
      { ...baseArgs, walls: [wallHigh, wallB] }
    );
    expect(result.placement.anchor).toBe("wall");
    if (result.placement.anchor === "wall") expect(result.placement.wallId).toBe("wall-B");
  });

  it("falls back to deterministic wallId order when the cursor is on the line (no side)", () => {
    // With no interior side, wall ID provides deterministic ordering.
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 1000 }, { ...baseArgs, walls: twinWalls });
    expect(result.placement.anchor).toBe("wall");
    if (result.placement.anchor === "wall") expect(result.placement.wallId).toBe("wall-A");
  });
});

describe("resolvePlanPlacement — artwork reject policy (wall-only)", () => {
  const rejectArgs = { ...baseArgs, floatPolicy: floatPolicyForKind("artwork") };

  it("floatPolicyForKind maps kinds to their policy", () => {
    expect(floatPolicyForKind("artwork")).toBe("reject");
    expect(floatPolicyForKind("artwork", "wall")).toBe("reject");
    expect(floatPolicyForKind("artwork", "floor")).toBe("floor-only");
    expect(floatPolicyForKind("blocked-zone")).toBe("float");
    expect(floatPolicyForKind("door")).toBe("capture-any");
    expect(floatPolicyForKind("window")).toBe("capture-any");
    // A case floats: wall capture only within capture distance, so an
    // open-floor click yields a floor case rather than grabbing the nearest
    // wall at any distance (which would make floor cases unreachable).
    expect(floatPolicyForKind("case")).toBe("float");
  });

  it("rejects (anchor 'none') when no wall captures, with a cursor-tracking rect and no guides", () => {
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 80 }, rejectArgs);
    expect(result.placement).toEqual({ anchor: "none" });
    expect(result.planRect.centerXMm).toBeCloseTo(2000);
    expect(result.planRect.centerYMm).toBeCloseTo(80);
    expect(result.activeGuides).toEqual([]);
  });

  it("keeps the framed outer width in the rejected ghost (it is still a wall work)", () => {
    // A reject is a wall-only work that lost capture, not a floor object: the
    // ghost must not shrink to the image width the instant the wall lets go.
    const args = { ...rejectArgs, wallFootprintWidthMm: 500 };
    const captured = resolvePlanPlacement({ xMm: 2000, yMm: 30 }, args);
    const rejected = resolvePlanPlacement({ xMm: 2000, yMm: 80 }, args);

    expect(captured.placement.anchor).toBe("wall");
    expect(rejected.placement).toEqual({ anchor: "none" });
    expect(rejected.planRect.widthMm).toBe(500);
    expect(rejected.planRect.widthMm).toBe(captured.planRect.widthMm);
  });

  it("falls back to the image width in the rejected ghost when the work is unframed", () => {
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 80 }, rejectArgs);
    expect(result.planRect.widthMm).toBe(300);
  });

  it("still captures a wall in range — reject only bites when nothing captures", () => {
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 30 }, rejectArgs);
    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 2000 });
  });

  it("a blocked-zone still floats where an artwork would reject", () => {
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 80 },
      { ...baseArgs, movingKind: "blocked-zone", floatPolicy: floatPolicyForKind("blocked-zone") }
    );
    expect(result.placement).toEqual({ anchor: "floor", xMm: 2000, yMm: 80 });
  });

  it("a door still captures at any distance where an artwork would reject", () => {
    const result = resolvePlanPlacement(
      { xMm: 2000, yMm: 100000 },
      {
        ...baseArgs,
        movingKind: "door",
        floatPolicy: floatPolicyForKind("door"),
        movingSize: { widthMm: 900, heightMm: 2100, depthMm: 100 }
      }
    );
    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 2000 });
  });
});

describe("resolvePlanPlacement — floor-only policy (floor artwork)", () => {
  const floorOnlyArgs = {
    ...baseArgs,
    movingKind: "artwork" as const,
    floatPolicy: floatPolicyForKind("artwork", "floor")
  };

  it("never captures a wall even when dropped directly on one", () => {
    // Floor-only objects ignore walls even inside capture distance.
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 30 }, floorOnlyArgs);
    expect(result.placement).toEqual({ anchor: "floor", xMm: 2000, yMm: 30 });
  });

  it("lands on the floor far from every wall (no reject)", () => {
    const result = resolvePlanPlacement({ xMm: 2000, yMm: 80 }, floorOnlyArgs);
    expect(result.placement).toEqual({ anchor: "floor", xMm: 2000, yMm: 80 });
  });

  it("grid-snaps an edge on the floor stage like any floated placement", () => {
    // movingSize (from floorOnlyArgs/baseArgs) is 300×400 → halfW=150, halfD=200.
    // Proposed (1845, 205) lands near the edge-hi candidate of line x=2000
    // (2000−150=1850) and the edge-lo candidate of line y=0 (0+200=200).
    const gridTargets = getGridSnapTargets(1000, {
      minXMm: 0,
      maxXMm: 4000,
      minYMm: -1000,
      maxYMm: 1000
    });
    const result = resolvePlanPlacement(
      { xMm: 1845, yMm: 205 },
      { ...floorOnlyArgs, gridTargets, snapToGrid: true }
    );
    expect(result.placement).toEqual({ anchor: "floor", xMm: 1850, yMm: 200 });
  });

  it("leaves the wall work's reject policy unchanged (regression guard)", () => {
    const wallWork = resolvePlanPlacement(
      { xMm: 2000, yMm: 30 },
      { ...baseArgs, floatPolicy: floatPolicyForKind("artwork", "wall") }
    );
    expect(wallWork.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 2000 });
  });
});

function caseFloorObject(overrides: Partial<CaseFloorObject> = {}): CaseFloorObject {
  return {
    id: "floor-case-1",
    kind: "case",
    xMm: 2500,
    yMm: 1500,
    widthMm: 500,
    depthMm: 500,
    rotationDeg: 0,
    heightMm: 900,
    wallYMm: 0,
    ...overrides
  };
}

describe("resolvePlanPlacement — floor stage alignment (Phase 3)", () => {
  // A rectangular room, walls tagged with the same roomId as HORIZONTAL_WALL
  // (south), so all four are picked up as the room by getFloorAlignSnapTargets.
  // Room bounds: x in [0, 4000], y in [0, 3000] → centerlines at x=2000, y=1500.
  const NORTH_WALL = makeWall("wall-north", { xMm: 4000, yMm: 3000 }, { xMm: 0, yMm: 3000 });
  const WEST_WALL = makeWall("wall-west", { xMm: 0, yMm: 3000 }, { xMm: 0, yMm: 0 });
  const EAST_WALL = makeWall("wall-east", { xMm: 4000, yMm: 0 }, { xMm: 4000, yMm: 3000 });
  const ROOM_WALLS = [HORIZONTAL_WALL, NORTH_WALL, WEST_WALL, EAST_WALL];

  const alignArgs = {
    ...baseArgs,
    walls: ROOM_WALLS,
    movingKind: "case" as const,
    floatPolicy: "float" as const,
    floorAlign: { roomId: "room-1", floorObjects: [] as CaseFloorObject[] }
  };

  it("snaps a proposed center near the room centerline to it, beating grid, with a bounded visible guide", () => {
    const gridTargets = getGridSnapTargets(100, {
      minXMm: 0,
      maxXMm: 4000,
      minYMm: 0,
      maxYMm: 3000
    });
    const result = resolvePlanPlacement(
      { xMm: 2005, yMm: 1490 },
      { ...alignArgs, gridTargets, snapToGrid: true }
    );

    // y (1490) is also within threshold of the y-centerline (1500), so both
    // axes snap independently — expected, per resolveSnap's per-axis policy.
    expect(result.placement).toEqual({ anchor: "floor", xMm: 2000, yMm: 1500 });
    expect(result.snapTargetIds.x).toBe("room-center:room-1:x");
    const xGuide = result.activeGuides.find((guide) => guide.axis === "x");
    expect(xGuide).toBeDefined();
    expect(xGuide?.showGuide).not.toBe(false);
    expect(xGuide?.extentMm).toBeDefined();
    // Bounded to the room's y-span (0..3000) padded by the overshoot, not a
    // full-viewport line.
    expect(xGuide!.extentMm!.startMm).toBeGreaterThan(-1000);
    expect(xGuide!.extentMm!.endMm).toBeLessThan(4000);
  });

  it("snaps to a wall object's projected center on the along-wall axis", () => {
    const wallCase = wallObject({ id: "wall-case-1", wallId: "wall-1", xMm: 1000, widthMm: 400 });
    const result = resolvePlanPlacement(
      { xMm: 1005, yMm: 500 },
      { ...alignArgs, wallObjects: [wallCase] }
    );

    expect(result.placement).toEqual({ anchor: "floor", xMm: 1000, yMm: 500 });
    expect(result.snapTargetIds.x).toBe("wall-neighbor-center:wall-case-1:x");
  });

  it("lets edge-align beat center-align when the edge target is nearer (equal priority)", () => {
    // Wall object center 1000, width 400 → edges at 800/1200. Moving width 600
    // (halfW 300) → edge-lo align center = 1100, edge-hi = 900, center = 1000.
    // Proposing 1090 is nearest the edge-lo target; with neighbor-center and
    // neighbor-edge at equal priority the NEAREST relationship must capture.
    const wallCase = wallObject({ id: "wall-case-1", wallId: "wall-1", xMm: 1000, widthMm: 400 });
    const result = resolvePlanPlacement(
      { xMm: 1090, yMm: 500 },
      {
        ...alignArgs,
        wallObjects: [wallCase],
        movingSize: { widthMm: 600, heightMm: 900, depthMm: 500 }
      }
    );

    expect(result.snapTargetIds.x).toBe("wall-neighbor-edge:wall-case-1:x:lo");
    expect(result.placement).toEqual({ anchor: "floor", xMm: 1100, yMm: 500 });
    // The guide draws through the ALIGNED EDGE (wall object's left edge at
    // 800), not through the moving object's snapped center (1100) — a line
    // through the mover's middle would read as a center snap.
    const xGuide = result.activeGuides.find((guide) => guide.axis === "x");
    expect(xGuide?.positionMm).toBe(800);
  });

  it("keeps alignment active even with snapToGrid:false", () => {
    const result = resolvePlanPlacement(
      { xMm: 2005, yMm: 1490 },
      { ...alignArgs, snapToGrid: false }
    );

    expect(result.placement).toEqual({ anchor: "floor", xMm: 2000, yMm: 1500 });
    expect(result.snapTargetIds.x).toBe("room-center:room-1:x");
  });

  it("draws no alignment guides on the rejected path (floorAlign stripped)", () => {
    const rejectArgs = {
      ...alignArgs,
      movingKind: "artwork" as const,
      floatPolicy: floatPolicyForKind("artwork")
    };
    // Far from every wall so nothing captures, and near the room centerline
    // so alignment WOULD fire if it leaked through.
    const result = resolvePlanPlacement({ xMm: 2005, yMm: 1490 }, rejectArgs);

    expect(result.placement).toEqual({ anchor: "none" });
    expect(result.activeGuides).toEqual([]);
  });
});

describe("resolvePlanPlacement — wall-anchored grid snap (Phase 5a)", () => {
  // widthMm 600 (not 500) so halfW=300 ≠ interval/2 (250): edge-hi of line
  // 2000 (1700) and edge-lo of line 1500 (1800) land on distinct points,
  // avoiding a tie between two representations of the same crossing.
  const wallCaseArgs = {
    ...baseArgs,
    movingKind: "case" as const,
    floatPolicy: "float" as const,
    movingSize: { widthMm: 600, heightMm: 900, depthMm: 500 }
  };

  it("snaps a wall case's edge to a grid crossing when snapToGrid is on", () => {
    // halfW = 300. Grid line x=2000 → edge-hi candidate center = 2000-300=1700.
    const gridTargets = getGridSnapTargets(500, {
      minXMm: 0,
      maxXMm: 4000,
      minYMm: -10,
      maxYMm: 10
    });
    const result = resolvePlanPlacement(
      { xMm: 1705, yMm: 5 },
      { ...wallCaseArgs, gridTargets, snapToGrid: true }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 1700 });
    expect(result.snapTargetIds.x).toBe("wall-grid:grid-x-2000:edge-hi");
  });

  it("is continuous (no grid snap) when snapToGrid is off", () => {
    const gridTargets = getGridSnapTargets(500, {
      minXMm: 0,
      maxXMm: 4000,
      minYMm: -10,
      maxYMm: 10
    });
    const result = resolvePlanPlacement(
      { xMm: 1705, yMm: 5 },
      { ...wallCaseArgs, gridTargets, snapToGrid: false }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 1705 });
  });

  it("prefers a nearby same-wall neighbor over a coincident grid crossing", () => {
    const gridTargets = getGridSnapTargets(500, {
      minXMm: 0,
      maxXMm: 4000,
      minYMm: -10,
      maxYMm: 10
    });
    const neighbor = wallObject({ id: "n-grid", wallId: "wall-1", xMm: 1700, widthMm: 400 });
    const result = resolvePlanPlacement(
      { xMm: 1705, yMm: 5 },
      { ...wallCaseArgs, gridTargets, snapToGrid: true, wallObjects: [neighbor] }
    );

    expect(result.placement).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 1700 });
    expect(result.snapTargetIds.x).toBe("neighbor-center:n-grid:x");
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
