import { describe, expect, it } from "vitest";
import type { FloorWall } from "../geometry/planObjects";
import type { PlanRect } from "../geometry/planObjects";
import {
  derivePlanFloorGaps,
  derivePlanSceneGaps,
  derivePlanWallGaps,
  derivePlanWallGapsAllObjects,
  type PlanFloorObjectInput
} from "./planDimensions";

// A floor object as a center+size+angle plan rect (the shape planScene emits).
function floorObject(
  id: string,
  centerXMm: number,
  centerYMm: number,
  widthMm: number,
  depthMm: number,
  roomId: string | null = "room",
  angleDeg = 0
): PlanFloorObjectInput {
  return { id, roomId, rect: { centerXMm, centerYMm, widthMm, depthMm, angleDeg } };
}

// A room wall lifted into floor space; only the fields the dimension pass reads
// are populated (roomId, id, endpoints, length) — the rest of FloorWall is
// irrelevant here, so the object is cast to the type.
function wall(id: string, roomId: string, start: [number, number], end: [number, number]): FloorWall {
  const [sx, sy] = start;
  const [ex, ey] = end;
  return {
    id,
    roomId,
    startFloorMm: { xMm: sx, yMm: sy },
    endFloorMm: { xMm: ex, yMm: ey },
    lengthMm: Math.hypot(ex - sx, ey - sy)
  } as unknown as FloorWall;
}

// A 4000×3000 rectangular room: walls run clockwise so the interior is enclosed.
const RECT_ROOM_WALLS: FloorWall[] = [
  wall("w-top", "room", [0, 0], [4000, 0]),
  wall("w-right", "room", [4000, 0], [4000, 3000]),
  wall("w-bottom", "room", [4000, 3000], [0, 3000]),
  wall("w-left", "room", [0, 3000], [0, 0])
];

