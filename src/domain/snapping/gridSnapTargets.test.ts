import { describe, expect, it } from "vitest";
import { getGridSnapTargets } from "./gridSnapTargets";
import { resolveSnap } from "./resolveSnap";

describe("getGridSnapTargets", () => {
  it("generates one x-axis target per vertical line and one y-axis target per horizontal line", () => {
    const targets = getGridSnapTargets(100, {
      minXMm: 0,
      maxXMm: 250,
      minYMm: 0,
      maxYMm: 150
    });

    const xTargets = targets.filter((target) => target.axis === "x");
    const yTargets = targets.filter((target) => target.axis === "y");

    expect(xTargets.map((target) => target.point.xMm)).toEqual([0, 100, 200]);
    expect(yTargets.map((target) => target.point.yMm)).toEqual([0, 100]);
    expect(targets.every((target) => target.kind === "grid")).toBe(true);
  });

  it("only includes lines that actually fall within the visible bounds", () => {
    const targets = getGridSnapTargets(100, {
      minXMm: 120,
      maxXMm: 280,
      minYMm: 0,
      maxYMm: 0
    });
    const xValues = targets.filter((t) => t.axis === "x").map((t) => t.point.xMm);

    expect(xValues).toEqual([200]);
  });

  it("produces stable, distinct ids so hysteresis can track a target across calls", () => {
    const first = getGridSnapTargets(100, {
      minXMm: 0,
      maxXMm: 100,
      minYMm: 0,
      maxYMm: 0
    });
    const second = getGridSnapTargets(100, {
      minXMm: 0,
      maxXMm: 100,
      minYMm: 0,
      maxYMm: 0
    });

    expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
    expect(new Set(first.map((t) => t.id)).size).toBe(first.length);
  });

  it("returns nothing for a non-positive interval or an inverted/empty range", () => {
    expect(getGridSnapTargets(0, { minXMm: 0, maxXMm: 100, minYMm: 0, maxYMm: 100 })).toEqual([]);
    expect(
      getGridSnapTargets(-50, { minXMm: 0, maxXMm: 100, minYMm: 0, maxYMm: 100 })
    ).toEqual([]);
    expect(
      getGridSnapTargets(10, { minXMm: 100, maxXMm: 0, minYMm: 0, maxYMm: 100 }).filter(
        (t) => t.axis === "x"
      )
    ).toEqual([]);
  });

  it("caps the number of generated lines per axis for a degenerate huge-range/tiny-interval call", () => {
    const targets = getGridSnapTargets(1, {
      minXMm: 0,
      maxXMm: 1_000_000,
      minYMm: 0,
      maxYMm: 0
    });

    expect(targets.filter((t) => t.axis === "x").length).toBeLessThanOrEqual(1000);
  });

  it("plugs directly into resolveSnap as a lowest-priority candidate set", () => {
    const gridTargets = getGridSnapTargets(100, {
      minXMm: 0,
      maxXMm: 300,
      minYMm: 0,
      maxYMm: 300
    });

    const result = resolveSnap({ xMm: 203, yMm: 5 }, gridTargets, { thresholdMm: 10 });

    expect(result.point.xMm).toBeCloseTo(200);
    expect(result.snapTargetId).toBe("grid-x-200");
  });
});
