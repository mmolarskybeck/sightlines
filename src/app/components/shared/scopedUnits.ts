import type { DisplayUnit } from "../../../domain/project";
import type { MeasurementScope, UnitSystem } from "../../../domain/units/unitSystem";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../../domain/units/unitSystem";

export const IMPERIAL_STEP_MM = 12.7;
export const METRIC_STEP_MM = 10;

export function getScopedUnitContext(unit: DisplayUnit, scope: MeasurementScope) {
  const system = unitSystemFromDisplayUnit(unit);
  const { displayUnit, parseUnit } = getScopeUnits(system, scope);
  const placeholder = getPlaceholderForScope(system, scope);
  const stepMm = system === "metric" ? METRIC_STEP_MM : IMPERIAL_STEP_MM;

  return { system, displayUnit, parseUnit, placeholder, stepMm };
}
