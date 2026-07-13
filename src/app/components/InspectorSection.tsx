import type { ReactNode } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

// One inspector section: hairline-separated row over a body of fields. Built
// for the right inspector's quiet register — structure via hairlines and
// spacing, no cards — and adoptable by any inspector, though only
// ArtworkInspector uses it today.
//
// Collapsible by default: a full-width header trigger (title + at-rest
// summary + trailing chevron) opens a Radix-animated body. Collapsed is never
// information lost: `summary` shows the section's current value at rest
// (muted, tabular-nums via CSS) and disappears when open — the body then
// carries the real fields. `headerExtras` (e.g. the Dimensions lock toggle)
// render beside the trigger only while open; a hidden section must not offer
// a live control. They're siblings of the trigger, not children — a button
// cannot nest inside a button.
//
// `collapsible={false}` drops the disclosure entirely: no Radix Collapsible,
// no chevron, no trigger — just a plain header row (an <h3> in the same row
// chrome so it lines up with collapsible siblings) over an always-open body.
// `open`/`onOpenChange` are ignored in that mode, and `summary`/`headerExtras`
// (both tied to the collapsed/open flip) have nothing to key off, so callers
// leave them out. Used for the panel's always-present anchors (identity).
//
// `action` is a right-aligned header affordance visible open OR closed —
// unlike `headerExtras`, which the collapsed state hides. Like the extras it
// is a sibling of the trigger, never a child (no button-in-button).
export function InspectorSection({
  action,
  children,
  collapsible = true,
  headerExtras,
  onOpenChange,
  open,
  summary,
  title,
  titleAdornment
}: {
  action?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  headerExtras?: ReactNode;
  // Optional so `collapsible={false}` callers, which have no open/close state
  // to drive, can omit them; the collapsible path still expects both.
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  summary?: ReactNode;
  title: string;
  // Non-interactive status content (e.g. the dimensions uncertainty badge)
  // rendered inside the trigger right after the title — visible open OR
  // closed, and allowed to shrink before the title does. Must never contain
  // a control: the trigger is a button.
  titleAdornment?: ReactNode;
}) {
  if (!collapsible) {
    return (
      <div className="inspector-section inspector-section-static">
        <div className="inspector-section-header">
          <h3 className="inspector-section-title">{title}</h3>
          {titleAdornment}
          {action ? <div className="inspector-section-action">{action}</div> : null}
        </div>
        <div className="inspector-section-body">{children}</div>
      </div>
    );
  }

  return (
    <Collapsible className="inspector-section" open={open} onOpenChange={onOpenChange}>
      <div className="inspector-section-header">
        {/* Title leads and the chevron trails (Linear-style disclosure row):
            a leading chevron indented every title ~18px past the flush-left
            body content below it, which read as the header being narrower
            than its own section. */}
        <CollapsibleTrigger className="inspector-section-trigger">
          <span className="inspector-section-title">{title}</span>
          {titleAdornment}
          {!open && summary ? (
            <span className="inspector-section-summary">{summary}</span>
          ) : null}
          <CaretRightIcon aria-hidden="true" className="inspector-section-chevron" size={11} />
        </CollapsibleTrigger>
        {open && headerExtras ? (
          <div className="inspector-section-extras">{headerExtras}</div>
        ) : null}
        {action ? <div className="inspector-section-action">{action}</div> : null}
      </div>
      <CollapsibleContent>
        <div className="inspector-section-body">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
