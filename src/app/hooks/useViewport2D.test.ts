import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useViewport2D } from "./useViewport2D";
import { FIT_VIEWPORT, type Viewport2D } from "../../domain/viewport/viewport2d";

const MANUAL: Viewport2D = { mode: "manual", centerXMm: 1000, centerYMm: 2000, zoom: 3 };

describe("useViewport2D", () => {
  it("starts at FIT_VIEWPORT", () => {
    const { result } = renderHook(() => useViewport2D("project-a"));
    expect(result.current[0]).toEqual(FIT_VIEWPORT);
  });

  it("setViewport updates the current viewport", () => {
    const { result } = renderHook(() => useViewport2D("project-a"));

    act(() => {
      result.current[1](MANUAL);
    });

    expect(result.current[0]).toEqual(MANUAL);
  });

  it("preserves a manual viewport across a same-key rerender", () => {
    const { result, rerender } = renderHook(({ key }) => useViewport2D(key), {
      initialProps: { key: "project-a" }
    });

    act(() => {
      result.current[1](MANUAL);
    });
    rerender({ key: "project-a" });

    expect(result.current[0]).toEqual(MANUAL);
  });

  it("resets to FIT_VIEWPORT when the reset key changes", () => {
    const { result, rerender } = renderHook(({ key }) => useViewport2D(key), {
      initialProps: { key: "project-a" }
    });

    act(() => {
      result.current[1](MANUAL);
    });
    expect(result.current[0]).toEqual(MANUAL);

    rerender({ key: "project-b" });
    expect(result.current[0]).toEqual(FIT_VIEWPORT);
  });

  it("keeps a stable setViewport identity across rerenders", () => {
    const { result, rerender } = renderHook(({ key }) => useViewport2D(key), {
      initialProps: { key: "project-a" }
    });

    const setViewport = result.current[1];
    rerender({ key: "project-a" });

    expect(result.current[1]).toBe(setViewport);
  });
});
