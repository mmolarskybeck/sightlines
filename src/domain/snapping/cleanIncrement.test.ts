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
    const wallLengthMm = 3000;
    const halfWidthMm = 150;
    const result = quantizeXToCleanIncrement(
      { xMm: 2598, yMm: 1500 },
      { widthMm: 300, heightMm: 400 },
      INCH,
      wallLengthMm,
      []
    );
    expect(wallLengthMm - (result + halfWidthMm)).toBeCloseTo(10 * INCH, 6);
  });

  it("lands a clean gap to the nearest left neighbour (family c)", () => {
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
    const result = quantizeYToCleanIncrement(
      { xMm: 0, yMm: 1449 },
      { widthMm: 300, heightMm: 405 }, // half 202.5, bottom family off-lattice
      INCH
    );
    expect(result).toBeCloseTo(57 * INCH, 6);
  });

  it("lands the bottom edge on a whole increment from the floor when nearer", () => {
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
  // A nudge on a single-lattice setup must make meaningful progress in its direction.
  const incrementMm = INCH;

  it("advances x monotonically (single-lattice config, no neighbours)", () => {
    const widthMm = 300;
    // Make both horizontal families share one lattice.
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
    // Make center and bottom families share one lattice.
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
