import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "./utils";

// Slim, square-ish determinate bar in the house's quiet-neutral register. The
// Radix Root/Indicator pair carries progressbar semantics (value/max/valuenow)
// for assistive technology; the fill is a plain translate so the browser can
// composite it without laying out on every tick.
export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, max = 100, ...props }, ref) => {
  const percent = max > 0 ? Math.min(100, Math.max(0, ((value ?? 0) / max) * 100)) : 0;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "progress relative h-1.5 w-full overflow-hidden rounded-sm bg-[var(--surface-strong)]",
        className
      )}
      value={value}
      max={max}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="progress-indicator h-full w-full flex-1 rounded-sm bg-[var(--primary)] transition-transform duration-200 ease-out"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});

Progress.displayName = ProgressPrimitive.Root.displayName;
