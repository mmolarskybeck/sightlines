import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";

// The Plan tab's own empty state, mirroring ElevationEmptyState's idiom: a
// decorative aria-hidden glyph (a stroked room rectangle with two resize
// handles, echoing the real plan drawing's `.room-fill`/`.resize-handle`
// treatment) over copy that carries the readable message, plus a real
// primary action so a first-time curator can draw a room without hunting for
// the Rooms panel's add button.
export function PlanEmptyState({ onAddRoom }: { onAddRoom: () => void }) {
  return (
    <div className="drawing-surface-empty">
      <div className="canvas-empty">
        <svg
          aria-hidden="true"
          className="canvas-empty-glyph"
          focusable="false"
          viewBox="0 0 120 84"
        >
          <rect height="52" rx="2" width="84" x="18" y="16" />
          <rect className="handle" height="8" width="8" x="14" y="12" />
          <rect className="handle" height="8" width="8" x="98" y="64" />
        </svg>
        <p className="empty-copy">Draw your first room</p>
        <button className="inspector-action" type="button" onClick={onAddRoom}>
          <PlusIcon aria-hidden="true" size={15} />
          Add a room
        </button>
        <p className="empty-copy">
          …or drop images into the checklist and place them later.
        </p>
      </div>
    </div>
  );
}
