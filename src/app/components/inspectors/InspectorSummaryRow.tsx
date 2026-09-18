import type { ReactNode } from "react";

// A read-only readout row: muted label left, value right-aligned in tabular
// numerals, with an optional inline ghost action after the value. This is the
// "derived values read quieter than editable anchors" primitive — the Overall
// footprint at rest, a computed hang height, a running total. It is never an
// input by design; if the number is editable it belongs in an InspectorRow /
// LengthField, not here.
//
// THREE COLUMNS, NOT A WRAPPING FLEX ROW. Label, value and action each own a
// column, so the action stays on the row's right edge and a long value shrinks
// and wraps inside its own cell instead of shoving the action onto a line of
// its own. `hint` is the escape valve that keeps the value short: a second
// quiet `.field-hint` line spanning the whole row, for the qualifier the value
// would otherwise have to carry inline ("Same as work", a support's
// dimensions). Use it whenever the value would grow past a few words —
// at the inspector's 300px there is no room for a sentence in the value cell.
export function InspectorSummaryRow({
  action,
  hint,
  label,
  value
}: {
  action?: ReactNode;
  hint?: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="inspector-summary-row">
      <span className="inspector-summary-row-label">{label}</span>
      <span className="inspector-summary-row-value">{value}</span>
      {action ? <span className="inspector-summary-row-action">{action}</span> : null}
      {hint ? <p className="field-hint inspector-summary-row-hint">{hint}</p> : null}
    </div>
  );
}
