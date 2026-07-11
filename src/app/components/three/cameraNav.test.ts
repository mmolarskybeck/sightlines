import { describe, expect, it } from "vitest";
import {
  FOCUS_MAX_DISTANCE,
  FOCUS_MIN_DISTANCE,
  MAX_TRAVEL_FRAME_DELTA,
  TRAVEL_MAX_SPEED,
  TRAVEL_MIN_SPEED,
  TRAVEL_SHIFT_MULTIPLIER,
  clampFocusDistance,
  normalizeWheelDeltaY,
  travelStepDistance,
  zoomFactorFromDelta
} from "./cameraNav";

describe("normalizeWheelDeltaY", () => {
  it("passes pixel-mode deltas through unchanged", () => {
    expect(normalizeWheelDeltaY({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBe(100);
  });

  it("scales line-mode deltas to pixels", () => {
    expect(normalizeWheelDeltaY({ deltaY: 3, deltaMode: 1, ctrlKey: false })).toBe(48);
  });

  it("scales page-mode deltas to pixels", () => {
    expect(normalizeWheelDeltaY({ deltaY: 2, deltaMode: 2, ctrlKey: false })).toBe(200);
  });

  it("boosts trackpad pinch (ctrlKey) deltas", () => {
    expect(normalizeWheelDeltaY({ deltaY: 5, deltaMode: 0, ctrlKey: true })).toBe(40);
  });
});

describe("zoomFactorFromDelta", () => {
  it("holds still on a zero delta", () => {
    expect(zoomFactorFromDelta(0)).toBe(1);
  });

  it("dollies out (>1) on a positive delta and in (<1) on a negative one", () => {
    expect(zoomFactorFromDelta(100)).toBeGreaterThan(1);
    expect(zoomFactorFromDelta(-100)).toBeLessThan(1);
  });

  it("gives ~1.25x for a 100px notch", () => {
    expect(zoomFactorFromDelta(100)).toBeCloseTo(1.246, 2);
  });

  it("is symmetric: zoom in then out returns to the start", () => {
    expect(zoomFactorFromDelta(120) * zoomFactorFromDelta(-120)).toBeCloseTo(1, 10);
  });
});

describe("clampFocusDistance", () => {
  it("pulls a far standoff down to the focus max", () => {
    expect(clampFocusDistance(50)).toBe(FOCUS_MAX_DISTANCE);
  });

  it("pushes a tiny standoff up to the focus min", () => {
    expect(clampFocusDistance(0.4)).toBe(FOCUS_MIN_DISTANCE);
  });

  it("leaves an in-range standoff untouched", () => {
    expect(clampFocusDistance(3)).toBe(3);
  });
});

describe("travelStepDistance", () => {
  it("moves at the orbit distance's speed for a normal frame", () => {
    expect(travelStepDistance(10, false, 0.016)).toBeCloseTo(10 * 0.016, 10);
  });

  it("caps the step after a demand-frameloop idle gap", () => {
    // A 3s idle gap must integrate as one plausible frame, not teleport.
    expect(travelStepDistance(10, false, 3)).toBeCloseTo(10 * MAX_TRAVEL_FRAME_DELTA, 10);
  });

  it("clamps speed to the travel envelope", () => {
    expect(travelStepDistance(500, false, 0.016)).toBeCloseTo(TRAVEL_MAX_SPEED * 0.016, 10);
    expect(travelStepDistance(0.2, false, 0.016)).toBeCloseTo(TRAVEL_MIN_SPEED * 0.016, 10);
  });

  it("boosts by the shift multiplier", () => {
    expect(travelStepDistance(10, true, 0.016)).toBeCloseTo(
      travelStepDistance(10, false, 0.016) * TRAVEL_SHIFT_MULTIPLIER,
      10
    );
  });
});
