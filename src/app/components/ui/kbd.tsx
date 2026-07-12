import * as React from "react";
import { cn } from "./utils";

// A single keyboard key rendered as a shadcn-style chip: a monospace glyph in
// a square, hairline-bordered tile (see `.kbd` in global.css). Use it for real
// keys only — gesture/connector words render as plain text alongside it.
export const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd ref={ref} className={cn("kbd", className)} {...props} />
  )
);
Kbd.displayName = "Kbd";
