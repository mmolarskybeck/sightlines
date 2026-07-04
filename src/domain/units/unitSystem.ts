import type { DisplayUnit } from "../project";

export type UnitSystem = "imperial" | "metric";
export type MeasurementScope = "wall" | "artwork" | "openingSize" | "openingPosition";
export type ScopeUnits = { displayUnit: DisplayUnit; parseUnit: DisplayUnit };

export function unitSystemFromDisplayUnit(unit: DisplayUnit): UnitSystem {
  return unit === "in" || unit === "ft" ? "imperial" : "metric";
}

export function displayUnitForSystem(system: UnitSystem): DisplayUnit {
  return system === "imperial" ? "ft" : "m";
}

export function getScopeUnits(system: UnitSystem, scope: MeasurementScope): ScopeUnits {
  if (system === "imperial") {
    switch (scope) {
      case "wall":
        return { displayUnit: "ft", parseUnit: "ft" };
      case "artwork":
        return { displayUnit: "in", parseUnit: "in" };
      case "openingSize":
        // openingSize is the one cell where parse ≠ display — imperial doors/windows
        // are specced in inches (36" × 80") but read most naturally as feet-and-inches.
        return { displayUnit: "ft", parseUnit: "in" };
      case "openingPosition":
        return { displayUnit: "ft", parseUnit: "ft" };
    }
  } else {
    switch (scope) {
      case "wall":
        return { displayUnit: "m", parseUnit: "m" };
      case "artwork":
        return { displayUnit: "cm", parseUnit: "cm" };
      case "openingSize":
        return { displayUnit: "cm", parseUnit: "cm" };
      case "openingPosition":
        return { displayUnit: "cm", parseUnit: "cm" };
    }
  }
}

export function getPlaceholderForScope(
  system: UnitSystem,
  scope: MeasurementScope
): string {
  if (system === "imperial") {
    switch (scope) {
      case "artwork":
        return "e.g. 24 1/2\"";
      case "wall":
        return "e.g. 12' 6\"";
      case "openingSize":
        return "e.g. 6' 8\"";
      case "openingPosition":
        return "e.g. 4'";
    }
  } else {
    switch (scope) {
      case "artwork":
        return "e.g. 62 cm";
      case "wall":
        return "e.g. 3.8 m";
      case "openingSize":
        return "e.g. 203 cm";
      case "openingPosition":
        return "e.g. 120 cm";
    }
  }
}