describe("derivePlanFloorGaps", () => {
  it("returns nothing when no floor object is selected", () => {
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(),
      floorObjects: [floorObject("a", 1000, 1500, 400, 400)],
      walls: RECT_ROOM_WALLS
    });
    expect(gaps).toEqual([]);
  });

  it("dimensions the horizontal gap between two side-by-side floor objects", () => {
    // a: x in [800,1200], b: x in [2000,2400], both at y ~1500 → a 800mm gap.
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(["a"]),
      floorObjects: [
        floorObject("a", 1000, 1500, 400, 400),
        floorObject("b", 2200, 1500, 400, 400)
      ],
      walls: RECT_ROOM_WALLS
    });
    const pair = gaps.find((gap) => gap.id.startsWith("floor-gap:") && gap.gapMm > 100);
    expect(pair).toBeDefined();
    // Facing edges: a's right (1200) to b's left (2000).
    expect(pair?.gapMm).toBeCloseTo(800, 3);
    expect(pair?.aMm.xMm).toBeCloseTo(1200, 3);
    expect(pair?.bMm.xMm).toBeCloseTo(2000, 3);
  });

  it("reads a touching pair as a 0mm gap", () => {
    // a: [800,1200], b: [1200,1600] — edges coincident.
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(["a"]),
      floorObjects: [
        floorObject("a", 1000, 1500, 400, 400),
        floorObject("b", 1400, 1500, 400, 400)
      ],
      walls: RECT_ROOM_WALLS
    });
    const touching = gaps.find(
      (gap) => gap.aMm.yMm === gap.bMm.yMm && gap.gapMm < 1 && gap.id.includes("floor-gap")
    );
    expect(touching).toBeDefined();
    expect(touching?.gapMm).toBe(0);
  });

  it("emits no gap between two overlapping floor objects", () => {
    // Same center → true 2-D overlap, which the engine never prints as a gap.
    // Only the wall-strip gaps for the selected object should survive.
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(["a"]),
      floorObjects: [
        floorObject("a", 1000, 1500, 400, 400),
        floorObject("b", 1000, 1500, 400, 400)
      ],
      walls: RECT_ROOM_WALLS
    });
    // ids sort endpoints lexically: an a↔b gap would be "floor-gap:a:b:*".
    const abGap = gaps.find((gap) => gap.id.startsWith("floor-gap:a:b:"));
    expect(abGap).toBeUndefined();
  });

  it("dimensions a lone object to its nearest room walls via strip participants", () => {
    // A single object near the left wall: its nearest horizontal neighbor is the
    // wall on the left, and nearest vertical neighbors are top/bottom walls.
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(["a"]),
      floorObjects: [floorObject("a", 500, 1500, 400, 400)],
      walls: RECT_ROOM_WALLS
    });
    // Left-wall gap: object's left edge (300) to the wall at x=0 → 300mm.
    const leftWallGap = gaps.find(
      (gap) => gap.aMm.yMm === gap.bMm.yMm && Math.abs(gap.gapMm - 300) < 1
    );
    expect(leftWallGap).toBeDefined();
  });

  it("keeps neighbor gaps only in the room containing the selection", () => {
    // Two rooms; a selected object in room A must not dimension to an object in
    // room B (walls/objects are grouped per room).
    const roomBWalls: FloorWall[] = [
      wall("b-top", "roomB", [5000, 0], [9000, 0]),
      wall("b-right", "roomB", [9000, 0], [9000, 3000]),
      wall("b-bottom", "roomB", [9000, 3000], [5000, 3000]),
      wall("b-left", "roomB", [5000, 3000], [5000, 0])
    ];
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(["a"]),
      floorObjects: [
        floorObject("a", 1000, 1500, 400, 400, "room"),
        floorObject("b", 6000, 1500, 400, 400, "roomB")
      ],
      walls: [...RECT_ROOM_WALLS, ...roomBWalls]
    });
    // Object "b" would appear as a ":b:" endpoint in any cross-room gap id.
    expect(gaps.every((gap) => !gap.id.includes(":b:"))).toBe(true);
  });

  it("skips an off-axis (rotated) selected object entirely", () => {
    // A 45°-rotated object has no axis-aligned footprint → no dims at all.
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(["a"]),
      floorObjects: [
        floorObject("a", 1000, 1500, 400, 400, "room", 45),
        floorObject("b", 2200, 1500, 400, 400)
      ],
      walls: RECT_ROOM_WALLS
    });
    expect(gaps.every((gap) => !gap.id.includes("a"))).toBe(true);
  });

  it("treats a 90°-rotated object as axis-aligned with swapped extents", () => {
    // At 90° width↔depth swap: a 200×600 object rotated 90° spans 600 along x.
    // Its right edge sits at 1000 + 300 = 1300; b's left at 2000 → 700mm gap.
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(["a"]),
      floorObjects: [
        floorObject("a", 1000, 1500, 200, 600, "room", 90),
        floorObject("b", 2200, 1500, 400, 400)
      ],
      walls: RECT_ROOM_WALLS
    });
    const pair = gaps.find((gap) => gap.id.includes("floor-gap") && gap.gapMm > 100);
    expect(pair?.gapMm).toBeCloseTo(700, 3);
    expect(pair?.aMm.xMm).toBeCloseTo(1300, 3);
  });

  it("dimensions a floor object inside an L-shaped (polygon) room", () => {
    // An L-room: the object sits in the leg where only some wall segments span
    // its position. It still dimensions to the walls whose spans overlap it.
    const lWalls: FloorWall[] = [
      wall("l1", "room", [0, 0], [2000, 0]),
      wall("l2", "room", [2000, 0], [2000, 2000]),
      wall("l3", "room", [2000, 2000], [4000, 2000]),
      wall("l4", "room", [4000, 2000], [4000, 4000]),
      wall("l5", "room", [4000, 4000], [0, 4000]),
      wall("l6", "room", [0, 4000], [0, 0])
    ];
    const gaps = derivePlanFloorGaps({
      selectedIds: new Set(["a"]),
      floorObjects: [floorObject("a", 500, 3000, 400, 400)],
      walls: lWalls
    });
    // Object left edge (300) to the left wall l6 (x=0) → 300mm.
    const leftWallGap = gaps.find(
      (gap) => gap.aMm.yMm === gap.bMm.yMm && Math.abs(gap.gapMm - 300) < 1
    );
    expect(leftWallGap).toBeDefined();
  });
});

