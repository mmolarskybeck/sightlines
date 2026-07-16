import { describe, expect, it } from "vitest";

import {
  createEmptyMeasurementState,
  escapeMeasurementState,
  measurementToolReducer,
  type MeasurementToolState
} from "./useMeasurementTool";

const context = { kind: "plan" } as const;
const a = { xMm: 10, yMm: 20 };
const b = { xMm: 40, yMm: 60 };

function completed(): MeasurementToolState {
  return measurementToolReducer(
    measurementToolReducer(createEmptyMeasurementState(context), { type: "begin", point: a }),
    { type: "complete", point: b }
  );
}

describe("measurementToolReducer", () => {
  it("draws and completes without rounding model coordinates", () => {
    let state = measurementToolReducer(createEmptyMeasurementState(context), {
      type: "begin",
      point: a
    });
    state = measurementToolReducer(state, { type: "preview", point: b });
    expect(state).toMatchObject({ phase: "drawing", start: a, preview: b });

    state = measurementToolReducer(state, { type: "complete", point: b });
    expect(state).toEqual({ phase: "armed-complete", context, start: a, end: b });
  });

  it("rejects coincident completion and preserves endpoint A", () => {
    const drawing = measurementToolReducer(createEmptyMeasurementState(context), {
      type: "begin",
      point: a
    });
    expect(measurementToolReducer(drawing, { type: "complete", point: a })).toBe(drawing);
  });

  it("beginning again replaces the completed temporary result", () => {
    expect(measurementToolReducer(completed(), { type: "begin", point: b })).toEqual({
      phase: "drawing",
      context,
      start: b,
      preview: b
    });
  });

  it("commits refinement or restores its original endpoint on cancel", () => {
    const refining = measurementToolReducer(completed(), {
      type: "begin-refinement",
      endpoint: "end"
    });
    const moved = measurementToolReducer(refining, {
      type: "preview-refinement",
      point: { xMm: 80, yMm: 90 }
    });
    expect(measurementToolReducer(moved, { type: "commit-refinement" })).toMatchObject({
      phase: "armed-complete",
      end: { xMm: 80, yMm: 90 }
    });
    expect(measurementToolReducer(moved, { type: "cancel-refinement" })).toEqual(completed());
  });

  it("clears temporary work when its coordinate context changes", () => {
    const elevation = { kind: "elevation", wallId: "wall-b" } as const;
    expect(
      measurementToolReducer(completed(), { type: "set-context", context: elevation })
    ).toEqual({ phase: "armed-empty", context: elevation });
  });

  it("applies Escape from the most local state outward", () => {
    expect(escapeMeasurementState(completed())).toEqual({
      state: createEmptyMeasurementState(context),
      disarm: false
    });
    expect(escapeMeasurementState(createEmptyMeasurementState(context)).disarm).toBe(true);

    const refining = measurementToolReducer(completed(), {
      type: "begin-refinement",
      endpoint: "start"
    });
    expect(escapeMeasurementState(refining)).toEqual({ state: completed(), disarm: false });
  });
});
