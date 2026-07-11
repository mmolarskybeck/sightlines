import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  useViewPreferences,
  LEFT_PANEL_DEFAULT_WIDTH,
  LEFT_PANEL_MIN_WIDTH,
  LEFT_PANEL_MAX_WIDTH,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_MAX_WIDTH
} from "./useViewPreferences";

const STORAGE_KEY = "sightlines.viewPreferences.v1";

describe("useViewPreferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults gridPrecisionFloorMm to null (auto) when nothing is stored", () => {
    const { result } = renderHook(() => useViewPreferences());

    expect(result.current.gridPrecisionFloorMm).toBeNull();
    // Grid now defaults on (a measured drafting surface on first open); snap
    // stays on as before.
    expect(result.current.showGrid).toBe(true);
    expect(result.current.snapToGrid).toBe(true);
    // The eyeline was always rendered before this toggle existed, so it
    // defaults on too — no visual change for an existing user.
    expect(result.current.showCenterline).toBe(true);
    // The checklist is the left anchor of the workspace on first open.
    expect(result.current.leftPanel).toBe("checklist");
  });

  it("switches and collapses the left panel, persisting each state", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.setLeftPanel("rooms");
    });
    expect(result.current.leftPanel).toBe("rooms");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").leftPanel).toBe(
      "rooms"
    );

    act(() => {
      result.current.setLeftPanel(null);
    });
    expect(result.current.leftPanel).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").leftPanel).toBeNull();
  });

  it("honors a stored null (collapsed) but falls back to default for a bad value", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ leftPanel: null }));
    expect(renderHook(() => useViewPreferences()).result.current.leftPanel).toBeNull();

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ leftPanel: "nope" }));
    expect(renderHook(() => useViewPreferences()).result.current.leftPanel).toBe("checklist");

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ showGrid: true }));
    expect(renderHook(() => useViewPreferences()).result.current.leftPanel).toBe("checklist");
  });

  it("persists a chosen floor to localStorage and reflects it in state", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.setGridPrecisionFloorMm(25.4);
    });

    expect(result.current.gridPrecisionFloorMm).toBeCloseTo(25.4);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.gridPrecisionFloorMm).toBeCloseTo(25.4);
  });

  it("resets back to auto (null) and persists that", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.setGridPrecisionFloorMm(25.4);
    });
    act(() => {
      result.current.setGridPrecisionFloorMm(null);
    });

    expect(result.current.gridPrecisionFloorMm).toBeNull();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.gridPrecisionFloorMm).toBeNull();
  });

  it("reads a previously persisted floor back on mount", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showGrid: true, snapToGrid: false, gridPrecisionFloorMm: 152.4 })
    );

    const { result } = renderHook(() => useViewPreferences());

    expect(result.current.gridPrecisionFloorMm).toBeCloseTo(152.4);
    expect(result.current.showGrid).toBe(true);
    expect(result.current.snapToGrid).toBe(false);
  });

  it("reads a previously persisted showCenterline back on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ showCenterline: false }));

    expect(renderHook(() => useViewPreferences()).result.current.showCenterline).toBe(false);
  });

  it("falls back to the showCenterline default for a malformed stored value", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ showCenterline: "nope" }));

    expect(renderHook(() => useViewPreferences()).result.current.showCenterline).toBe(true);
  });

  it("toggles and persists showCenterline independently of showGrid", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.toggleShowCenterline();
    });

    expect(result.current.showCenterline).toBe(false);
    // showGrid is untouched by the eyeline toggle, mirroring how showGrid and
    // snapToGrid are independent of each other.
    expect(result.current.showGrid).toBe(true);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").showCenterline
    ).toBe(false);

    act(() => {
      result.current.toggleShowCenterline();
    });
    expect(result.current.showCenterline).toBe(true);
  });

  it("falls back to null for a non-positive, non-finite, or malformed stored floor", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ gridPrecisionFloorMm: -5 })
    );
    expect(renderHook(() => useViewPreferences()).result.current.gridPrecisionFloorMm).toBeNull();

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ gridPrecisionFloorMm: 0 }));
    expect(renderHook(() => useViewPreferences()).result.current.gridPrecisionFloorMm).toBeNull();

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ gridPrecisionFloorMm: "12" }));
    expect(renderHook(() => useViewPreferences()).result.current.gridPrecisionFloorMm).toBeNull();
  });

  it("falls back to all defaults when stored JSON is malformed", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not-json");

    const { result } = renderHook(() => useViewPreferences());

    expect(result.current.gridPrecisionFloorMm).toBeNull();
    expect(result.current.showGrid).toBe(true);
    expect(result.current.snapToGrid).toBe(true);
    expect(result.current.showCenterline).toBe(true);
  });

  it("defaults the panel widths and inspector-collapsed state on first open", () => {
    const { result } = renderHook(() => useViewPreferences());

    expect(result.current.leftPanelWidth).toBe(LEFT_PANEL_DEFAULT_WIDTH);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(result.current.inspectorCollapsed).toBe(false);
  });

  it("persists dragged panel widths to localStorage", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.setLeftPanelWidth(360);
      result.current.setInspectorWidth(340);
    });

    expect(result.current.leftPanelWidth).toBe(360);
    expect(result.current.inspectorWidth).toBe(340);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.leftPanelWidth).toBe(360);
    expect(stored.inspectorWidth).toBe(340);
  });

  it("clamps widths to their bounds on write", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.setLeftPanelWidth(9999);
      result.current.setInspectorWidth(10);
    });

    expect(result.current.leftPanelWidth).toBe(LEFT_PANEL_MAX_WIDTH);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_MIN_WIDTH);
  });

  it("clamps out-of-range stored widths on read", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ leftPanelWidth: 5, inspectorWidth: 9999 })
    );

    const { result } = renderHook(() => useViewPreferences());

    expect(result.current.leftPanelWidth).toBe(LEFT_PANEL_MIN_WIDTH);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_MAX_WIDTH);
  });

  it("falls back to default widths for malformed stored values", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ leftPanelWidth: "wide", inspectorWidth: null })
    );

    const { result } = renderHook(() => useViewPreferences());

    expect(result.current.leftPanelWidth).toBe(LEFT_PANEL_DEFAULT_WIDTH);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
  });

  it("toggles and persists the inspector-collapsed state", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.toggleInspectorCollapsed();
    });
    expect(result.current.inspectorCollapsed).toBe(true);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").inspectorCollapsed
    ).toBe(true);

    act(() => {
      result.current.toggleInspectorCollapsed();
    });
    expect(result.current.inspectorCollapsed).toBe(false);
  });

  it("defaults inspector sections to dimensions/framing/placement open, details closed", () => {
    const { result } = renderHook(() => useViewPreferences());

    expect(result.current.inspectorSections).toEqual({
      dimensions: true,
      framing: true,
      placement: true,
      details: false
    });
  });

  it("sets and persists a section's open state without touching the others", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.setInspectorSectionOpen("framing", false);
    });
    expect(result.current.inspectorSections.framing).toBe(false);
    expect(result.current.inspectorSections.dimensions).toBe(true);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").inspectorSections.framing
    ).toBe(false);

    act(() => {
      result.current.setInspectorSectionOpen("details", true);
    });
    expect(result.current.inspectorSections.details).toBe(true);
    expect(result.current.inspectorSections.framing).toBe(false);
  });

  it("honors stored section booleans and drops malformed entries onto defaults", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ inspectorSections: { dimensions: false, details: "yes", extra: true } })
    );

    const { result } = renderHook(() => useViewPreferences());

    // Stored boolean honored, malformed value falls back, unknown key kept
    // (a section id from a newer build must not be dropped on round-trip).
    expect(result.current.inspectorSections.dimensions).toBe(false);
    expect(result.current.inspectorSections.details).toBe(false);
    expect(result.current.inspectorSections.extra).toBe(true);
    expect(result.current.inspectorSections.framing).toBe(true);
  });

  it("falls back to default sections for a malformed inspectorSections value", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ inspectorSections: [true] }));

    const { result } = renderHook(() => useViewPreferences());

    expect(result.current.inspectorSections).toEqual({
      dimensions: true,
      framing: true,
      placement: true,
      details: false
    });
  });

  it("resetPreferences restores all fields to defaults and persists the reset blob", () => {
    const { result } = renderHook(() => useViewPreferences());

    act(() => {
      result.current.toggleShowGrid();
      result.current.setLeftPanelWidth(400);
      result.current.setInspectorSectionOpen("details", true);
    });

    expect(result.current.showGrid).toBe(false);
    expect(result.current.leftPanelWidth).toBe(400);
    expect(result.current.inspectorSections.details).toBe(true);

    act(() => {
      result.current.resetPreferences();
    });

    expect(result.current.showGrid).toBe(true);
    expect(result.current.snapToGrid).toBe(true);
    expect(result.current.showCenterline).toBe(true);
    expect(result.current.gridPrecisionFloorMm).toBeNull();
    expect(result.current.allowOverlappingPlacement).toBe(false);
    expect(result.current.leftPanel).toBe("checklist");
    expect(result.current.leftPanelWidth).toBe(LEFT_PANEL_DEFAULT_WIDTH);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(result.current.inspectorCollapsed).toBe(false);
    expect(result.current.inspectorSections).toEqual({
      dimensions: true,
      framing: true,
      placement: true,
      details: false
    });

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored).toEqual({
      showGrid: true,
      snapToGrid: true,
      showCenterline: true,
      gridPrecisionFloorMm: null,
      allowOverlappingPlacement: false,
      leftPanel: "checklist",
      leftPanelWidth: LEFT_PANEL_DEFAULT_WIDTH,
      inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
      inspectorCollapsed: false,
      inspectorSections: {
        dimensions: true,
        framing: true,
        placement: true,
        details: false
      }
    });
  });
});
