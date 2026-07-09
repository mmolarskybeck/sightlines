// The single focused-widget guard for every window-level keyboard shortcut:
// true when the event is aimed at something that owns the key the user just
// pressed, so the shortcut must stand down (LengthFields use Backspace for
// text editing, inputs use ⌘Z for text undo, selects use arrow keys, panel
// splitters use arrows/Home/End, etc.).
//
// Consolidates what were three byte-identical copies (App.tsx's
// delete/escape effect, useUndoRedoShortcuts, useArrangeNudgeShortcuts) plus
// one divergent copy in useSvgViewportGestures. The divergence was SELECT:
// the gestures copy treated native <select> elements as editable, the others
// did not. This helper keeps the superset (SELECT counts as editable) — it
// preserves the gestures behavior exactly, and for the shortcut effects it
// only makes them more conservative on an element that today exists solely
// in the dev-only FontLab (production selects are Radix button triggers).
// Separators are included for the workspace panel resize handles: they are
// keyboard controls whose arrow keys should never be stolen by object nudging.
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    target.closest('[role="separator"]') !== null
  );
}
