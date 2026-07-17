import { useEffect, useRef, useState } from "react";
import { clamp } from "../../domain/geometry/scalar";

const STORAGE_KEY = "sightlines.viewPreferences.v1";

// Shared by drag-handle constraints and persisted-value sanitization.
export const LEFT_PANEL_MIN_WIDTH = 240;
export const LEFT_PANEL_MAX_WIDTH = 480;
export const LEFT_PANEL_DEFAULT_WIDTH = 320;
export const INSPECTOR_MIN_WIDTH = 260;
export const INSPECTOR_MAX_WIDTH = 420;
export const INSPECTOR_DEFAULT_WIDTH = 300;

type ViewPreferences = {
  showGrid: boolean;
  snapToGrid: boolean;
  // Visibility only; centerline snapping remains unconditional.
  showCenterline: boolean;
  // Millimetres regardless of display unit; null selects automatic precision.
  gridPrecisionFloorMm: number | null;
  // Explicit opt-in to bypass the default collision rejection.
  allowOverlappingPlacement: boolean;
  // null means the left column is collapsed.
  leftPanel: "checklist" | "rooms" | "savedViews" | null;
  // Workspace-only pixel widths, clamped to the bounds above.
  leftPanelWidth: number;
  inspectorWidth: number;
  // Whether the right inspector is fully collapsed.
  inspectorCollapsed: boolean;
  // Open state keyed by stable section id; unknown ids use their local default.
  inspectorSections: Record<string, boolean>;
};

// Mat/frame is omitted because its default is derived from the selected artwork.
export const DEFAULT_INSPECTOR_SECTIONS: Record<string, boolean> = {
  dimensions: true,
  placement: true,
  details: false
};

const DEFAULT_PREFERENCES: ViewPreferences = {
  showGrid: true,
  snapToGrid: true,
  showCenterline: true,
  gridPrecisionFloorMm: null,
  allowOverlappingPlacement: false,
  leftPanel: "checklist",
  leftPanelWidth: LEFT_PANEL_DEFAULT_WIDTH,
  inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
  inspectorCollapsed: false,
  inspectorSections: DEFAULT_INSPECTOR_SECTIONS
};

// Layer valid stored entries over current defaults.
function sanitizeInspectorSections(value: unknown): Record<string, boolean> {
  const sections = { ...DEFAULT_INSPECTOR_SECTIONS };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return sections;

  for (const [key, open] of Object.entries(value)) {
    if (typeof open === "boolean") sections[key] = open;
  }

  return sections;
}

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
      showCenterline:
        typeof parsed.showCenterline === "boolean"
          ? parsed.showCenterline
          : DEFAULT_PREFERENCES.showCenterline,
      gridPrecisionFloorMm:
        typeof parsed.gridPrecisionFloorMm === "number" &&
        Number.isFinite(parsed.gridPrecisionFloorMm) &&
        parsed.gridPrecisionFloorMm > 0
          ? parsed.gridPrecisionFloorMm
          : DEFAULT_PREFERENCES.gridPrecisionFloorMm,
      allowOverlappingPlacement:
        typeof parsed.allowOverlappingPlacement === "boolean"
          ? parsed.allowOverlappingPlacement
          : DEFAULT_PREFERENCES.allowOverlappingPlacement,
      // Preserve an intentional collapsed state.
      leftPanel:
        parsed.leftPanel === "checklist" ||
        parsed.leftPanel === "rooms" ||
        parsed.leftPanel === "savedViews" ||
        parsed.leftPanel === null
          ? parsed.leftPanel
          : DEFAULT_PREFERENCES.leftPanel,
      // Clamp on read to tolerate edited or legacy values.
      leftPanelWidth:
        typeof parsed.leftPanelWidth === "number" && Number.isFinite(parsed.leftPanelWidth)
          ? clamp(parsed.leftPanelWidth, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH)
          : DEFAULT_PREFERENCES.leftPanelWidth,
      inspectorWidth:
        typeof parsed.inspectorWidth === "number" && Number.isFinite(parsed.inspectorWidth)
          ? clamp(parsed.inspectorWidth, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH)
          : DEFAULT_PREFERENCES.inspectorWidth,
      inspectorCollapsed:
        typeof parsed.inspectorCollapsed === "boolean"
          ? parsed.inspectorCollapsed
          : DEFAULT_PREFERENCES.inspectorCollapsed,
      inspectorSections: sanitizeInspectorSections(parsed.inspectorSections)
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

// Workspace preferences stay local and never travel with exported projects.
export function useViewPreferences(onPersistenceError?: (message: string) => void) {
  const [preferences, setPreferences] = useState<ViewPreferences>(readStoredPreferences);
  const onPersistenceErrorRef = useRef(onPersistenceError);
  onPersistenceErrorRef.current = onPersistenceError;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      onPersistenceErrorRef.current?.(
        "Could not save workspace preferences. Browser storage may be full or unavailable; your latest preference changes may be lost when you reload."
      );
    }
  }, [preferences]);

  return {
    showGrid: preferences.showGrid,
    snapToGrid: preferences.snapToGrid,
    showCenterline: preferences.showCenterline,
    gridPrecisionFloorMm: preferences.gridPrecisionFloorMm,
    allowOverlappingPlacement: preferences.allowOverlappingPlacement,
    leftPanel: preferences.leftPanel,
    leftPanelWidth: preferences.leftPanelWidth,
    inspectorWidth: preferences.inspectorWidth,
    inspectorCollapsed: preferences.inspectorCollapsed,
    inspectorSections: preferences.inspectorSections,
    setInspectorSectionOpen: (sectionId: string, open: boolean) =>
      setPreferences((current) => ({
        ...current,
        inspectorSections: { ...current.inspectorSections, [sectionId]: open }
      })),
    setLeftPanel: (leftPanel: ViewPreferences["leftPanel"]) =>
      setPreferences((current) => ({ ...current, leftPanel })),
    setLeftPanelWidth: (leftPanelWidth: number) =>
      setPreferences((current) => ({
        ...current,
        leftPanelWidth: clamp(leftPanelWidth, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH)
      })),
    setInspectorWidth: (inspectorWidth: number) =>
      setPreferences((current) => ({
        ...current,
        inspectorWidth: clamp(inspectorWidth, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH)
      })),
    toggleInspectorCollapsed: () =>
      setPreferences((current) => ({
        ...current,
        inspectorCollapsed: !current.inspectorCollapsed
      })),
    toggleShowGrid: () =>
      setPreferences((current) => ({ ...current, showGrid: !current.showGrid })),
    toggleSnapToGrid: () =>
      setPreferences((current) => ({ ...current, snapToGrid: !current.snapToGrid })),
    toggleShowCenterline: () =>
      setPreferences((current) => ({ ...current, showCenterline: !current.showCenterline })),
    setGridPrecisionFloorMm: (gridPrecisionFloorMm: number | null) =>
      setPreferences((current) => ({ ...current, gridPrecisionFloorMm })),
    toggleAllowOverlappingPlacement: () =>
      setPreferences((current) => ({
        ...current,
        allowOverlappingPlacement: !current.allowOverlappingPlacement
      })),
    resetPreferences: () => setPreferences(DEFAULT_PREFERENCES)
  };
}
