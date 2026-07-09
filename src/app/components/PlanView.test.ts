import { describe, expect, it } from "vitest";
import { clampFitExtent } from "./PlanView";

// clampFitExtent backs PlanView's contentBounds derivation: it must never
// let the fit window narrow below MIN_PLAN_FIT_EXTENT_MM (9144mm, ~30ft) on
// either axis, regardless of how small (or empty) the floor is, while still
// deferring to the padded floor bounds once those already exceed the floor.
describe("clampFitExtent", () => {
  it("expands an empty floor (bounds around the origin) to exactly the minimum, centered at 0,0", () => {
    const bounds = { minX: 0, minY: 0, width: 0, height: 0 };
    const padding = 900; // getPlanViewPaddingMm's floor for a 0-size bounds

    const result = clampFitExtent(bounds, padding);

    expect(result.width).toBe(9144);
    expect(result.height).toBe(9144);
    expect(result.x).toBe(-9144 / 2);
    expect(result.y).toBe(-9144 / 2);
  });

  it("leaves a large floor's padded bounds unchanged", () => {
    const bounds = { minX: 1000, minY: 2000, width: 20000, height: 15000 };
    const padding = 2100; // 0.14 * 15000

    const result = clampFitExtent(bounds, padding);

    expect(result.x).toBeCloseTo(bounds.minX - padding);
    expect(result.y).toBeCloseTo(bounds.minY - padding);
    expect(result.width).toBeCloseTo(bounds.width + padding * 2);
    expect(result.height).toBeCloseTo(bounds.height + padding * 2);
  });

  it("expands a small room to the minimum while staying centered on the room's own center", () => {
    const bounds = { minX: 5000, minY: -3000, width: 1000, height: 1000 };
    const padding = 900;

    const result = clampFitExtent(bounds, padding);
    const centerX = bounds.minX + bounds.width / 2;
    const centerY = bounds.minY + bounds.height / 2;

    expect(result.width).toBe(9144);
    expect(result.height).toBe(9144);
    expect(result.x + result.width / 2).toBeCloseTo(centerX);
    expect(result.y + result.height / 2).toBeCloseTo(centerY);
  });
});
