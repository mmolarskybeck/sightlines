import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { cn } from "./utils";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root ref={ref} className={cn("checkbox-control", className)} {...props}>
    <CheckboxPrimitive.Indicator className="checkbox-indicator">
      <CheckIcon aria-hidden="true" className="checkbox-check-icon" size={12} weight="bold" />
      <MinusIcon
        aria-hidden="true"
        className="checkbox-indeterminate-icon"
        size={12}
        weight="bold"
      />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
