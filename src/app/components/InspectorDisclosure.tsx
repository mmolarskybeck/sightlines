import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

// A Radix Collapsible with NONE of InspectorSection's row chrome — no
// hairline, no chevron, no full-width header. Just a small ghost text-button
// trigger (with an optional summary sitting beside it) opening an animated
// body. This is the in-section "Edit details" / "Edit overall" affordance:
// a secondary disclosure nested inside a section that is already open, where a
// second layer of section chrome would read as a card-in-a-card.
//
// The trigger is a real <button> (Radix Trigger), so it carries aria-expanded
// and aria-controls for free. `expandLabel` shows while closed; `collapseLabel`
// (falling back to `expandLabel`) shows while open — pass both when the verb
// should flip ("Edit details" ↔ "Done").
export function InspectorDisclosure({
  children,
  collapseLabel,
  expandLabel,
  onOpenChange,
  open,
  summary
}: {
  children: ReactNode;
  collapseLabel?: string;
  expandLabel: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  summary?: ReactNode;
}) {
  return (
    <Collapsible className="inspector-disclosure" open={open} onOpenChange={onOpenChange}>
      <div className="inspector-disclosure-header">
        <CollapsibleTrigger className="inspector-disclosure-trigger">
          {open ? collapseLabel ?? expandLabel : expandLabel}
        </CollapsibleTrigger>
        {summary ? <span className="inspector-disclosure-summary">{summary}</span> : null}
      </div>
      <CollapsibleContent>
        <div className="inspector-disclosure-body">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
