import { describe, expect, it } from "vitest";
import {
  isPointInPolygon,
  isSimplePolygon,
  segmentsIntersect,
  signedAreaMm2
} from "./polygon";

const at = (xMm: number, yMm: number) => ({ xMm, yMm });

describe("segmentsIntersect", () => {
  it("detects a proper crossing", () => {
    expect(segmentsIntersect(at(0, 0), at(10, 10), at(0, 10), at(10, 0))).toBe(true);
  });

  it("returns false for disjoint segments", () => {
    expect(segmentsIntersect(at(0, 0), at(10, 0), at(0, 5), at(10, 5))).toBe(false);
  });

  it("counts a shared endpoint (touching) as intersection", () => {
    expect(segmentsIntersect(at(0, 0), at(10, 0), at(10, 0), at(10, 10))).toBe(true);
  });

  it("counts a T-junction (endpoint on the other segment) as intersection", () => {
    expect(segmentsIntersect(at(0, 0), at(10, 0), at(5, 0), at(5, 10))).toBe(true);
  });

  it("detects a collinear overlap", () => {
    expect(segmentsIntersect(at(0, 0), at(10, 0), at(5, 0), at(15, 0))).toBe(true);
  });

  it("returns false for collinear but disjoint segments", () => {
    expect(segmentsIntersect(at(0, 0), at(10, 0), at(20, 0), at(30, 0))).toBe(false);
  });

  it("returns false for parallel non-collinear segments", () => {
    expect(segmentsIntersect(at(0, 0), at(10, 0), at(0, 1), at(10, 1))).toBe(false);
  });
});

describe("isSimplePolygon", () => {
  it("accepts a rectangle", () => {
    expect(
      isSimplePolygon([at(0, 0), at(10, 0), at(10, 10), at(0, 10)])
    ).toBe(true);
  });

  it("accepts an L-shape", () => {
    expect(
      isSimplePolygon([
        at(0, 0),
        at(20, 0),
        at(20, 10),
        at(10, 10),
        at(10, 20),
        at(0, 20)
      ])
    ).toBe(true);
  });

  it("rejects a self-crossing bowtie", () => {
    expect(
      isSimplePolygon([at(0, 0), at(10, 10), at(10, 0), at(0, 10)])
    ).toBe(false);
  });

  it("rejects fewer than three points", () => {
    expect(isSimplePolygon([at(0, 0), at(10, 0)])).toBe(false);
  });

  it("allows a redundant collinear vertex (straight through)", () => {
    // Three collinear points along the top edge — a wasteful vertex, but the
    // polygon is still simple, not self-intersecting.
    expect(
      isSimplePolygon([at(0, 0), at(5, 0), at(10, 0), at(10, 10), at(0, 10)])
    ).toBe(true);
  });

  it("rejects a collinear backtrack (spike) between adjacent edges", () => {
    // From (10,0) the edge doubles straight back onto the previous edge.
    expect(
      isSimplePolygon([at(0, 0), at(10, 0), at(5, 0), at(5, 10)])
    ).toBe(false);
  });

  it("rejects a polygon whose edge passes through a far vertex", () => {
    expect(
      isSimplePolygon([at(0, 0), at(10, 0), at(20, 0), at(10, 0)])
    ).toBe(false);
  });
});

describe("signedAreaMm2", () => {
  it("is positive for a counter-clockwise square, equal to its area", () => {
    const ccwSquare = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)];
    expect(signedAreaMm2(ccwSquare)).toBe(100);
  });

  it("is negative (same magnitude) for the same square wound clockwise", () => {
    const cwSquare = [at(0, 0), at(0, 10), at(10, 10), at(10, 0)];
    expect(signedAreaMm2(cwSquare)).toBe(-100);
  });

  it("is zero for collinear points", () => {
    expect(signedAreaMm2([at(0, 0), at(5, 0), at(10, 0)])).toBe(0);
  });

  it("is zero for duplicate/coincident points", () => {
    expect(signedAreaMm2([at(3, 3), at(3, 3), at(3, 3)])).toBe(0);
  });
});

describe("isPointInPolygon", () => {
  const square = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)];

  it("is true for an interior point", () => {
    expect(isPointInPolygon(at(5, 5), square)).toBe(true);
  });

  it("is false for an exterior point", () => {
    expect(isPointInPolygon(at(15, 5), square)).toBe(false);
  });

  it("reads the notch of an L-shape as outside", () => {
    const lShape = [
      at(0, 0),
      at(20, 0),
      at(20, 10),
      at(10, 10),
      at(10, 20),
      at(0, 20)
    ];
    // The concave notch (top-right quadrant of the bounding box) is outside.
    expect(isPointInPolygon(at(15, 15), lShape)).toBe(false);
    expect(isPointInPolygon(at(5, 15), lShape)).toBe(true);
  });
});
