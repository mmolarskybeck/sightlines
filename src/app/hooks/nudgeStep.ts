import type { DisplayUnit } from "../../domain/project";
import { unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";

export type GetNudgeStepMmParams = {
  unit: DisplayUnit;
  snapToGrid: boolean;
  gridPrecisionFloorMm: number | null;
  shiftKey: boolean;
  altKey: boolean;
};

// The shared project nudge-increment convention, canonically implemented in
// useArrangeNudgeShortcuts and reused everywhere an arrow key moves something
// by a raw mm delta (canvas objects, measurement endpoints):
//  • snapToGrid OFF → today's raw deltas exactly (10mm/12.7mm, Shift 50mm/
//    50.8mm), no quantization/precision-floor involvement at all.
//  • snapToGrid ON, no modifier → step = the precision floor (or 10mm/12.7mm
//    when Auto), Shift = 4x that.
//  • Alt/Option → honest fine precision (1mm/1.5875mm), the deliberate
//    opt-in to unclean values; only meaningful while snapToGrid is ON since
//    that's the only mode with a "clean" step to opt out of.
export function getNudgeStepMm({
  unit,
  snapToGrid,
  gridPrecisionFloorMm,
  shiftKey,
  altKey
}: GetNudgeStepMmParams): number {
  const system = unitSystemFromDisplayUnit(unit);
  const autoStepMm = system === "metric" ? 10 : 12.7;
  if (!snapToGrid) {
    return shiftKey ? (system === "metric" ? 50 : 50.8) : autoStepMm;
  }
  if (altKey) {
    return system === "metric" ? 1 : 1.5875;
  }
  const normalMm = gridPrecisionFloorMm ?? autoStepMm;
  return shiftKey ? normalMm * 4 : normalMm;
}
