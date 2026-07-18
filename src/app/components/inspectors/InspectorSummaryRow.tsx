import type { ReactNode } from "react";

// A read-only readout row: muted label left, value right-aligned in tabular
// numerals, with an optional inline ghost action after the value. This is the
// "derived values read quieter than editable anchors" primitive — the Overall
// footprint at rest, a computed hang height, a running total. It is never an
// input by design; if the number is editable it belongs in an InspectorRow /
// LengthField, not here.
export function InspectorSummaryRow({
  action,
  label,
  value
}: {
  action?: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="inspector-summary-row">
      <span className="inspector-summary-row-label">{label}</span>
      <span className="inspector-summary-row-value">{value}</span>
      {action ? <span className="inspector-summary-row-action">{action}</span> : null}
    </div>
  );
}