describe("derivePlanWallGaps", () => {
  // A horizontal room wall along y=0, 4000mm long, from origin.
  const horizontalWall = wall("wall", "room", [0, 0], [4000, 0]);

  it("dimensions a lone wall object to both wall ends", () => {
    const gaps = derivePlanWallGaps({
      selectedObject: { id: "art", xMm: 2000, widthMm: 400 },
      others: [],
      wall: horizontalWall
    });
    // Left clearance: wall start (0) to object left edge (1800) → 1800.
    // Right clearance: object right edge (2200) to wall end (4000) → 1800.
    expect(gaps).toHaveLength(2);
    const [lo, hi] = gaps;
    expect(lo.gapMm).toBeCloseTo(1800, 3);
    expect(hi.gapMm).toBeCloseTo(1800, 3);
    // Endpoints lifted along the wall (y stays 0 on the line itself).
    expect(lo.aMm.xMm).toBeCloseTo(0, 3);
    expect(lo.bMm.xMm).toBeCloseTo(1800, 3);
    expect(hi.aMm.xMm).toBeCloseTo(2200, 3);
    expect(hi.bMm.xMm).toBeCloseTo(4000, 3);
  });

  it("dimensions to the nearest neighbor on the same wall per side", () => {
    // Neighbor to the left at x=800 (edges [600,1000]); selected at 2000.
    const gaps = derivePlanWallGaps({
      selectedObject: { id: "art", xMm: 2000, widthMm: 400 },
      others: [{ id: "nb", xMm: 800, widthMm: 400 }],
      wall: horizontalWall
    });
    const leftGap = gaps.find((gap) => gap.id.endsWith(":lo"));
    // Neighbor right edge (1000) to object left edge (1800) → 800mm.
    expect(leftGap?.gapMm).toBeCloseTo(800, 3);
    expect(leftGap?.aMm.xMm).toBeCloseTo(1000, 3);
  });

  it("drops a side with no clearance (flush against a neighbor)", () => {
    // Neighbor right edge coincident with the object's left edge → no left line.
    const gaps = derivePlanWallGaps({
      selectedObject: { id: "art", xMm: 2000, widthMm: 400 },
      others: [{ id: "nb", xMm: 1600, widthMm: 400 }],
      wall: horizontalWall
    });
    expect(gaps.some((gap) => gap.id.endsWith(":lo"))).toBe(false);
    expect(gaps.some((gap) => gap.id.endsWith(":hi"))).toBe(true);
  });

  it("returns nothing for a degenerate (zero-length) wall", () => {
    const gaps = derivePlanWallGaps({
      selectedObject: { id: "art", xMm: 0, widthMm: 400 },
      others: [],
      wall: wall("deg", "room", [1000, 1000], [1000, 1000])
    });
    expect(gaps).toEqual([]);
  });
});

describe("derivePlanWallGapsAllObjects", () => {
  const horizontalWall = wall("wall", "room", [0, 0], [4000, 0]);

  it("emits every along-wall gap once: both ends plus each interior pair", () => {
    // a:[600,1000] b:[1800,2200] c:[3200,3600] on a 4000mm wall.
    const gaps = derivePlanWallGapsAllObjects({
      objects: [
        { id: "a", xMm: 800, widthMm: 400 },
        { id: "b", xMm: 2000, widthMm: 400 },
        { id: "c", xMm: 3400, widthMm: 400 }
      ],
      wall: horizontalWall
    });
    // left end 600, a→b 800, b→c 1000, right end 400 → four distinct gaps.
    expect(gaps.map((gap) => Math.round(gap.gapMm))).toEqual([600, 800, 1000, 400]);
    // Each gap emitted exactly once (no A→B / B→A duplication).
    expect(new Set(gaps.map((gap) => gap.id)).size).toBe(gaps.length);
  });

  it("drops a flush (zero-clearance) segment between touching objects", () => {
    // a:[600,1000] b:[1000,1400] touch at 1000 → no interior gap, only the ends.
    const gaps = derivePlanWallGapsAllObjects({
      objects: [
        { id: "a", xMm: 800, widthMm: 400 },
        { id: "b", xMm: 1200, widthMm: 400 }
      ],
      wall: horizontalWall
    });
    expect(gaps.map((gap) => Math.round(gap.gapMm))).toEqual([600, 2600]);
  });

  it("returns nothing for a degenerate wall or no objects", () => {
    expect(
      derivePlanWallGapsAllObjects({
        objects: [{ id: "a", xMm: 800, widthMm: 400 }],
        wall: wall("deg", "room", [10, 10], [10, 10])
      })
    ).toEqual([]);
    expect(
      derivePlanWallGapsAllObjects({ objects: [], wall: horizontalWall })
    ).toEqual([]);
  });
});

describe("derivePlanSceneGaps", () => {
  it("combines floor-object gaps (all selected) with wall spacing chains", () => {
    const gaps = derivePlanSceneGaps({
      floorObjects: [
        floorObject("f1", 800, 1500, 400, 400),
        floorObject("f2", 2000, 1500, 400, 400)
      ],
      walls: RECT_ROOM_WALLS,
      wallObjects: [
        { id: "w1", wallId: "w-top", xMm: 800, widthMm: 400 },
        { id: "w2", wallId: "w-top", xMm: 2000, widthMm: 400 }
      ]
    });
    // A floor gap between f1 and f2 (800mm) survives without any selection set.
    expect(
      gaps.some(
        (gap) => gap.id.startsWith("floor-gap:") && Math.round(gap.gapMm) === 800
      )
    ).toBe(true);
    // The two wall objects yield ONE gap between them (800mm), not two.
    const interior = gaps.filter(
      (gap) => gap.id.startsWith("wall-gap:") && Math.round(gap.gapMm) === 800
    );
    expect(interior).toHaveLength(1);
  });

  it("emits no wall gaps for a wall with no objects", () => {
    const gaps = derivePlanSceneGaps({
      floorObjects: [],
      walls: RECT_ROOM_WALLS,
      wallObjects: []
    });
    expect(gaps.filter((gap) => gap.id.startsWith("wall-gap:"))).toEqual([]);
  });
});
