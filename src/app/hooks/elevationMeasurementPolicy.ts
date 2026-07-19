import type { DisplayUnit } from "../../domain/project";
import { getNudgeStepMm } from "./nudgeStep";
import { getMeasurementCreationKeyAction, isMeasurementCreationArrowKey } from "./measurementCreationKey";
import type { MeasurementToolAction, MeasurementToolState } from "./useMeasurementTool";

// Keyboard-only creation for Elevation. Wall-local y grows upward (ArrowUp is
// positive, mirroring the endpoint-refinement handler), and the nudged preview
// is clamped to the wall face so arrows can never walk an endpoint off the
// surface. Keyboard-moved points skip snap resolution for predictable nudges,
// matching the Plan surface path and the ⌘-bypass precedent.
export function getElevationMeasurementCreationKeyAction(
  state: MeasurementToolState,
  key: string,
  origin: { xMm: number; yMm: number },
  wallLengthMm: number,
  wallHeightMm: number,
  unit: DisplayUnit,
  gridPrecisionFloorMm: number | null,
  shiftKey: boolean,
  snapToGrid: boolean,
  altKey: boolean
): MeasurementToolAction | null {
  const stepMm = getNudgeStepMm({ unit, snapToGrid, gridPrecisionFloorMm, shiftKey, altKey });
  const delta = isMeasurementCreationArrowKey(key)
    ? {
        xMm: key === "ArrowRight" ? stepMm : key === "ArrowLeft" ? -stepMm : 0,
        yMm: key === "ArrowUp" ? stepMm : key === "ArrowDown" ? -stepMm : 0
      }
    : null;
  return getMeasurementCreationKeyAction(state, key, {
    origin,
    delta,
    clamp: (point) => ({
      xMm: Math.min(Math.max(point.xMm, 0), wallLengthMm),
      yMm: Math.min(Math.max(point.yMm, 0), wallHeightMm)
    })
  });
}
