import type { ReactNode } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

// One collapsible inspector section: hairline-separated row with a
// full-width header trigger (chevron + title + at-rest summary) and a
// Radix-animated body. Built for the right inspector's quiet register —
// structure via hairlines and spacing, no cards — and adoptable by any
// inspector, though only ArtworkInspector uses it today.
//
// Collapsed is never information lost: `summary` shows the section's current
// value at rest (muted, tabular-nums via CSS) and disappears when open —
// the body then carries the real fields. `headerExtras` (e.g. the Dimensions
// lock toggle) render beside the trigger only while open; a hidden section
// must not offer a live control. They're siblings of the trigger, not
// children — a button cannot nest inside a button.
export function InspectorSection({
  children,
  headerExtras,
  onOpenChange,
  open,
  summary,
  title,
  titleAdornment
}: {
  children: ReactNode;
  headerExtras?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  summary?: ReactNode;
  title: string;
  // Non-interactive status content (e.g. the dimensions uncertainty badge)
  // rendered inside the trigger right after the title — visible open OR
  // closed, and allowed to shrink before the title does. Must never contain
  // a control: the trigger is a button.
  titleAdornment?: ReactNode;
}) {
  return (
    <Collapsible className="inspector-section" open={open} onOpenChange={onOpenChange}>
      <div className="inspector-section-header">
        <CollapsibleTrigger className="inspector-section-trigger">
          <CaretRightIcon aria-hidden="true" className="inspector-section-chevron" size={11} />
          <span className="inspector-section-title">{title}</span>
          {titleAdornment}
          {!open && summary ? (
            <span className="inspector-section-summary">{summary}</span>
          ) : null}
        </CollapsibleTrigger>
        {open && headerExtras ? (
          <div className="inspector-section-extras">{headerExtras}</div>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className="inspector-section-body">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
