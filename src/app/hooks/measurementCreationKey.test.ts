import { describe, expect, it } from "vitest";
import {
  getMeasurementCreationKeyAction,
  isMeasurementCreationArrowKey
} from "./measurementCreationKey";
import type { MeasurementToolState } from "./useMeasurementTool";

const origin = { xMm: 500, yMm: 600 };
const delta = { xMm: 10, yMm: 0 };

const armedEmpty: MeasurementToolState = {
  phase: "armed-empty",
  context: { kind: "plan" }
};
const drawing: MeasurementToolState = {
  phase: "drawing",
  context: { kind: "plan" },
  start: { xMm: 500, yMm: 600 },
  preview: { xMm: 520, yMm: 600 }
};
const complete: MeasurementToolState = {
  phase: "armed-complete",
  context: { kind: "plan" },
  start: { xMm: 0, yMm: 0 },
  end: { xMm: 100, yMm: 100 }
};

describe("isMeasurementCreationArrowKey", () => {
  it("recognizes the four arrow keys and nothing else", () => {
    expect(isMeasurementCreationArrowKey("ArrowLeft")).toBe(true);
    expect(isMeasurementCreationArrowKey("ArrowUp")).toBe(true);
    expect(isMeasurementCreationArrowKey("Enter")).toBe(false);
    expect(isMeasurementCreationArrowKey("a")).toBe(false);
  });
});

describe("getMeasurementCreationKeyAction", () => {
  it("begins at the origin when Enter is pressed while armed-empty", () => {
    expect(getMeasurementCreationKeyAction(armedEmpty, "Enter", { origin, delta: null })).toEqual({
      type: "begin",
      point: origin
    });
  });

  it("ignores arrow keys while armed-empty", () => {
    expect(getMeasurementCreationKeyAction(armedEmpty, "ArrowRight", { origin, delta })).toBeNull();
  });

  it("nudges the live preview by the delta while drawing", () => {
    expect(getMeasurementCreationKeyAction(drawing, "ArrowRight", { origin, delta })).toEqual({
      type: "preview",
      point: { xMm: 530, yMm: 600 }
    });
  });

  it("clamps the nudged preview when a clamp is supplied", () => {
    const clamp = (p: { xMm: number; yMm: number }) => ({
      xMm: Math.min(Math.max(p.xMm, 0), 525),
      yMm: p.yMm
    });
    expect(
      getMeasurementCreationKeyAction(drawing, "ArrowRight", { origin, delta, clamp })
    ).toEqual({ type: "preview", point: { xMm: 525, yMm: 600 } });
  });

  it("completes at the current preview when Enter is pressed while drawing", () => {
    expect(getMeasurementCreationKeyAction(drawing, "Enter", { origin, delta: null })).toEqual({
      type: "complete",
      point: drawing.preview
    });
  });

  it("does nothing for creation keys once a measurement is complete (refinement owns those)", () => {
    expect(getMeasurementCreationKeyAction(complete, "Enter", { origin, delta: null })).toBeNull();
    expect(getMeasurementCreationKeyAction(complete, "ArrowRight", { origin, delta })).toBeNull();
  });
});
