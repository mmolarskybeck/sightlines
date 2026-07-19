import type { DisplayUnit } from "../../domain/project";
import type { MeasurePoint } from "../../domain/measurement/measurement";
import { getNudgeStepMm } from "./nudgeStep";
import { getMeasurementCreationKeyAction } from "./measurementCreationKey";
import type { MeasurementToolAction, MeasurementToolState } from "./useMeasurementTool";

export function getPlanMeasurementNudgeDelta(
  key: string,
  unit: DisplayUnit,
  gridPrecisionFloorMm: number | null,
  shiftKey: boolean,
  snapToGrid: boolean,
  altKey: boolean
): MeasurePoint | null {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return null;
  const stepMm = getNudgeStepMm({ unit, snapToGrid, gridPrecisionFloorMm, shiftKey, altKey });
  return {
    xMm: key === "ArrowRight" ? stepMm : key === "ArrowLeft" ? -stepMm : 0,
    // Plan floor coordinates share SVG's downward-positive y axis.
    yMm: key === "ArrowDown" ? stepMm : key === "ArrowUp" ? -stepMm : 0
  };
}

export function getPlanMeasurementKeyActions(
  state: MeasurementToolState,
  endpoint: "start" | "end",
  key: string,
  unit: DisplayUnit,
  gridPrecisionFloorMm: number | null,
  shiftKey: boolean,
  snapToGrid: boolean,
  altKey: boolean
): MeasurementToolAction[] {
  if (key === "Enter" && state.phase === "refining") return [{ type: "commit-refinement" }];
  if (key === "Escape" && state.phase === "refining") return [{ type: "cancel-refinement" }];
  const delta = getPlanMeasurementNudgeDelta(key, unit, gridPrecisionFloorMm, shiftKey, snapToGrid, altKey);
  if (!delta || (state.phase !== "armed-complete" && state.phase !== "refining")) return [];
  const current = state[endpoint];
  return [
    ...(state.phase === "armed-complete"
      ? ([{ type: "begin-refinement", endpoint }] satisfies MeasurementToolAction[])
      : []),
    {
      type: "preview-refinement",
      point: { xMm: current.xMm + delta.xMm, yMm: current.yMm + delta.yMm }
    }
  ];
}

// Keyboard-only creation: Enter begins at `origin` (the view supplies the
// visible-viewport centre), arrows nudge the live preview by the shared canvas
// step, Enter completes. Keyboard-moved points intentionally skip snap
// resolution so an arrow nudge is never yanked to a snap target — the same
// predictability trade the ⌘-bypass makes for the pointer path.
export function getPlanMeasurementCreationKeyAction(
  state: MeasurementToolState,
  key: string,
  origin: MeasurePoint,
  unit: DisplayUnit,
  gridPrecisionFloorMm: number | null,
  shiftKey: boolean,
  snapToGrid: boolean,
  altKey: boolean
): MeasurementToolAction | null {
  return getMeasurementCreationKeyAction(state, key, {
    origin,
    delta: getPlanMeasurementNudgeDelta(key, unit, gridPrecisionFloorMm, shiftKey, snapToGrid, altKey)
  });
}

export function canPlanMeasurementClaimPointer(button: number, spaceHeld: boolean): boolean {
  return button === 0 && !spaceHeld;
}

export function planMeasurementCancelAction(
  state: MeasurementToolState
): MeasurementToolAction | null {
  if (state.phase === "refining") return { type: "cancel-refinement" };
  if (state.phase === "drawing") return { type: "clear" };
  return null;
}

export function shouldCancelMeasurementForViewportClaim(
  pointerType: string,
  hasMeasurementGesture: boolean
): boolean {
  return pointerType === "touch" && hasMeasurementGesture;
}
