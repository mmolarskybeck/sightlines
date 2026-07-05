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
  it("picks the (1ft, 5ft) pair at a wide zoom with the shared default target (imperial)", () => {
    // At 0.05 px/mm the default 8px target maps to ~160mm on screen, too
    // fine for 6" (152.4mm) but cleared by 1' (304.8mm), so the ladder
    // settles on the (1ft, 5ft) pair.
    const minor = getMinorGridIntervalMm("ft", 0.05);
    expect(minor).toBeCloseTo(feetToMm(1));
    expect(getMajorGridIntervalMm("ft", minor)).toBeCloseTo(feetToMm(5));
  });

  it("picks the (3in, 1ft) pair at a close zoom with the shared default target (imperial)", () => {
    // At 0.13 px/mm the default 8px target maps to ~62mm, too fine for
    // 1" (25.4mm) but cleared by 3" (76.2mm).
    const minor = getMinorGridIntervalMm("ft", 0.13);
    expect(minor).toBeCloseTo(inchesToMm(3));
    expect(getMajorGridIntervalMm("ft", minor)).toBeCloseTo(feetToMm(1));
  });

  it("picks the (20cm, 1m) pair at a wide zoom with the shared default target (metric)", () => {
    // Same ~160mm target: too fine for 10cm, cleared by 20cm.
    const minor = getMinorGridIntervalMm("cm", 0.05);
    expect(minor).toBeCloseTo(cmToMm(20));
    expect(getMajorGridIntervalMm("cm", minor)).toBeCloseTo(mToMm(1));
  });

  it("picks the (10cm, 1m) pair at a close zoom with the shared default target (metric)", () => {
    // Same ~62mm target: too fine for 5cm (50mm), cleared by 10cm (100mm).
    // The metric ladder's 50->100mm gap means this lands one step coarser
    // than the imperial 3" analogue rather than on 5cm.
    const minor = getMinorGridIntervalMm("cm", 0.13);
    expect(minor).toBeCloseTo(cmToMm(10));
    expect(getMajorGridIntervalMm("cm", minor)).toBeCloseTo(mToMm(1));
  });

  describe("with the per-view targets at measured real-world scales", () => {
    // The default 28ft x ~18ft room measures pixelsPerMm ~= 0.0677 in plan
    // and ~= 0.0774 in elevation — nearly identical — so the views tell the
    // ladder apart by target px, not by zoom: PlanView passes 12 (layout is
    // a whole-feet activity), ElevationView passes 7 (hang heights read in
    // inches/centimeters).
    const PLAN_PX_PER_MM = 0.0677;
    const ELEVATION_PX_PER_MM = 0.0774;

    it("plan target (12px) selects (1ft, 5ft) at the measured plan scale (imperial)", () => {
      // 12 / 0.0677 ~= 177mm: too fine for 6" (152.4mm), cleared by 1'.
      const minor = getMinorGridIntervalMm("ft", PLAN_PX_PER_MM, { targetMinorPx: 12 });
      expect(minor).toBeCloseTo(feetToMm(1));
      expect(getMajorGridIntervalMm("ft", minor)).toBeCloseTo(feetToMm(5));
    });

    it("plan target (12px) selects (20cm, 1m) at the measured plan scale (metric)", () => {
      // Same ~177mm: too fine for 10cm, cleared by 20cm.
      const minor = getMinorGridIntervalMm("cm", PLAN_PX_PER_MM, { targetMinorPx: 12 });
      expect(minor).toBeCloseTo(cmToMm(20));
      expect(getMajorGridIntervalMm("cm", minor)).toBeCloseTo(mToMm(1));
    });

    it("elevation target (7px) selects (6in, 2ft) at the measured elevation scale (imperial)", () => {
      // 7 / 0.0774 ~= 90mm: too fine for 3" (76.2mm), cleared by 6" (152.4mm).
      const minor = getMinorGridIntervalMm("ft", ELEVATION_PX_PER_MM, { targetMinorPx: 7 });
      expect(minor).toBeCloseTo(inchesToMm(6));
      expect(getMajorGridIntervalMm("ft", minor)).toBeCloseTo(feetToMm(2));
    });

    it("elevation target (7px) selects (10cm, 1m) at the measured elevation scale (metric)", () => {
      // Same ~90mm: too fine for 5cm (50mm), cleared by 10cm (100mm).
      const minor = getMinorGridIntervalMm("cm", ELEVATION_PX_PER_MM, { targetMinorPx: 7 });
      expect(minor).toBeCloseTo(cmToMm(10));
      expect(getMajorGridIntervalMm("cm", minor)).toBeCloseTo(mToMm(1));
    });
  });

  it("uses the metric ladder for cm and m alike, independent of the imperial one", () => {
    // Both metric sub-units key off the same ladder, so they resolve
    // identically at the same zoom (here the 20cm plan-view rung).
    expect(getMinorGridIntervalMm("m", 0.05)).toBeCloseTo(cmToMm(20));
    expect(getMinorGridIntervalMm("m", 0.05)).toBeCloseTo(getMinorGridIntervalMm("cm", 0.05));
  });

  it("falls back to the coarsest pair when even its minor is too fine (zoomed way out)", () => {
    expect(getMinorGridIntervalMm("m", 0.0001)).toBeCloseTo(mToMm(1));
    expect(getMinorGridIntervalMm("ft", 0.0001)).toBeCloseTo(feetToMm(5));
  });

  it("falls back to the finest pair when pixelsPerMm is not yet known", () => {
    // Finest metric minor is 0.5cm (5mm); finest imperial minor is 0.5in.
    expect(getMinorGridIntervalMm("cm", 0)).toBeCloseTo(cmToMm(0.5));
    expect(getMinorGridIntervalMm("cm", Number.NaN)).toBeCloseTo(cmToMm(0.5));
    expect(getMinorGridIntervalMm("ft", 0)).toBeCloseTo(inchesToMm(0.5));
  });

  it("selects the finest pair once zoomed in close enough", () => {
    // 0.5" at 100px/mm is 1270px between dots, far above the 8px target, so
    // the finest imperial pair wins.
    const minor = getMinorGridIntervalMm("ft", 100);
    expect(minor).toBeCloseTo(inchesToMm(0.5));
    expect(getMajorGridIntervalMm("ft", minor)).toBeCloseTo(inchesToMm(6));
  });

  describe("with a precision floor", () => {
    it("clamps a zoomed-in interval up to the floor when zoom would go finer", () => {
      // Zoomed in enough that 0.5" would otherwise win, but a 1" floor means
      // the user works no finer than that.
      const interval = getMinorGridIntervalMm("ft", 100, { minIntervalMm: inchesToMm(1) });
      expect(interval).toBeCloseTo(inchesToMm(1));
    });

    it("clamps up to the finest ladder minor at or above the floor, not the floor itself", () => {
      // A floor of 15mm doesn't land on a metric ladder minor — the finest
      // minor that still respects it is 20mm (2cm), not 15mm.
      const interval = getMinorGridIntervalMm("cm", 100, { minIntervalMm: 15 });
      expect(interval).toBeCloseTo(cmToMm(2));
    });

    it("leaves the zoom-driven interval untouched once it's already at or coarser than the floor", () => {
      // Zoomed to a 3" minor already; a 1" floor is finer than that, so it has
      // no effect here.
      const interval = getMinorGridIntervalMm("ft", 0.13, { minIntervalMm: inchesToMm(1) });
      expect(interval).toBeCloseTo(inchesToMm(3));
    });

    it("falls back to the coarsest ladder minor when the floor is coarser than every rung", () => {
      const interval = getMinorGridIntervalMm("ft", 100, { minIntervalMm: feetToMm(20) });
      expect(interval).toBeCloseTo(feetToMm(5));
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
        minIntervalMm: inchesToMm(1)
      });
      // 2px/mm with a 16px target maps to an 8mm minor; the finest ladder
      // minor clearing that is 0.5" (12.7mm), but the 1" floor bumps it up.
      expect(interval).toBeCloseTo(inchesToMm(1));
    });

    it("looks up a sane major for a minor produced by floor-clamping to a ladder rung", () => {
      // The 15mm floor above clamps to the 2cm rung; its paired major is 20cm.
      const minor = getMinorGridIntervalMm("cm", 100, { minIntervalMm: 15 });
      expect(getMajorGridIntervalMm("cm", minor)).toBeCloseTo(cmToMm(20));
    });
  });
});

