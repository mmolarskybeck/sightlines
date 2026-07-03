import { describe, expect, it } from "vitest";
import { cmToMm, feetToMm, inchesToMm, mToMm } from "./length";
import {
  getGridPatternPhaseMm,
  getGridPrecisionFloorOptionsMm,
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
    // Finest metric entry is now 0.5cm (5mm) since precision.ts added a
    // sub-centimeter entry for close-in elevation work.
    expect(getMinorGridIntervalMm("cm", 0)).toBeCloseTo(5);
    expect(getMinorGridIntervalMm("cm", Number.NaN)).toBeCloseTo(5);
  });

  it("uses the metric table for cm and m, independent of relabeling imperial", () => {
    const metricInterval = getMinorGridIntervalMm("cm", 0.05);
    expect(metricInterval).toBeCloseTo(mToMm(1));
  });

  it("selects the finer sub-unit entries once zoomed in close enough", () => {
    // 0.5" at 100px/mm is 1270px on screen, comfortably above the 32px
    // target, so the newly added finest imperial entry should win.
    expect(getMinorGridIntervalMm("ft", 100)).toBeCloseTo(inchesToMm(0.5));

    // 0.5cm at 100px/mm is 500px on screen, likewise above target, so the
    // newly added finest metric entry should win.
    expect(getMinorGridIntervalMm("cm", 100)).toBeCloseTo(cmToMm(0.5));
  });

  describe("with a precision floor", () => {
    it("clamps a zoomed-in interval up to the floor when zoom would go finer", () => {
      // Zoomed in enough that 0.5" would otherwise win (see above), but a
      // 1" floor means the user works no finer than that.
      const interval = getMinorGridIntervalMm("ft", 100, { minIntervalMm: inchesToMm(1) });
      expect(interval).toBeCloseTo(inchesToMm(1));
    });

    it("clamps up to the smallest table entry at or above the floor, not the floor itself", () => {
      // A floor of 3mm doesn't land exactly on a metric table entry — the
      // smallest entry that still respects it is 5mm (0.5cm), not 3mm.
      const interval = getMinorGridIntervalMm("cm", 100, { minIntervalMm: 3 });
      expect(interval).toBeCloseTo(cmToMm(0.5));
    });

    it("leaves the zoom-driven interval untouched once it's already at or coarser than the floor", () => {
      // Zoomed out to 1' already; a 1" floor is finer than that, so it has
      // no effect here.
      const interval = getMinorGridIntervalMm("ft", 0.128, { minIntervalMm: inchesToMm(1) });
      expect(interval).toBeCloseTo(feetToMm(1));
    });

    it("falls back to the coarsest table entry when the floor itself is coarser than every entry", () => {
      const interval = getMinorGridIntervalMm("ft", 100, { minIntervalMm: feetToMm(20) });
      expect(interval).toBeCloseTo(feetToMm(10));
    });

    it("treats a non-finite, zero, or negative floor as no floor — current unfloored behavior", () => {
      const unfloored = getMinorGridIntervalMm("ft", 100);
      expect(getMinorGridIntervalMm("ft", 100, { minIntervalMm: 0 })).toBeCloseTo(unfloored);
      expect(getMinorGridIntervalMm("ft", 100, { minIntervalMm: -5 })).toBeCloseTo(unfloored);
      expect(
        getMinorGridIntervalMm("ft", 100, { minIntervalMm: Number.NaN })
      ).toBeCloseTo(unfloored);
      expect(
        getMinorGridIntervalMm("ft", 100, { minIntervalMm: Number.POSITIVE_INFINITY })
      ).toBeCloseTo(unfloored);
      expect(getMinorGridIntervalMm("ft", 100, { minIntervalMm: null })).toBeCloseTo(unfloored);
    });

    it("still respects a custom targetMinorPx alongside a floor", () => {
      const interval = getMinorGridIntervalMm("ft", 2, {
        targetMinorPx: 16,
        minIntervalMm: inchesToMm(2)
      });
      expect(interval).toBeCloseTo(inchesToMm(2));
    });
  });
});

describe("getGridPrecisionFloorOptionsMm", () => {
  it("offers curated imperial floor choices as exact grid-table values", () => {
    const options = getGridPrecisionFloorOptionsMm("ft");
    expect(options).toEqual([inchesToMm(0.5), inchesToMm(1), inchesToMm(6), feetToMm(1)]);
  });

  it("offers curated metric floor choices as exact grid-table values", () => {
    const options = getGridPrecisionFloorOptionsMm("cm");
    expect(options).toEqual([cmToMm(0.5), cmToMm(1), cmToMm(10)]);
  });

  it("keys off the metric/imperial family, not the exact sub-unit", () => {
    expect(getGridPrecisionFloorOptionsMm("in")).toEqual(getGridPrecisionFloorOptionsMm("ft"));
    expect(getGridPrecisionFloorOptionsMm("m")).toEqual(getGridPrecisionFloorOptionsMm("cm"));
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

describe("getGridPatternPhaseMm", () => {
  it("returns 0 when the anchor already falls on the coordinate-space origin", () => {
    expect(getGridPatternPhaseMm(0, 100)).toBe(0);
  });

  it("reduces an anchor past a tile boundary to its in-tile remainder", () => {
    // A wall-height anchor of 2700mm against a 500mm interval: the pattern
    // only needs to be shifted by the leftover 200mm, since any whole
    // number of tiles is an anchoring no-op.
    expect(getGridPatternPhaseMm(2700, 500)).toBeCloseTo(200);
  });

  it("wraps a negative anchor into the positive [0, spacing) range", () => {
    // JS `%` keeps the sign of the dividend, so a naive `% spacing` on a
    // negative anchor would return a negative pattern offset — SVG accepts
    // that, but it points the phase the wrong way, off by one full tile.
    expect(getGridPatternPhaseMm(-100, 300)).toBeCloseTo(200);
  });

  it("is a no-op for an anchor that is an exact multiple of the spacing", () => {
    expect(getGridPatternPhaseMm(1000, 250)).toBe(0);
  });

  it("falls back to 0 for a non-finite anchor or non-positive spacing", () => {
    expect(getGridPatternPhaseMm(Number.NaN, 100)).toBe(0);
    expect(getGridPatternPhaseMm(100, 0)).toBe(0);
    expect(getGridPatternPhaseMm(100, -50)).toBe(0);
  });
});
