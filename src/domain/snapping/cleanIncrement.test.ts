import { describe, expect, it } from "vitest";
import type { WallObjectBase } from "../project";
import {
  quantizeXToCleanIncrement,
  quantizeYToCleanIncrement
} from "./cleanIncrement";

const INCH = 25.4;

function neighbor(overrides: Partial<WallObjectBase> = {}): WallObjectBase {
  return {
    id: "neighbor-1",
    kind: "artwork",
    wallId: "wall-1",
    xMm: 1000,
    yMm: 1500,
    widthMm: 400,
    heightMm: 600,
    ...overrides
  } as WallObjectBase;
}

describe("quantizeXToCleanIncrement", () => {
  it("lands the left edge on a whole increment from the wall start (family a)", () => {
    // width 300 → half 150. Proposed center 452 → left edge 302. Nearest clean
    // left-edge distance is 12·25.4 = 304.8 → center 454.8. No neighbours, and
    // the wall end is far away so family (a) wins.
    const result = quantizeXToCleanIncrement(
      { xMm: 452, yMm: 1500 },
      { widthMm: 300, heightMm: 400 },
      INCH,
      100000,
      []
    );
    expect(result - 150).toBeCloseTo(12 * INCH, 6); // left edge = 12 inches
  });

  it("lands the right edge on a whole increment from the wall end (family b)", () => {
    // wallLength 3000, half-width 150. A clean right-edge-from-wall-end of 10
    // inches puts the center at 2596; the left-edge family's nearest there is
    // ~7.6mm off, so a proposal 2mm from the clean center lets family (b) win.
    const wallLengthMm = 3000;
    const halfWidthMm = 150;
    const result = quantizeXToCleanIncrement(
      { xMm: 2598, yMm: 1500 },
      { widthMm: 300, heightMm: 400 },
      INCH,
      wallLengthMm,
      []
    );
    // right-edge distance from wall end is a clean 10 inches
    expect(wallLengthMm - (result + halfWidthMm)).toBeCloseTo(10 * INCH, 6);
  });

  it("lands a clean gap to the nearest left neighbour (family c)", () => {
    // Neighbour right edge at 1200. Moving width 300 (half 150). A center just
    // right of a clean 2-inch gap should snap the left-edge gap to 2 inches.
    const n = neighbor({ xMm: 1000, widthMm: 400 }); // right edge 1200
    const cleanCenter = 1200 + 2 * INCH + 150; // gap exactly 2 inches
    const result = quantizeXToCleanIncrement(
      { xMm: cleanCenter + 4, yMm: 1500 },
      { widthMm: 300, heightMm: 400 },
      INCH,
      100000,
      [n]
    );
    const leftEdge = result - 150;
    expect(leftEdge - 1200).toBeCloseTo(2 * INCH, 6);
  });

  it("lands a clean gap to the nearest right neighbour (family d)", () => {
    // Neighbour left edge at 2000. Moving width 300 (half 150). A center just
    // left of a clean 3-inch gap should snap the right-edge gap to 3 inches.
    const n = neighbor({ id: "n-right", xMm: 2200, widthMm: 400 }); // left edge 2000
    const cleanCenter = 2000 - 3 * INCH - 150; // gap exactly 3 inches
    const result = quantizeXToCleanIncrement(
      { xMm: cleanCenter - 5, yMm: 1500 },
      { widthMm: 300, heightMm: 400 },
      INCH,
      100000,
      [n]
    );
    const rightEdge = result + 150;
    expect(2000 - rightEdge).toBeCloseTo(3 * INCH, 6);
  });

  it("picks the nearest candidate across competing families", () => {
    // A left neighbour offers a clean gap 1mm away; the wall-start family offers
    // one 8mm away. The nearer (neighbour) candidate must win.
    const n = neighbor({ xMm: 1000, widthMm: 400, heightMm: 600 }); // right edge 1200
    const halfWidthMm = 150;
    const nearGapCenter = 1200 + 1 * INCH + halfWidthMm; // 1-inch gap
    const proposed = nearGapCenter + 1; // 1mm from the neighbour candidate
    const result = quantizeXToCleanIncrement(
      { xMm: proposed, yMm: 1500 },
      { widthMm: 300, heightMm: 400 },
      INCH,
      100000,
      [n]
    );
    expect(Math.abs(result - nearGapCenter)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("ignores neighbours whose vertical band does not overlap the moving object", () => {
    // A neighbour far above the moving object (no y-band overlap) must not bound
    // a horizontal gap; only the wall families remain.
    const highNeighbor = neighbor({
      xMm: 1000,
      widthMm: 400,
      yMm: 4000, // band 3700..4300
      heightMm: 600
    });
    const withNeighbor = quantizeXToCleanIncrement(
      { xMm: 1600, yMm: 1500 }, // moving band 1300..1700, no overlap
      { widthMm: 300, heightMm: 400 },
      INCH,
      100000,
      [highNeighbor]
    );
    const withoutNeighbor = quantizeXToCleanIncrement(
      { xMm: 1600, yMm: 1500 },
      { widthMm: 300, heightMm: 400 },
      INCH,
      100000,
      []
    );
    expect(withNeighbor).toBeCloseTo(withoutNeighbor, 9);
  });

  it("honours a neighbour whose vertical band overlaps the moving object", () => {
    const overlappingNeighbor = neighbor({
      xMm: 1000,
      widthMm: 400,
      yMm: 1550, // band 1250..1850 overlaps moving band 1300..1700
      heightMm: 600
    });
    const cleanCenter = 1200 + 2 * INCH + 150;
    const result = quantizeXToCleanIncrement(
      { xMm: cleanCenter + 3, yMm: 1500 },
      { widthMm: 300, heightMm: 400 },
      INCH,
      100000,
      [overlappingNeighbor]
    );
    expect(result - 150 - 1200).toBeCloseTo(2 * INCH, 6);
  });

  it("returns the proposed x unchanged for a degenerate increment", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        quantizeXToCleanIncrement(
          { xMm: 733.13, yMm: 1500 },
          { widthMm: 300, heightMm: 400 },
          bad,
          100000,
          []
        )
      ).toBe(733.13);
    }
  });
});

