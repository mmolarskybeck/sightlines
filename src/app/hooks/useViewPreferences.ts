import { useEffect, useState } from "react";

const STORAGE_KEY = "sightlines.viewPreferences.v1";

type ViewPreferences = {
  showGrid: boolean;
  snapToGrid: boolean;
  // The user's chosen precision floor in mm, or null for "auto" (no floor —
  // the grid keeps stepping down with zoom per docs/plan.md §5.5). Stored
  // in mm regardless of display unit so a floor picked under one unit
  // family keeps working if the project's unit later changes; consumers
  // clamp it to the nearest table entry, so an odd stored value is safe.
  gridPrecisionFloorMm: number | null;
};

const DEFAULT_PREFERENCES: ViewPreferences = {
  showGrid: false,
  snapToGrid: true,
  gridPrecisionFloorMm: null
};

function readStoredPreferences(): ViewPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<ViewPreferences>;
    return {
      showGrid:
        typeof parsed.showGrid === "boolean" ? parsed.showGrid : DEFAULT_PREFERENCES.showGrid,
      snapToGrid:
        typeof parsed.snapToGrid === "boolean"
          ? parsed.snapToGrid
          : DEFAULT_PREFERENCES.snapToGrid,
      gridPrecisionFloorMm:
        typeof parsed.gridPrecisionFloorMm === "number" &&
        Number.isFinite(parsed.gridPrecisionFloorMm) &&
        parsed.gridPrecisionFloorMm > 0
          ? parsed.gridPrecisionFloorMm
          : DEFAULT_PREFERENCES.gridPrecisionFloorMm
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

// Grid visibility and snap-to-grid are workspace preferences, not project
// geometry (docs/plan.md §5.5) — they live in localStorage, independent of
// each other, so importing a shared .sightlines file never imports someone
// else's working-style preferences. "Show grid" and "snap to grid" are
// intentionally separate: a curator may want the visual reference without
// magnetic behavior during rough composition.
export function useViewPreferences() {
  const [preferences, setPreferences] = useState<ViewPreferences>(readStoredPreferences);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  return {
    showGrid: preferences.showGrid,
    snapToGrid: preferences.snapToGrid,
    gridPrecisionFloorMm: preferences.gridPrecisionFloorMm,
    toggleShowGrid: () =>
      setPreferences((current) => ({ ...current, showGrid: !current.showGrid })),
    toggleSnapToGrid: () =>
      setPreferences((current) => ({ ...current, snapToGrid: !current.snapToGrid })),
    setGridPrecisionFloorMm: (gridPrecisionFloorMm: number | null) =>
      setPreferences((current) => ({ ...current, gridPrecisionFloorMm }))
  };
}
