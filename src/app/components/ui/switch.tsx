import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <SwitchPrimitive.Root ref={ref} className={cn("switch", className)} {...props}>
    {children}
    <SwitchPrimitive.Thumb className="switch-thumb" />
  </SwitchPrimitive.Root>
));

Switch.displayName = SwitchPrimitive.Root.displayName;
