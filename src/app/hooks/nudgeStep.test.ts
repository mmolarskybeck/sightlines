import { describe, expect, it } from "vitest";
import { getNudgeStepMm } from "./nudgeStep";

// The shared project nudge-increment convention (see useArrangeNudgeShortcuts):
//  • snapToGrid OFF → raw 10mm/12.7mm, Shift 50mm/50.8mm, precision floor and
//    Alt both ignored.
//  • snapToGrid ON, no modifier → the precision floor (or 10mm/12.7mm when
//    Auto), Shift = 4x that.
//  • snapToGrid ON + Alt → honest fine precision (1mm/1.5875mm), never quantized.
describe("getNudgeStepMm", () => {
  it("uses plain raw deltas when snapToGrid is off, ignoring the precision floor and Alt", () => {
    expect(
      getNudgeStepMm({ unit: "cm", snapToGrid: false, gridPrecisionFloorMm: 25.4, shiftKey: false, altKey: false })
    ).toBe(10);
    expect(
      getNudgeStepMm({ unit: "in", snapToGrid: false, gridPrecisionFloorMm: 25.4, shiftKey: false, altKey: false })
    ).toBe(12.7);
    expect(
      getNudgeStepMm({ unit: "cm", snapToGrid: false, gridPrecisionFloorMm: null, shiftKey: true, altKey: false })
    ).toBe(50);
    expect(
      getNudgeStepMm({ unit: "in", snapToGrid: false, gridPrecisionFloorMm: null, shiftKey: true, altKey: false })
    ).toBe(50.8);
    expect(
      getNudgeStepMm({ unit: "cm", snapToGrid: false, gridPrecisionFloorMm: 25.4, shiftKey: false, altKey: true })
    ).toBe(10);
  });

  it("steps by the precision floor (or auto default) when snapToGrid is on, 4x on Shift", () => {
    expect(
      getNudgeStepMm({ unit: "cm", snapToGrid: true, gridPrecisionFloorMm: null, shiftKey: false, altKey: false })
    ).toBe(10);
    expect(
      getNudgeStepMm({ unit: "in", snapToGrid: true, gridPrecisionFloorMm: null, shiftKey: false, altKey: false })
    ).toBe(12.7);
    expect(
      getNudgeStepMm({ unit: "cm", snapToGrid: true, gridPrecisionFloorMm: 25.4, shiftKey: false, altKey: false })
    ).toBe(25.4);
    expect(
      getNudgeStepMm({ unit: "cm", snapToGrid: true, gridPrecisionFloorMm: 25.4, shiftKey: true, altKey: false })
    ).toBe(101.6);
    expect(
      getNudgeStepMm({ unit: "in", snapToGrid: true, gridPrecisionFloorMm: null, shiftKey: true, altKey: false })
    ).toBe(50.8);
  });

  it("honors Alt as an honest fine step while snapToGrid is on, overriding the precision floor and Shift", () => {
    expect(
      getNudgeStepMm({ unit: "cm", snapToGrid: true, gridPrecisionFloorMm: 25.4, shiftKey: false, altKey: true })
    ).toBe(1);
    expect(
      getNudgeStepMm({ unit: "in", snapToGrid: true, gridPrecisionFloorMm: 25.4, shiftKey: true, altKey: true })
    ).toBe(1.5875);
  });
});
