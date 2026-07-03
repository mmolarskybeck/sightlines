// Two states, matching the two reasons the Elevation tab can have nothing
// to draw: no rooms exist yet, or rooms exist but no wall is selected. The
// glyph is decorative shorthand for "a wall elevation" (outline + a
// centerline hint, echoing the real elevation drawing's own `.wall-fill`/
// `.centerline` treatment) — it carries no information of its own, so it's
// hidden from assistive tech and the copy alone stays the readable message.
export function ElevationEmptyState({ hasRooms }: { hasRooms: boolean }) {
  const copy = hasRooms
    ? "Select a wall from the Gallery list to see its elevation."
    : "Add a room, then select a wall to see its elevation.";

  return (
    <div className="drawing-surface-empty">
      <div className="elevation-empty">
        <svg
          aria-hidden="true"
          className="elevation-empty-glyph"
          focusable="false"
          viewBox="0 0 120 84"
        >
          <rect height="68" rx="2" width="104" x="8" y="8" />
          <line strokeDasharray="4 4" x1="8" x2="112" y1="42" y2="42" />
        </svg>
        <p className="empty-copy">{copy}</p>
      </div>
    </div>
  );
}