describe("quantizeYToCleanIncrement", () => {
  it("lands the center height on a whole increment from the floor", () => {
    // Proposed center 1449 → nearest 57·25.4 = 1447.8. Bottom family is farther.
    const result = quantizeYToCleanIncrement(
      { xMm: 0, yMm: 1449 },
      { widthMm: 300, heightMm: 405 }, // half 202.5, bottom family off-lattice
      INCH
    );
    expect(result).toBeCloseTo(57 * INCH, 6);
  });

  it("lands the bottom edge on a whole increment from the floor when nearer", () => {
    // Half-height 12.7 puts the center exactly on a half-increment offset, so
    // the center family is a full 12.7mm away while the bottom edge sits ~2mm
    // from a clean 40-inch multiple — the bottom family wins.
    const heightMm = 25.4; // half 12.7
    const cleanBottomMm = 40 * INCH;
    const proposedYMm = cleanBottomMm + 12.7 + 2; // bottom 2mm from clean
    const result = quantizeYToCleanIncrement(
      { xMm: 0, yMm: proposedYMm },
      { widthMm: 300, heightMm },
      INCH
    );
    expect(result - 12.7).toBeCloseTo(cleanBottomMm, 6);
  });

  it("returns the proposed y unchanged for a degenerate increment", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(
        quantizeYToCleanIncrement({ xMm: 0, yMm: 913.7 }, { widthMm: 300, heightMm: 400 }, bad)
      ).toBe(913.7);
    }
  });
});

describe("nudge-progress invariant", () => {
  // For any position p and step s ≥ incrementMm, quantize(p + s) − quantize(p)
  // must share the sign of s and have magnitude ≥ s/2 — a nudge always makes
  // real progress in the travel direction. Verified on single-lattice configs
  // (where the property holds rigorously): x with the two wall families made to
  // coincide, and y with the two vertical families made to coincide.
  const incrementMm = INCH;

  it("advances x monotonically (single-lattice config, no neighbours)", () => {
    const widthMm = 300;
    // (wallLength − width) a whole number of increments → families a and b share
    // one lattice, so the quantizer behaves as a single round-to-nearest.
    const wallLengthMm = widthMm + 50 * incrementMm;
    const size = { widthMm, heightMm: 400 };
    for (const step of [incrementMm, 4 * incrementMm]) {
      for (let p = -200; p <= 1500; p += 3.7) {
        const before = quantizeXToCleanIncrement({ xMm: p, yMm: 1500 }, size, incrementMm, wallLengthMm, []);
        const after = quantizeXToCleanIncrement({ xMm: p + step, yMm: 1500 }, size, incrementMm, wallLengthMm, []);
        expect(after - before).toBeGreaterThanOrEqual(step / 2 - 1e-6);
      }
    }
  });

  it("advances x downward when stepping in the negative direction", () => {
    const widthMm = 300;
    const wallLengthMm = widthMm + 50 * incrementMm;
    const size = { widthMm, heightMm: 400 };
    const step = -4 * incrementMm;
    for (let p = -200; p <= 1500; p += 3.7) {
      const before = quantizeXToCleanIncrement({ xMm: p, yMm: 1500 }, size, incrementMm, wallLengthMm, []);
      const after = quantizeXToCleanIncrement({ xMm: p + step, yMm: 1500 }, size, incrementMm, wallLengthMm, []);
      expect(after - before).toBeLessThanOrEqual(step / 2 + 1e-6);
    }
  });

  it("advances y monotonically (single-lattice config)", () => {
    // Half-height a whole number of increments → center and bottom families
    // coincide into one lattice.
    const size = { widthMm: 300, heightMm: 4 * incrementMm };
    for (const step of [incrementMm, 4 * incrementMm]) {
      for (let p = -100; p <= 2000; p += 4.3) {
        const before = quantizeYToCleanIncrement({ xMm: 0, yMm: p }, size, incrementMm);
        const after = quantizeYToCleanIncrement({ xMm: 0, yMm: p + step }, size, incrementMm);
        expect(after - before).toBeGreaterThanOrEqual(step / 2 - 1e-6);
      }
    }
  });
});