describe("getGridPrecisionFloorOptionsMm", () => {
  it("offers curated imperial floor choices as exact ladder minors", () => {
    const options = getGridPrecisionFloorOptionsMm("ft");
    expect(options).toEqual([inchesToMm(0.5), inchesToMm(1), inchesToMm(6), feetToMm(1)]);
  });

  it("offers curated metric floor choices as exact ladder minors", () => {
    const options = getGridPrecisionFloorOptionsMm("cm");
    expect(options).toEqual([cmToMm(0.5), cmToMm(1), cmToMm(10)]);
  });

  it("keys off the metric/imperial family, not the exact sub-unit", () => {
    expect(getGridPrecisionFloorOptionsMm("in")).toEqual(getGridPrecisionFloorOptionsMm("ft"));
    expect(getGridPrecisionFloorOptionsMm("m")).toEqual(getGridPrecisionFloorOptionsMm("cm"));
  });

  it("only offers floor values that are real ladder minors (majors exist for each)", () => {
    for (const unit of ["ft", "cm"] as const) {
      for (const optionMm of getGridPrecisionFloorOptionsMm(unit)) {
        // A floor value always feeds getMinorGridIntervalMm; a zoomed-in call
        // must resolve to exactly that value (it's a real ladder minor)...
        const minor = getMinorGridIntervalMm(unit, 100, { minIntervalMm: optionMm });
        expect(minor).toBeCloseTo(optionMm);
        // ...and carry a paired major that's a clean integer multiple of it,
        // so the floor never lands on the off-ladder 5x fallback path.
        const ratio = getMajorGridIntervalMm(unit, minor) / minor;
        expect(ratio).toBeCloseTo(Math.round(ratio));
        expect(ratio).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe("getMajorGridIntervalMm", () => {
  it("returns the round major paired with a fine imperial minor", () => {
    expect(getMajorGridIntervalMm("ft", inchesToMm(1))).toBeCloseTo(inchesToMm(6));
    expect(getMajorGridIntervalMm("ft", feetToMm(1))).toBeCloseTo(feetToMm(5));
  });

  it("returns the round major paired with a metric minor", () => {
    expect(getMajorGridIntervalMm("cm", cmToMm(10))).toBeCloseTo(mToMm(1));
    expect(getMajorGridIntervalMm("cm", cmToMm(2))).toBeCloseTo(cmToMm(20));
  });

  it("falls back to a 5x multiple when the minor isn't a ladder rung", () => {
    // 10' is not a ladder minor (the coarsest imperial minor is 5'), so there
    // is no paired major to look up.
    expect(getMajorGridIntervalMm("ft", feetToMm(10))).toBeCloseTo(feetToMm(50));
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
