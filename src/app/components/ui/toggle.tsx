import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cn } from "./utils";

export const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root>
>(({ className, ...props }, ref) => (
  <TogglePrimitive.Root ref={ref} className={cn("toggle", className)} {...props} />
));

Toggle.displayName = TogglePrimitive.Root.displayName;
