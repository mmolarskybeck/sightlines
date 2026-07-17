import type { ReactNode } from "react";

// Thin wrapper over the two inspector field-grid classes so consumers name
// intent (a 2- or 3-column row of compact fields) instead of remembering
// which bespoke class is which. `columns={2}` is the generic X·Y / Width·
// Height pair grid; `columns={3}` is the artwork Width | Height | Depth trio.
//
// The trio still borrows `.artwork-dimensions-grid` — a later cleanup task
// renames that class to a column-count-neutral name; this wrapper is the seam
// that makes the rename a one-line change here rather than a sweep across
// every call site. Don't rename it now.
export function InspectorFieldGrid({
  children,
  columns
}: {
  children: ReactNode;
  columns: 2 | 3;
}) {
  return (
    <div className={columns === 2 ? "field-pair-grid" : "artwork-dimensions-grid"}>
      {children}
    </div>
  );
}
