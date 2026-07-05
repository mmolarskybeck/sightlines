import { describe, expect, it } from "vitest";
import { resolveSnap, type SnapTarget } from "./resolveSnap";

const centerline: SnapTarget = {
  id: "centerline",
  kind: "centerline",
  axis: "y",
  point: { xMm: 0, yMm: 1448 }
};

describe("resolveSnap", () => {
  it("snaps both axes at once: y to the centerline AND x to a grid line", () => {
    // The headline elevation scenario: an artwork held on the eyeline must
    // still land on the grid in x — the y-only centerline winning its axis
    // must not suppress the x-axis grid snap.
    const result = resolveSnap(
      { xMm: 98, yMm: 1450 },
      [
        { id: "grid-x-100", kind: "grid", axis: "x", point: { xMm: 100, yMm: 0 } },
        centerline
      ],
      { thresholdMm: 10 }
    );

    expect(result.point).toEqual({ xMm: 100, yMm: 1448 });
    expect(result.snapTargetIds).toEqual({ x: "grid-x-100", y: "centerline" });
    expect(result.activeGuides).toHaveLength(2);
    expect(result.activeGuides.map((guide) => guide.axis).sort()).toEqual(["x", "y"]);
  });

  it("lets an explicit priority: 0 floor target outrank the centerline (door case)", () => {
    const result = resolveSnap(
      { xMm: 500, yMm: 1449 },
      [
        centerline,
        // 2mm farther away than the centerline (1mm), but the explicit
        // priority override makes floor the primary tier — a door held near
        // both must land on the floor.
        { id: "floor", kind: "floor", axis: "y", priority: 0, point: { xMm: 0, yMm: 1451 } }
      ],
      { thresholdMm: 10 }
    );

    expect(result.point.yMm).toBe(1451);
    expect(result.snapTargetIds).toEqual({ y: "floor" });
  });

  it("ranks a default floor target below the centerline but above neighbor-center", () => {
    const targets: SnapTarget[] = [
      centerline,
      { id: "floor", kind: "floor", axis: "y", point: { xMm: 0, yMm: 1451 } },
      {
        id: "neighbor-center:n1:y",
        kind: "neighbor-center",
        axis: "y",
        point: { xMm: 0, yMm: 1452 }
      }
    ];

    // Centerline in range: it beats the (closer) default-rank floor.
    const nearCenterline = resolveSnap({ xMm: 500, yMm: 1450 }, targets, { thresholdMm: 10 });
    expect(nearCenterline.snapTargetIds).toEqual({ y: "centerline" });

    // Centerline out of the pool: floor beats the (closer) neighbor-center.
    const nearFloor = resolveSnap(
      { xMm: 500, yMm: 1453 },
      targets.filter((target) => target.id !== "centerline"),
      { thresholdMm: 10 }
    );
    expect(nearFloor.snapTargetIds).toEqual({ y: "floor" });
  });

  it("keeps tier priority within an axis: centerline beats a closer grid target on y", () => {
    const result = resolveSnap(
      { xMm: 500, yMm: 1450 },
      [
        // 1mm away, but grid is the lowest tier — the 2mm-away centerline
        // still wins the y axis.
        { id: "grid-y-1451", kind: "grid", axis: "y", point: { xMm: 0, yMm: 1451 } },
        centerline
      ],
      { thresholdMm: 10 }
    );

    expect(result.point.yMm).toBe(1448);
    expect(result.snapTargetIds).toEqual({ y: "centerline" });
  });

  it("returns the proposed point, no guides, and empty ids when nothing is in range", () => {
    const result = resolveSnap(
      { xMm: 500, yMm: 500 },
      [centerline, { id: "grid-x-100", kind: "grid", axis: "x", point: { xMm: 100, yMm: 0 } }],
      { thresholdMm: 10 }
    );

    expect(result.point).toEqual({ xMm: 500, yMm: 500 });
    expect(result.activeGuides).toEqual([]);
    expect(result.snapTargetIds).toEqual({});
  });

  it("evaluates an axis:'both' target per axis, using that axis's own delta", () => {
    // 8mm off in x (in range), 30mm off in y (out of range): a "both" target
    // may win x alone — the old hypot distance would have disqualified it
    // from both axes entirely.
    const result = resolveSnap(
      { xMm: 108, yMm: 230 },
      [{ id: "corner", kind: "neighbor-edge", axis: "both", point: { xMm: 100, yMm: 200 } }],
      { thresholdMm: 10 }
    );

    expect(result.point).toEqual({ xMm: 100, yMm: 230 });
    expect(result.snapTargetIds).toEqual({ x: "corner" });
  });

  describe("per-axis hysteresis", () => {
    const gridX: SnapTarget = { id: "grid-x-0", kind: "grid", axis: "x", point: { xMm: 0, yMm: 0 } };

    it("applies the break-free multiplier to the axis whose previous id matches", () => {
      // 18mm exceeds the plain 10mm threshold but not the 2x break-free
      // threshold for the target x previously snapped to.
      const result = resolveSnap({ xMm: 18, yMm: 500 }, [gridX], {
        thresholdMm: 10,
        breakFreeMultiplier: 2,
        previousSnapTargetIds: { x: "grid-x-0" }
      });

      expect(result.snapTargetIds).toEqual({ x: "grid-x-0" });
      expect(result.point.xMm).toBe(0);
    });

    it("does not let one axis's previous id widen another axis's threshold", () => {
      // The same id remembered under y must not grant the x candidate the
      // break-free allowance — hysteresis is tracked per axis.
      const result = resolveSnap({ xMm: 18, yMm: 500 }, [gridX], {
        thresholdMm: 10,
        breakFreeMultiplier: 2,
        previousSnapTargetIds: { y: "grid-x-0" }
      });

      expect(result.snapTargetIds).toEqual({});
      expect(result.point.xMm).toBe(18);
    });

    it("tracks each axis's stickiness independently in the same resolve", () => {
      // x is 13mm from its previous grid line (inside 1.5x break-free), y is
      // 13mm from a centerline it was NOT previously snapped to (outside the
      // plain threshold) — x holds, y releases.
      const result = resolveSnap(
        { xMm: 13, yMm: 1461 },
        [gridX, centerline],
        { thresholdMm: 10, previousSnapTargetIds: { x: "grid-x-0" } }
      );

      expect(result.snapTargetIds).toEqual({ x: "grid-x-0" });
      expect(result.point).toEqual({ xMm: 0, yMm: 1461 });
    });
  });
});
