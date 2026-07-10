import { describe, expect, it } from "vitest";
import { resolveDragBarriers, type BarrierObstacle } from "./dragBarriers";

// A 400×400 mover unless a test overrides it — small enough to fit the gaps and
// walls below, big enough that penetration numbers read cleanly.
const SIZE = { widthMm: 400, heightMm: 400 };

function obstacle(overrides: Partial<BarrierObstacle> & { boundsMm: BarrierObstacle["boundsMm"] }): BarrierObstacle {
  return {
    id: "obs",
    hardness: "yielding",
    ...overrides
  };
}

// A tall obstacle spanning y 0..1000 with a horizontal span, so drags aimed at
// its left face penetrate shallowly on x and deeply on y — the x face is the
// minimum-translation axis.
function tallBox(id: string, leftMm: number, rightMm: number, hardness: BarrierObstacle["hardness"]) {
  return obstacle({ id, hardness, boundsMm: { leftMm, rightMm, bottomMm: 0, topMm: 1000 } });
}

describe("resolveDragBarriers", () => {
  it("clamps a small penetration into a yielding obstacle flush on the least-penetration axis", () => {
    // Right edge (1020) pokes 20mm into the obstacle's left face (1000); y is
    // fully engulfed (400mm deep) → x is the shallower axis and wins.
    const result = resolveDragBarriers({
      proposedCenterMm: { xMm: 820, yMm: 500 },
      movingSizeMm: SIZE,
      obstacles: [tallBox("a", 1000, 2000, "yielding")],
      breakThresholdMm: 50,
      brokenBarrierIds: new Set(),
      includeYielding: true
    });

    // Flush: right edge sits exactly on the obstacle's left face → center 800.
    expect(result.point).toEqual({ xMm: 800, yMm: 500 });
    expect(result.brokenBarrierIds).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it("pops a yielding obstacle when pushed past the break threshold, leaving the point unclamped", () => {
    // 100mm of x penetration against a 50mm threshold → the macOS pop.
    const result = resolveDragBarriers({
      proposedCenterMm: { xMm: 900, yMm: 500 },
      movingSizeMm: SIZE,
      obstacles: [tallBox("a", 1000, 2000, "yielding")],
      breakThresholdMm: 50,
      brokenBarrierIds: new Set(),
      includeYielding: true
    });

    expect(result.point).toEqual({ xMm: 900, yMm: 500 }); // untouched — passed through
    expect(result.brokenBarrierIds).toEqual(["a"]);
    expect(result.blocked).toBe(false);
  });

  it("never yields a hard obstacle at any depth and clamps even under the precision bypass", () => {
    // Deep penetration (100mm), tiny threshold (10mm), precision bypass on — a
    // yielding barrier would have popped, but a hard one still clamps flush.
    const result = resolveDragBarriers({
      proposedCenterMm: { xMm: 900, yMm: 500 },
      movingSizeMm: SIZE,
      obstacles: [tallBox("a", 1000, 2000, "hard")],
      breakThresholdMm: 10,
      brokenBarrierIds: new Set(),
      includeYielding: false
    });

    expect(result.point).toEqual({ xMm: 800, yMm: 500 });
    expect(result.brokenBarrierIds).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it("ignores a yielding obstacle entirely under the precision bypass", () => {
    // Overlapping a yielding barrier, but includeYielding=false makes it a
    // no-op: no clamp, no broken id, and no block (it isn't hard).
    const result = resolveDragBarriers({
      proposedCenterMm: { xMm: 900, yMm: 500 },
      movingSizeMm: SIZE,
      obstacles: [tallBox("a", 1000, 2000, "yielding")],
      breakThresholdMm: 50,
      brokenBarrierIds: new Set(),
      includeYielding: false
    });

    expect(result.point).toEqual({ xMm: 900, yMm: 500 });
    expect(result.brokenBarrierIds).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  describe("hysteresis across frames", () => {
    const obstacles = [tallBox("a", 1000, 2000, "yielding")];

    it("does not re-clamp an already-broken obstacle while still overlapping, and retains its id", () => {
      const result = resolveDragBarriers({
        proposedCenterMm: { xMm: 900, yMm: 500 }, // still overlapping
        movingSizeMm: SIZE,
        obstacles,
        breakThresholdMm: 50,
        brokenBarrierIds: new Set(["a"]),
        includeYielding: true
      });

      expect(result.point).toEqual({ xMm: 900, yMm: 500 }); // no clamp — barrier disabled
      expect(result.brokenBarrierIds).toEqual(["a"]); // retained: still overlapping
    });

    it("drops the broken id once the object separates", () => {
      const result = resolveDragBarriers({
        proposedCenterMm: { xMm: 3000, yMm: 500 }, // clear of the obstacle
        movingSizeMm: SIZE,
        obstacles,
        breakThresholdMm: 50,
        brokenBarrierIds: new Set(["a"]),
        includeYielding: true
      });

      expect(result.brokenBarrierIds).toEqual([]); // separation re-arms
    });

    it("re-arms the barrier so the next frame clamps again", () => {
      const result = resolveDragBarriers({
        proposedCenterMm: { xMm: 820, yMm: 500 }, // shallow overlap again
        movingSizeMm: SIZE,
        obstacles,
        breakThresholdMm: 50,
        brokenBarrierIds: new Set(), // re-armed (empty after separation)
        includeYielding: true
      });

      expect(result.point).toEqual({ xMm: 800, yMm: 500 }); // clamps once more
    });
  });

  it("lets a pre-seeded broken object drag out from an initial overlap without fighting", () => {
    // The object began the drag already overlapping (its id pre-seeded). Mid-way
    // out it is still overlapping but must NOT be clamped back in — that would
    // fight the user's drag. The id rides along until fully clear.
    const obstacles = [tallBox("a", 1000, 2000, "yielding")];

    const midway = resolveDragBarriers({
      proposedCenterMm: { xMm: 850, yMm: 500 }, // right edge 1050, 50mm inside
      movingSizeMm: SIZE,
      obstacles,
      breakThresholdMm: 50,
      brokenBarrierIds: new Set(["a"]),
      includeYielding: true
    });
    expect(midway.point).toEqual({ xMm: 850, yMm: 500 }); // unclamped
    expect(midway.brokenBarrierIds).toEqual(["a"]);

    const clear = resolveDragBarriers({
      proposedCenterMm: { xMm: 700, yMm: 500 }, // right edge 900, fully out
      movingSizeMm: SIZE,
      obstacles,
      breakThresholdMm: 50,
      brokenBarrierIds: new Set(["a"]),
      includeYielding: true
    });
    expect(clear.brokenBarrierIds).toEqual([]);
  });

  it("blocks when squeezed between two hard obstacles with no room", () => {
    // A 300mm gap can't hold a 400mm-wide rect: clamping off one hard face just
    // shoves it into the other, so no legal point exists → blocked.
    const obstacles = [
      obstacle({ id: "left", hardness: "hard", boundsMm: { leftMm: 0, rightMm: 1000, bottomMm: 0, topMm: 1000 } }),
      obstacle({ id: "right", hardness: "hard", boundsMm: { leftMm: 1300, rightMm: 2300, bottomMm: 0, topMm: 1000 } })
    ];

    const result = resolveDragBarriers({
      proposedCenterMm: { xMm: 1150, yMm: 500 }, // centered in the too-small gap
      movingSizeMm: SIZE,
      obstacles,
      breakThresholdMm: 50,
      brokenBarrierIds: new Set(),
      includeYielding: true
    });

    expect(result.blocked).toBe(true);
  });

  describe("wall container barrier", () => {
    const wallSizeMm = { lengthMm: 3000, heightMm: 2500 };

    it("clamps a small overhang flush inside the wall", () => {
      const result = resolveDragBarriers({
        proposedCenterMm: { xMm: 100, yMm: 1250 }, // left edge -100, 100mm past
        movingSizeMm: SIZE,
        obstacles: [],
        wallSizeMm,
        breakThresholdMm: 200,
        brokenBarrierIds: new Set(),
        includeYielding: true
      });

      expect(result.point.xMm).toBe(200); // left edge flush at 0
      expect(result.brokenBarrierIds).toEqual([]);
    });

    it("pops past the wall edge when the overhang exceeds the threshold", () => {
      const result = resolveDragBarriers({
        proposedCenterMm: { xMm: 100, yMm: 1250 }, // 100mm overhang
        movingSizeMm: SIZE,
        obstacles: [],
        wallSizeMm,
        breakThresholdMm: 50, // 100 > 50 → pop
        brokenBarrierIds: new Set(),
        includeYielding: true
      });

      expect(result.point.xMm).toBe(100); // unclamped
      expect(result.brokenBarrierIds).toEqual(["wall:left"]);
    });

    it("re-arms the wall edge once the object comes back inside", () => {
      const result = resolveDragBarriers({
        proposedCenterMm: { xMm: 200, yMm: 1250 }, // left edge exactly at 0, no overhang
        movingSizeMm: SIZE,
        obstacles: [],
        wallSizeMm,
        breakThresholdMm: 50,
        brokenBarrierIds: new Set(["wall:left"]),
        includeYielding: true
      });

      expect(result.brokenBarrierIds).toEqual([]); // dropped — no longer overhanging
    });

    it("skips the container entirely under the precision bypass", () => {
      const result = resolveDragBarriers({
        proposedCenterMm: { xMm: 100, yMm: 1250 },
        movingSizeMm: SIZE,
        obstacles: [],
        wallSizeMm,
        breakThresholdMm: 200,
        brokenBarrierIds: new Set(),
        includeYielding: false
      });

      expect(result.point.xMm).toBe(100); // no clamp
    });
  });

  it("does not clamp an exact flush edge-touch (strict overlap convention)", () => {
    // Right edge (1000) meets the obstacle's left face (1000) exactly — flush,
    // which is not overlap, so nothing to resolve.
    const result = resolveDragBarriers({
      proposedCenterMm: { xMm: 800, yMm: 500 },
      movingSizeMm: SIZE,
      obstacles: [tallBox("a", 1000, 2000, "yielding")],
      breakThresholdMm: 50,
      brokenBarrierIds: new Set(),
      includeYielding: true
    });

    expect(result.point).toEqual({ xMm: 800, yMm: 500 });
    expect(result.brokenBarrierIds).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it("resolves a corner overlap along a single axis with no diagonal teleport", () => {
    // Enters the obstacle's lower-left corner: 50mm on x, 350mm on y. Only x
    // (the shallower axis) moves; y is left untouched — no corner jump.
    const result = resolveDragBarriers({
      proposedCenterMm: { xMm: 850, yMm: 1150 },
      movingSizeMm: SIZE,
      obstacles: [obstacle({ id: "a", hardness: "yielding", boundsMm: { leftMm: 1000, rightMm: 2000, bottomMm: 1000, topMm: 2000 } })],
      breakThresholdMm: 500, // high enough to clamp, not pop
      brokenBarrierIds: new Set(),
      includeYielding: true
    });

    expect(result.point).toEqual({ xMm: 800, yMm: 1150 }); // x clamped, y unchanged
  });
});
