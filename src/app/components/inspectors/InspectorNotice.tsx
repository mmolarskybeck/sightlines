import type { ReactNode } from "react";

// A quiet filled note in the inspector's register (small radius, --type-xs) —
// the generalization of OpeningInspector's `.opening-connection-status`
// aligned/misaligned line. `tone` picks the wash: `positive` reads petrol-soft
// (the "aligned" look), `caution` reads amber-soft ("misaligned"), `info`
// sits on the neutral surface. Every tone pairs its wash with a strong-enough
// text token to clear WCAG AA (≥ 4.5:1) — mirroring how the connection status
// keeps petrol-strong on petrol-soft rather than dropping to a mid grey.
//
// `icon` and `action` are optional slots (icon leads, action trails); the
// primitive ships no default icon, so a consumer that wants one passes a
// Phosphor glyph. Not a live region by default — a consumer echoing a
// changing status can add role="status" on its own wrapper.
export function InspectorNotice({
  action,
  children,
  icon,
  tone
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  tone: "info" | "caution" | "positive";
}) {
  return (
    <div className={`inspector-notice ${tone}`}>
      {icon ? (
        <span aria-hidden="true" className="inspector-notice-icon">
          {icon}
        </span>
      ) : null}
      <span className="inspector-notice-body">{children}</span>
      {action ? <span className="inspector-notice-action">{action}</span> : null}
    </div>
  );
}
