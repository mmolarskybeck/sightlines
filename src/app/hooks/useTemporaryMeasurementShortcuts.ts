import { useEffect, type Dispatch } from "react";

import type { MeasurementToolAction, MeasurementToolState } from "./useMeasurementTool";
import { isEditableTarget } from "./isEditableTarget";

export type UseTemporaryMeasurementShortcutsParams = {
  active: boolean;
  suspended: boolean;
  state: MeasurementToolState;
  dispatch: Dispatch<MeasurementToolAction>;
};

function isOwnedComposite(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null
  );
}

export function temporaryMeasurementShortcutAction(
  state: MeasurementToolState,
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey">
): MeasurementToolAction | null {
  const key = event.key.toLowerCase();
  const undo = (event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey;
  if (undo) {
    if (state.phase === "refining") return { type: "cancel-refinement" };
    if (state.phase === "drawing" || state.phase === "armed-complete") return { type: "clear" };
    return null;
  }
  const plainDelete =
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    (event.key === "Delete" || event.key === "Backspace");
  return plainDelete && (state.phase === "armed-complete" || state.phase === "refining")
    ? { type: "clear" }
    : null;
}

export function temporaryMeasurementShortcutDecision(
  state: MeasurementToolState,
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey">
): { consume: boolean; action: MeasurementToolAction | null } {
  const action = temporaryMeasurementShortcutAction(state, event);
  const plainDelete =
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    (event.key === "Delete" || event.key === "Backspace");
  // While Measure is armed, Delete belongs to its local interaction even when
  // there is nothing to clear. This prevents a stale underlying selection
  // from being deleted. Drawing deliberately keeps Point A intact.
  return { consume: plainDelete || action !== null, action };
}

// Temporary work is deliberately outside project history. Capture phase lets
// this local layer consume its one-step undo before the project undo listener;
// redo and an empty Measure tool fall through unchanged to project history.
export function useTemporaryMeasurementShortcuts({
  active,
  suspended,
  state,
  dispatch
}: UseTemporaryMeasurementShortcutsParams) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!active || suspended || event.defaultPrevented) return;
      if (isEditableTarget(event.target) || isOwnedComposite(event.target)) return;
      const decision = temporaryMeasurementShortcutDecision(state, event);
      if (!decision.consume) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (decision.action) dispatch(decision.action);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, suspended, state, dispatch]);
}
