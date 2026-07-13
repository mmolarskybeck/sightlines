import type { ReactNode } from "react";

// An optionally-labeled row of one-click action buttons — the generalization
// of OpeningInspector's `.opening-add-row` / `.opening-add-buttons` (the
// "Add a door / window / blocked zone" chips). Consumers pass `Button
// variant="inspector"` chips as children; the group lays them out as a
// wrapping row set slightly apart from the field grids above it, so a burst
// of verbs reads as "act on this" rather than as more data to type.
//
// Purely presentational: the buttons carry their own handlers, disabled, and
// focus states. `label` is a quiet caption for the set (e.g. "Add opening")
// and is omitted when the buttons name themselves.
export function InspectorActionGroup({
  children,
  label
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="inspector-action-group">
      {label ? <span className="inspector-action-group-label">{label}</span> : null}
      <div className="inspector-action-group-buttons">{children}</div>
    </div>
  );
}
