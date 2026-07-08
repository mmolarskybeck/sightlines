import { useEffect } from "react";

import { isEditableTarget } from "./isEditableTarget";

export type UseUndoRedoShortcutsParams = {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

// ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Y redoes — the standard modifier-key
// convention, guarded against editable targets so text editing isn't
// hijacked.
export function useUndoRedoShortcuts({ undo, redo }: UseUndoRedoShortcutsParams) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
      } else if (key === "y") {
        event.preventDefault();
        void redo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);
}
