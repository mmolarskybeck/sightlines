import { useEffect, useState } from "react";
import { clamp } from "../../domain/geometry/scalar";

const STORAGE_KEY = "sightlines.viewPreferences.v1";

// Resizable-panel bounds, exported so both the drag handles (for their
// aria-valuemin/max and clamping) and the stored-preference sanitizer share a
// single source of truth. The defaults match the original fixed grid tracks
// (320px / 300px in global.css's .workspace) so an existing user with no stored
// widths sees no layout shift the first time this ships.
export const LEFT_PANEL_MIN_WIDTH = 240;
export const LEFT_PANEL_MAX_WIDTH = 480;
export const LEFT_PANEL_DEFAULT_WIDTH = 320;
export const INSPECTOR_MIN_WIDTH = 260;
export const INSPECTOR_MAX_WIDTH = 420;
export const INSPECTOR_DEFAULT_WIDTH = 300;

type ViewPreferences = {
  showGrid: boolean;
  snapToGrid: boolean;
  // Elevation-only: shows/hides the centerline (a.k.a. eyeline) at the wall's
  // default hang height. Independent of centerline SNAPPING the same way
  // showGrid is independent of snapToGrid below — the alignment snap to
  // centerlineMm in resolveElevationPlacement is unconditional either way, so
  // hiding the line only removes the visual reference, never the magnetism.
  showCenterline: boolean;
  // The user's chosen precision floor in mm, or null for "auto" (no floor —
  // the grid keeps stepping down with zoom per docs/plan.md §5.5). Stored
  // in mm regardless of display unit so a floor picked under one unit
  // family keeps working if the project's unit later changes; consumers
  // clamp it to the nearest table entry, so an odd stored value is safe.
  gridPrecisionFloorMm: number | null;
  // Off by default: artwork/opening collisions are rejected outright (see
  // store.ts's allowOverlap gating) unless a curator deliberately opts in
  // here, so this is a rare, low-visibility override rather than a
  // frequently-toggled option like grid/snap.
  allowOverlappingPlacement: boolean;
  // Which inventory the left column shows, or null when collapsed. The rail
  // selects it: clicking the active panel's icon collapses to null, clicking
  // the other switches. Defaults to "checklist" — the left anchor of the
  // workspace on first open. A workspace preference like grid/snap; it sticks.
  leftPanel: "checklist" | "rooms" | null;
  // User-dragged panel widths in px, clamped to the bounds above. Like the
  // other fields here they're workspace preferences (a working-style choice,
  // not project geometry), so they live in localStorage and never travel with
  // an exported .sightlines file.
  leftPanelWidth: number;
  inspectorWidth: number;
  // Whether the right inspector is collapsed entirely. Symmetric with
  // leftPanel === null on the other side — toggled from the rail. Defaults to
  // open: the inspector is where a selection's editable fields live, so hiding
  // it is a deliberate opt-out.
  inspectorCollapsed: boolean;
  // Open/closed state per collapsible inspector section (InspectorSection),
  // keyed by a stable section id. A working-style preference like the panel
  // widths: it survives selection changes and reloads, and never travels
  // with an exported project. Unknown ids simply fall back to their
  // section's own default, so shipping a new section never breaks a stored
  // record.
  inspectorSections: Record<string, boolean>;
};

// Everyday-editing sections start open; registrar reference data starts
// closed (consulted less often than measurements or arranging — the same
// reading-order reasoning as ArtworkInspector's field clusters).
export const DEFAULT_INSPECTOR_SECTIONS: Record<string, boolean> = {
  dimensions: true,
  framing: true,
  placement: true,
  details: false
};

const DEFAULT_PREFERENCES: ViewPreferences = {
  // On by default: the visible grid is what makes the canvas read as a
  // measured drafting surface rather than a blank sheet on first open.
  // Still a workspace preference — turning it off sticks.
  showGrid: true,
  snapToGrid: true,
  // On by default: matches the pre-toggle behavior where the centerline was
  // always rendered in elevation mode, so an existing user sees no change
  // the first time this ships.
  showCenterline: true,
  gridPrecisionFloorMm: null,
  allowOverlappingPlacement: false,
  leftPanel: "checklist",
  leftPanelWidth: LEFT_PANEL_DEFAULT_WIDTH,
  inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
  inspectorCollapsed: false,
  inspectorSections: DEFAULT_INSPECTOR_SECTIONS
};

// Keeps only well-formed `sectionId: boolean` entries from a stored record,
// layered over the defaults — a hand-edited value or a section id from a
// newer build can never poison the whole map.
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
      // A stored `null` means the user deliberately collapsed the column, so
      // it's honored; only a missing/invalid value falls back to the default.
      leftPanel:
        parsed.leftPanel === "checklist" ||
        parsed.leftPanel === "rooms" ||
        parsed.leftPanel === null
          ? parsed.leftPanel
          : DEFAULT_PREFERENCES.leftPanel,
      // Stored widths are clamped on read as well as on write: a hand-edited
      // localStorage value, or one saved before the bounds changed, can never
      // push a panel to an unusable size.
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
