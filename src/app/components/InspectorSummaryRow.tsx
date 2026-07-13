import type { ReactNode } from "react";

// A read-only readout row: muted label left, value right-aligned in tabular
// numerals, with an optional inline ghost action after the value. This is the
// "derived values read quieter than editable anchors" primitive — the Overall
// footprint at rest, a computed hang height, a running total. It is never an
// input by design; if the number is editable it belongs in an InspectorRow /
// LengthField, not here. `title` supplies a hover expansion for a value the
// cell has to truncate.
export function InspectorSummaryRow({
  action,
  label,
  title,
  value
}: {
  action?: ReactNode;
  label: string;
  title?: string;
  value: ReactNode;
}) {
  return (
    <div className="inspector-summary-row" title={title}>
      <span className="inspector-summary-row-label">{label}</span>
      <span className="inspector-summary-row-value">{value}</span>
      {action ? <span className="inspector-summary-row-action">{action}</span> : null}
    </div>
  );
}
