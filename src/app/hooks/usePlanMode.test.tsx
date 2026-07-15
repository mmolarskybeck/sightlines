import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePlanMode } from "./usePlanMode";

describe("usePlanMode Measure", () => {
  it("toggles as one of the mutually exclusive armed modes", () => {
    const { result } = renderHook(() => usePlanMode("plan", null));

    act(() => result.current.toggleMeasure());
    expect(result.current.mode).toEqual({ kind: "measure" });

    act(() => result.current.toggleDrawRect());
    expect(result.current.mode).toEqual({ kind: "drawRect" });

    act(() => result.current.toggleMeasure());
    expect(result.current.mode).toEqual({ kind: "measure" });
    act(() => result.current.toggleMeasure());
    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("stays armed across the two 2D views and disarms in 3D", () => {
    const { result, rerender } = renderHook(
      ({ view }) => usePlanMode(view, null),
      { initialProps: { view: "plan" as "plan" | "elevation" | "3d" } }
    );

    act(() => result.current.toggleMeasure());
    rerender({ view: "elevation" });
    expect(result.current.mode).toEqual({ kind: "measure" });

    rerender({ view: "plan" });
    expect(result.current.mode).toEqual({ kind: "measure" });

    rerender({ view: "3d" });
    expect(result.current.mode).toEqual({ kind: "idle" });
  });
});
