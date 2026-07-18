import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InsertToolKind } from "../../domain/placement/createOpening";
import type { ViewMode } from "../store";
import { useToolbarShortcuts } from "./useToolbarShortcuts";

function renderHarness(
  overrides: {
    viewMode?: ViewMode;
    suspended?: boolean;
    insertDisabled?: boolean;
    activeTool?: InsertToolKind | null;
  } = {}
) {
  // One harness at a time: each keydown is dispatched once and the handler
  // calls preventDefault, so a leftover mounted harness would swallow the next
  // press via event.defaultPrevented. cleanup() keeps every render isolated.
  cleanup();
  const handlers = {
    armOpeningTool: vi.fn((_tool: InsertToolKind | null) => {}),
    togglePartitionTool: vi.fn(() => {}),
    toggleDrawRect: vi.fn(() => {}),
    toggleDrawRoom: vi.fn(() => {}),
    toggleMeasure: vi.fn(() => {}),
    toggleShowGrid: vi.fn(() => {}),
    toggleSnapToGrid: vi.fn(() => {}),
    toggleAllowOverlappingPlacement: vi.fn(() => {}),
    toggleShowCenterline: vi.fn(() => {})
  };

  function Harness() {
    useToolbarShortcuts({
      viewMode: overrides.viewMode ?? "plan",
      suspended: overrides.suspended ?? false,
      insertDisabled: overrides.insertDisabled ?? false,
      activeTool: overrides.activeTool ?? null,
      ...handlers
    });
    return <input data-testid="field" />;
  }

  render(<Harness />);
  return handlers;
}

function press(key: string, init: KeyboardEventInit = {}, target?: EventTarget) {
  act(() => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    (target ?? window).dispatchEvent(event);
  });
}

afterEach(cleanup);

describe("useToolbarShortcuts", () => {
  it("arms an opening tool on its key and disarms it when already armed", () => {
    const armed = renderHarness();
    press("d");
    expect(armed.armOpeningTool).toHaveBeenCalledWith("door");

    const already = renderHarness({ activeTool: "door" });
    press("d");
    expect(already.armOpeningTool).toHaveBeenCalledWith(null);
  });

  it("maps W/B to window and blocked-zone", () => {
    const handlers = renderHarness();
    press("w");
    press("b");
    expect(handlers.armOpeningTool).toHaveBeenNthCalledWith(1, "window");
    expect(handlers.armOpeningTool).toHaveBeenNthCalledWith(2, "blocked-zone");
  });

  it("scopes the Case tool (C) to plan only", () => {
    const plan = renderHarness({ viewMode: "plan" });
    press("c");
    expect(plan.armOpeningTool).toHaveBeenCalledWith("case");

    const elevation = renderHarness({ viewMode: "elevation" });
    press("c");
    expect(elevation.armOpeningTool).not.toHaveBeenCalled();
  });

  it("toggles the view options in both 2D views", () => {
    const plan = renderHarness({ viewMode: "plan" });
    press("g");
    press("s");
    press("o");
    expect(plan.toggleShowGrid).toHaveBeenCalledTimes(1);
    expect(plan.toggleSnapToGrid).toHaveBeenCalledTimes(1);
    expect(plan.toggleAllowOverlappingPlacement).toHaveBeenCalledTimes(1);
  });

  it("maps M to Measure in both 2D views", () => {
    const plan = renderHarness({ viewMode: "plan" });
    press("m");
    expect(plan.toggleMeasure).toHaveBeenCalledTimes(1);

    const elevation = renderHarness({ viewMode: "elevation" });
    press("M", { shiftKey: true });
    expect(elevation.toggleMeasure).toHaveBeenCalledTimes(1);
  });

  it("scopes Partition and the room-draw tools to plan only", () => {
    const plan = renderHarness({ viewMode: "plan" });
    press("p");
    press("r");
    expect(plan.togglePartitionTool).toHaveBeenCalledTimes(1);
    expect(plan.toggleDrawRect).toHaveBeenCalledTimes(1);

    const elevation = renderHarness({ viewMode: "elevation" });
    press("p");
    press("r");
    expect(elevation.togglePartitionTool).not.toHaveBeenCalled();
    expect(elevation.toggleDrawRect).not.toHaveBeenCalled();
    expect(elevation.toggleDrawRoom).not.toHaveBeenCalled();
  });

  it("maps R to the rectangle room and ⇧R to the polygon outline", () => {
    const plain = renderHarness({ viewMode: "plan" });
    press("r");
    expect(plain.toggleDrawRect).toHaveBeenCalledTimes(1);
    expect(plain.toggleDrawRoom).not.toHaveBeenCalled();

    // Uppercase "R" with shift held selects the outline variant instead.
    const shifted = renderHarness({ viewMode: "plan" });
    press("R", { shiftKey: true });
    expect(shifted.toggleDrawRoom).toHaveBeenCalledTimes(1);
    expect(shifted.toggleDrawRect).not.toHaveBeenCalled();
  });

  it("scopes Eyeline to elevation only", () => {
    const elevation = renderHarness({ viewMode: "elevation" });
    press("e");
    expect(elevation.toggleShowCenterline).toHaveBeenCalledTimes(1);

    const plan = renderHarness({ viewMode: "plan" });
    press("e");
    expect(plan.toggleShowCenterline).not.toHaveBeenCalled();
  });

  it("makes the opening keys no-ops when insert is disabled", () => {
    const handlers = renderHarness({ viewMode: "elevation", insertDisabled: true });
    press("d");
    press("w");
    press("b");
    expect(handlers.armOpeningTool).not.toHaveBeenCalled();
  });

  it("never fires in 3D, where WASD owns the letters", () => {
    const handlers = renderHarness({ viewMode: "3d" });
    press("g");
    press("w");
    press("m");
    expect(handlers.toggleShowGrid).not.toHaveBeenCalled();
    expect(handlers.armOpeningTool).not.toHaveBeenCalled();
    expect(handlers.toggleMeasure).not.toHaveBeenCalled();
  });

  it("stands down while a dialog is open", () => {
    const handlers = renderHarness({ suspended: true });
    press("g");
    press("d");
    press("m");
    expect(handlers.toggleShowGrid).not.toHaveBeenCalled();
    expect(handlers.armOpeningTool).not.toHaveBeenCalled();
    expect(handlers.toggleMeasure).not.toHaveBeenCalled();
  });

  it("ignores modifier chords, auto-repeat, and editable targets", () => {
    const handlers = renderHarness();
    press("g", { metaKey: true });
    press("g", { ctrlKey: true });
    press("g", { altKey: true });
    press("g", { repeat: true });
    expect(handlers.toggleShowGrid).not.toHaveBeenCalled();

    press("g", {}, document.querySelector('[data-testid="field"]') as EventTarget);
    expect(handlers.toggleShowGrid).not.toHaveBeenCalled();
  });
});
