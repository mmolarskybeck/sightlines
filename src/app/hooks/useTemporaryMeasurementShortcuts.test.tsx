import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MeasurementToolState } from "./useMeasurementTool";
import {
  temporaryMeasurementShortcutAction,
  temporaryMeasurementShortcutDecision,
  useTemporaryMeasurementShortcuts
} from "./useTemporaryMeasurementShortcuts";

const complete: MeasurementToolState = {
  phase: "armed-complete",
  context: { kind: "plan" },
  start: { xMm: 0, yMm: 0 },
  end: { xMm: 100, yMm: 0 }
};

function key(key: string, overrides: Partial<KeyboardEvent> = {}) {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, ...overrides } as KeyboardEvent;
}

afterEach(cleanup);

describe("temporaryMeasurementShortcutAction", () => {
  it("clears a completed temporary measurement on Delete or local Undo", () => {
    expect(temporaryMeasurementShortcutAction(complete, key("Delete"))).toEqual({ type: "clear" });
    expect(temporaryMeasurementShortcutAction(complete, key("z", { metaKey: true }))).toEqual({ type: "clear" });
  });

  it("undoes drawing and refinement without creating redo behavior", () => {
    const drawing: MeasurementToolState = {
      phase: "drawing",
      context: { kind: "plan" },
      start: { xMm: 0, yMm: 0 },
      preview: { xMm: 50, yMm: 20 }
    };
    const refining: MeasurementToolState = {
      ...complete,
      phase: "refining",
      endpoint: "end",
      original: complete.end
    };
    expect(temporaryMeasurementShortcutAction(drawing, key("z", { ctrlKey: true }))).toEqual({ type: "clear" });
    expect(temporaryMeasurementShortcutAction(refining, key("z", { metaKey: true }))).toEqual({ type: "cancel-refinement" });
    expect(temporaryMeasurementShortcutAction(complete, key("z", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(temporaryMeasurementShortcutAction(complete, key("y", { ctrlKey: true }))).toBeNull();
  });

  it("owns plain Delete throughout Measure without disturbing an in-progress Point A", () => {
    const empty: MeasurementToolState = { phase: "armed-empty", context: { kind: "plan" } };
    const drawing: MeasurementToolState = {
      phase: "drawing",
      context: { kind: "plan" },
      start: { xMm: 0, yMm: 0 },
      preview: { xMm: 50, yMm: 20 }
    };
    const refining: MeasurementToolState = {
      ...complete,
      phase: "refining",
      endpoint: "end",
      original: complete.end
    };
    expect(temporaryMeasurementShortcutDecision(empty, key("Delete"))).toEqual({
      consume: true,
      action: null
    });
    expect(temporaryMeasurementShortcutDecision(drawing, key("Backspace"))).toEqual({
      consume: true,
      action: null
    });
    expect(temporaryMeasurementShortcutDecision(refining, key("Delete"))).toEqual({
      consume: true,
      action: { type: "clear" }
    });
  });
});

describe("useTemporaryMeasurementShortcuts", () => {
  it("consumes local undo before project history and stands down for editable targets", () => {
    const dispatch = vi.fn();
    const projectUndo = vi.fn();
    function Harness() {
      useTemporaryMeasurementShortcuts({ active: true, suspended: false, state: complete, dispatch });
      return <input aria-label="Name" />;
    }
    render(<Harness />);
    window.addEventListener("keydown", projectUndo);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "clear" });
    expect(projectUndo).not.toHaveBeenCalled();

    act(() => {
      const input = document.querySelector("input")!;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", projectUndo);
  });
});
