import { describe, expect, it } from "vitest";
import { feetToMm, inchesToMm, mToMm } from "./length";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm,
  getPixelsPerMm
} from "./precision";

describe("getMinorGridIntervalMm", () => {
  it("picks the imperial interval whose on-screen spacing clears the target", () => {
    // 1 inch at 2px/mm is 50.8px on screen — already above the 32px
    // target, so the finest imperial interval should be usable as-is.
    expect(getMinorGridIntervalMm("ft", 2)).toBeCloseTo(inchesToMm(1));
  });

  it("steps up to a coarser interval once zoomed out", () => {
    // At 0.128 px/mm, the target 32px spacing lands on 250mm — too fine
    // for 6" (152.4mm) but covered by 1' (304.8mm), so the table should
    // step up to the next interval that actually clears the target.
    const interval = getMinorGridIntervalMm("ft", 0.128);

    expect(interval).toBeCloseTo(feetToMm(1));
  });

  it("falls back to the coarsest interval when even the largest is too fine", () => {
    expect(getMinorGridIntervalMm("m", 0.0001)).toBeCloseTo(mToMm(2));
  });

  it("falls back to the finest interval when pixelsPerMm is not yet known", () => {
    expect(getMinorGridIntervalMm("cm", 0)).toBeCloseTo(10);
    expect(getMinorGridIntervalMm("cm", Number.NaN)).toBeCloseTo(10);
  });

  it("uses the metric table for cm and m, independent of relabeling imperial", () => {
    const metricInterval = getMinorGridIntervalMm("cm", 0.05);
    expect(metricInterval).toBeCloseTo(mToMm(1));
  });
});

describe("getMajorGridIntervalMm", () => {
  it("steps to a readable multi-inch landmark above a fine imperial minor", () => {
    expect(getMajorGridIntervalMm("ft", inchesToMm(1))).toBeCloseTo(inchesToMm(6));
  });

  it("falls back to a 5x multiple once the minor interval is already the coarsest", () => {
    expect(getMajorGridIntervalMm("ft", feetToMm(10))).toBeCloseTo(feetToMm(50));
  });

  it("steps to the next metric landmark above a fine metric minor", () => {
    expect(getMajorGridIntervalMm("cm", 10)).toBeCloseTo(50);
  });
});

describe("getPixelsPerMm", () => {
  it("uses the more constrained axis, matching SVG xMidYMid meet scaling", () => {
    const pixelsPerMm = getPixelsPerMm(
      { width: 800, height: 400 },
      { width: 4000, height: 1000 }
    );

    // Height is the limiting axis: 400px / 1000mm = 0.4 px/mm, versus
    // 800/4000 = 0.2 px/mm on width — the smaller of the two wins.
    expect(pixelsPerMm).toBeCloseTo(0.2);
  });

  it("returns 0 for an unmeasured container or degenerate viewBox", () => {
    expect(getPixelsPerMm({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(0);
    expect(getPixelsPerMm({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(0);
  });
});
