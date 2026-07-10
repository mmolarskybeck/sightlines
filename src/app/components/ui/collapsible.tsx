import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { cn } from "./utils";

// Thin Radix wrapper in the local shadcn style (see select.tsx): Radix owns
// the open/close behavior and a11y wiring (aria-expanded, aria-controls,
// Presence-during-exit for animations); we own the file. Visual identity is
// deliberately NOT baked in here — consumers like InspectorSection compose
// their own Sightlines look from global.css classes. Content carries only the
// open/close motion, driven by Radix's data-state attribute and its measured
// --radix-collapsible-content-height variable (keyframes in global.css;
// prefers-reduced-motion collapses them to instant via the global rule).
export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

export const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    className={cn("collapsible-content", className)}
    {...props}
  />
));

CollapsibleContent.displayName = CollapsiblePrimitive.Content.displayName;
