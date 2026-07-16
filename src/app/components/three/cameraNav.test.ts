import { describe, expect, it } from "vitest";
import {
  FOCUS_MAX_DISTANCE,
  FOCUS_MIN_DISTANCE,
  MAX_TRAVEL_FRAME_DELTA,
  TRAVEL_MAX_SPEED,
  TRAVEL_MIN_SPEED,
  TRAVEL_SHIFT_MULTIPLIER,
  EYE_ARTWORK_DIAGONALS,
  EYE_FIT_MARGIN,
  EYE_MIN_VIEW_MM,
  eyeLevelArtworkDistanceMm,
  eyeLevelWallDistanceMm,
  sightlineOccluders,
  clampFocusDistance,
  KEYBOARD_ZOOM_STEP,
  keyboardZoomFactor,
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

describe("keyboardZoomFactor", () => {
  it("dollies in (<1) for 'in'", () => {
    expect(keyboardZoomFactor("in")).toBeCloseTo(1 / KEYBOARD_ZOOM_STEP, 10);
  });

  it("dollies out (>1) for 'out'", () => {
    expect(keyboardZoomFactor("out")).toBe(KEYBOARD_ZOOM_STEP);
  });

  it("is symmetric: in then out returns to the start", () => {
    expect(keyboardZoomFactor("in") * keyboardZoomFactor("out")).toBeCloseTo(1, 10);
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

describe("eyeLevelWallDistanceMm", () => {
  const fov = (50 * Math.PI) / 180;

  it("fits a wide wall by its width", () => {
    const halfH = Math.atan(Math.tan(fov / 2) * 1.5);
    const expected = EYE_FIT_MARGIN * (8534 / 2 / Math.tan(halfH));
    expect(eyeLevelWallDistanceMm(8534, 3658, 1450, fov, 1.5)).toBeCloseTo(expected, 5);
  });

  it("fits a tall narrow wall by its extent above the eye", () => {
    const expected = EYE_FIT_MARGIN * ((5000 - 1450) / Math.tan(fov / 2));
    expect(eyeLevelWallDistanceMm(2000, 5000, 1450, fov, 1.5)).toBeCloseTo(expected, 5);
  });

  it("never lands closer than the minimum standing distance", () => {
    // A low eye against a small wall: both fits land under the floor.
    expect(eyeLevelWallDistanceMm(500, 600, 400, fov, 1.5)).toBe(EYE_MIN_VIEW_MM);
  });
});

describe("eyeLevelArtworkDistanceMm", () => {
  it("stands 1.5 diagonals back from a large work", () => {
    expect(eyeLevelArtworkDistanceMm(2000, 1500)).toBeCloseTo(EYE_ARTWORK_DIAGONALS * 2500, 5);
  });

  it("floors at the minimum standing distance for small works", () => {
    expect(eyeLevelArtworkDistanceMm(400, 300)).toBe(EYE_MIN_VIEW_MM);
  });
});

describe("sightlineOccluders", () => {
  const camera = { xMm: 0, yMm: 4000 };
  const target = { xMm: 0, yMm: 0 };
  const crossing = (yMm: number, id = "p1", span: [number, number] = [-1000, 1000]) => ({
    id,
    start: { xMm: span[0], yMm },
    end: { xMm: span[1], yMm }
  });

  it("reports a partition crossing the sightline", () => {
    expect(sightlineOccluders(camera, target, [crossing(2000)])).toEqual(["p1"]);
  });

  it("ignores segments off to the side", () => {
    expect(sightlineOccluders(camera, target, [crossing(2000, "p1", [500, 2000])])).toEqual([]);
  });

  it("ignores segments beyond the target or behind the camera", () => {
    expect(sightlineOccluders(camera, target, [crossing(-500), crossing(4500)])).toEqual([]);
  });

  it("never reports the viewed wall sitting exactly at the target", () => {
    expect(sightlineOccluders(camera, target, [crossing(0)])).toEqual([]);
  });

  it("respects the exclude set", () => {
    expect(
      sightlineOccluders(camera, target, [crossing(2000)], new Set(["p1"]))
    ).toEqual([]);
  });

  it("skips single-sided walls seen from their culled (outward) side", () => {
    const wall = { ...crossing(2000, "w1"), facing: { xMm: 0, yMm: -1 } };
    expect(sightlineOccluders(camera, target, [wall])).toEqual([]);
  });

  it("reports single-sided walls facing the camera", () => {
    const wall = { ...crossing(2000, "w1"), facing: { xMm: 0, yMm: 1 } };
    expect(sightlineOccluders(camera, target, [wall])).toEqual(["w1"]);
  });

  it("ignores segments parallel to the sightline", () => {
    const parallel = { id: "p", start: { xMm: 100, yMm: 0 }, end: { xMm: 100, yMm: 4000 } };
    expect(sightlineOccluders(camera, target, [parallel])).toEqual([]);
  });
});
