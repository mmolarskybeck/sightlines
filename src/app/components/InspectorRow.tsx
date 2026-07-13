import type { ReactNode } from "react";

// Label-left / control-right row for a single full-width secondary control —
// the Status, Finish, and Type selects that sit below the primary length
// fields. The label reuses the `.field-row > span` voice so a row reads like
// the rest of the inspector; `hint` renders as a `.field-hint` under the
// control cell.
//
// The control association is always programmatic (WCAG AA): pass `htmlFor`
// when the control owns a stable id and the label points at it; omit it and
// the whole row becomes the `<label>`, wrapping the control so the browser
// still ties them together. Never render this with no association — a bare
// `<span>` label leaves the control unnamed.
export function InspectorRow({
  children,
  hint,
  htmlFor,
  label
}: {
  children: ReactNode;
  hint?: string;
  htmlFor?: string;
  label: string;
}) {
  const labelCell = htmlFor ? (
    <label className="inspector-row-label" htmlFor={htmlFor}>
      {label}
    </label>
  ) : (
    <span className="inspector-row-label">{label}</span>
  );

  const body = (
    <>
      {labelCell}
      <div className="inspector-row-control">
        {children}
        {hint ? <p className="field-hint">{hint}</p> : null}
      </div>
    </>
  );

  // With an explicit htmlFor the label is its own element, so the row is a
  // plain grid; without one the row itself is the label so the wrapped
  // control is programmatically named.
  return htmlFor ? (
    <div className="inspector-row">{body}</div>
  ) : (
    <label className="inspector-row">{body}</label>
  );
}
