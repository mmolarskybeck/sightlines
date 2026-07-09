import { describe, expect, it } from "vitest";
import {
  add,
  cross,
  distance,
  dot,
  midpoint,
  normalize,
  scale,
  subtract,
  unitLeftNormal,
  unitLeftNormalOrZero,
  vectorLength,
  type Vector2
} from "./vector";

const p = (xMm: number, yMm: number): Vector2 => ({ xMm, yMm });

describe("add", () => {
  it.each([
    [p(1, 2), p(3, 4), p(4, 6)],
    [p(-1, 5), p(1, -5), p(0, 0)],
    [p(0, 0), p(0, 0), p(0, 0)]
  ])("add(%o, %o) = %o", (a, b, expected) => {
    expect(add(a, b)).toEqual(expected);
  });
});

describe("subtract", () => {
  it.each([
    [p(3, 4), p(1, 2), p(2, 2)],
    [p(0, 0), p(5, -5), p(-5, 5)],
    [p(2, 2), p(2, 2), p(0, 0)]
  ])("subtract(%o, %o) = %o", (a, b, expected) => {
    expect(subtract(a, b)).toEqual(expected);
  });
});

describe("scale", () => {
  it.each([
    [p(2, 3), 2, p(4, 6)],
    [p(2, 3), -1, p(-2, -3)],
    [p(2, 3), 0, p(0, 0)]
  ])("scale(%o, %d) = %o", (v, s, expected) => {
    expect(scale(v, s)).toEqual(expected);
  });
});

describe("vectorLength", () => {
  it.each([
    [p(3, 4), 5],
    [p(0, 0), 0],
    [p(-3, -4), 5]
  ])("vectorLength(%o) = %d", (v, expected) => {
    expect(vectorLength(v)).toBeCloseTo(expected);
  });
});

describe("distance", () => {
  it.each([
    [p(0, 0), p(3, 4), 5],
    [p(1, 1), p(1, 1), 0],
    [p(-2, 0), p(2, 0), 4]
  ])("distance(%o, %o) = %d", (a, b, expected) => {
    expect(distance(a, b)).toBeCloseTo(expected);
  });
});

describe("normalize", () => {
  it.each([
    [p(5, 0), p(1, 0)],
    [p(0, -5), p(0, -1)],
    [p(3, 4), p(0.6, 0.8)]
  ])("normalize(%o) = %o", (v, expected) => {
    const result = normalize(v);
    expect(result.xMm).toBeCloseTo(expected.xMm);
    expect(result.yMm).toBeCloseTo(expected.yMm);
  });

  it("throws on a zero-length vector", () => {
    expect(() => normalize(p(0, 0))).toThrow("Cannot normalize a zero-length vector.");
  });
});

describe("dot", () => {
  it.each([
    [p(1, 0), p(0, 1), 0],
    [p(2, 3), p(4, 5), 23],
    [p(1, 1), p(-1, -1), -2]
  ])("dot(%o, %o) = %d", (a, b, expected) => {
    expect(dot(a, b)).toBeCloseTo(expected);
  });
});

describe("cross", () => {
  it.each([
    [p(1, 0), p(0, 1), 1],
    [p(0, 1), p(1, 0), -1],
    [p(2, 3), p(4, 6), 0]
  ])("cross(%o, %o) = %d", (a, b, expected) => {
    expect(cross(a, b)).toBeCloseTo(expected);
  });
});

describe("midpoint", () => {
  it.each([
    [p(0, 0), p(2, 4), p(1, 2)],
    [p(-2, -2), p(2, 2), p(0, 0)]
  ])("midpoint(%o, %o) = %o", (a, b, expected) => {
    expect(midpoint(a, b)).toEqual(expected);
  });
});

// Sign convention matches scene3d.ts's wallInwardNormal (~line 162-168):
// rotate(to - from, +90°) = (-dy, dx), normalized. For a segment pointing
// +x, the left normal is (0, +1).
describe("unitLeftNormal", () => {
  it.each([
    [p(0, 0), p(1, 0), p(0, 1)],
    [p(0, 0), p(0, 1), p(-1, 0)],
    [p(0, 0), p(-1, 0), p(0, -1)],
    [p(0, 0), p(0, -1), p(1, 0)]
  ])("unitLeftNormal(%o, %o) = %o", (from, to, expected) => {
    const result = unitLeftNormal(from, to);
    expect(result.xMm).toBeCloseTo(expected.xMm);
    expect(result.yMm).toBeCloseTo(expected.yMm);
  });

  it("throws on coincident points", () => {
    expect(() => unitLeftNormal(p(3, 3), p(3, 3))).toThrow(
      "Cannot compute a normal for a zero-length segment."
    );
  });
});

describe("unitLeftNormalOrZero", () => {
  it("matches unitLeftNormal for non-degenerate segments", () => {
    const result = unitLeftNormalOrZero(p(0, 0), p(2, 0));
    expect(result.xMm).toBeCloseTo(0);
    expect(result.yMm).toBeCloseTo(1);
  });

  it("returns the zero vector for coincident points", () => {
    expect(unitLeftNormalOrZero(p(3, 3), p(3, 3))).toEqual(p(0, 0));
  });
});
