import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useViewPreferences } from "./useViewPreferences";

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
    // Untouched behavior from before this preference existed.
    expect(result.current.showGrid).toBe(false);
    expect(result.current.snapToGrid).toBe(true);
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
    expect(result.current.showGrid).toBe(false);
    expect(result.current.snapToGrid).toBe(true);
  });
});
