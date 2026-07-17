import type { ReactNode } from "react";
import { Field } from "../ui/field";

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
  return (
    <Field htmlFor={htmlFor} label={label} layout="inline" message={hint}>
      {children}
    </Field>
  );
}
