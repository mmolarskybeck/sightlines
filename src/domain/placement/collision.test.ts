import { describe, expect, it } from "vitest";
import type { WallObjectBase } from "../project";
import { doWallObjectsOverlap, getWallObjectBoundsMm } from "./collision";

function box(overrides: Partial<WallObjectBase> = {}): WallObjectBase {
  return {
    id: "box-1",
    wallId: "wall-1",
    xMm: 1000,
    yMm: 1450,
    widthMm: 400,
    heightMm: 600,
    ...overrides
  };
}

describe("getWallObjectBoundsMm", () => {
  it("converts a center-anchored object to axis-aligned bounds", () => {
    expect(getWallObjectBoundsMm(box())).toEqual({
      leftMm: 800,
      rightMm: 1200,
      bottomMm: 1150,
      topMm: 1750
    });
  });
});

describe("doWallObjectsOverlap", () => {
  it("reports true for two clearly overlapping rects", () => {
    const a = box({ id: "a", xMm: 1000, yMm: 1000, widthMm: 400, heightMm: 400 });
    const b = box({ id: "b", xMm: 1100, yMm: 1100, widthMm: 400, heightMm: 400 });

    expect(doWallObjectsOverlap(a, b)).toBe(true);
  });

  it("reports false for two clearly separate rects", () => {
    const a = box({ id: "a", xMm: 0, yMm: 0, widthMm: 200, heightMm: 200 });
    const b = box({ id: "b", xMm: 5000, yMm: 5000, widthMm: 200, heightMm: 200 });

    expect(doWallObjectsOverlap(a, b)).toBe(false);
  });

  it("treats rects that only touch edges as not overlapping (strict inequality)", () => {
    // a's right edge (200) exactly meets b's left edge (200) — flush, not
    // overlapping, matching the wall-bounds check's own "<"/">" convention.
    const a = box({ id: "a", xMm: 100, yMm: 0, widthMm: 200, heightMm: 200 });
    const b = box({ id: "b", xMm: 300, yMm: 0, widthMm: 200, heightMm: 200 });

    expect(doWallObjectsOverlap(a, b)).toBe(false);
  });

  it("reports false when rects overlap on one axis but not the other", () => {
    // Same x-range, but b sits well above a vertically.
    const a = box({ id: "a", xMm: 1000, yMm: 0, widthMm: 400, heightMm: 400 });
    const b = box({ id: "b", xMm: 1000, yMm: 5000, widthMm: 400, heightMm: 400 });

    expect(doWallObjectsOverlap(a, b)).toBe(false);
  });

  it("reports true when one rect fully contains the other", () => {
    const big = box({ id: "big", xMm: 1000, yMm: 1000, widthMm: 2000, heightMm: 2000 });
    const small = box({ id: "small", xMm: 1000, yMm: 1000, widthMm: 100, heightMm: 100 });

    expect(doWallObjectsOverlap(big, small)).toBe(true);
  });
});
