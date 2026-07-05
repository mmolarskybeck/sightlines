import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "./utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, type = "button", ...props }, ref) => {
    const Component = asChild ? Slot : "button";

    return (
      <Component
        ref={ref}
        className={cn("button", className)}
        type={asChild ? undefined : type}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
