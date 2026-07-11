import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

export const toggleVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm text-[var(--type-sm)] font-[var(--weight-medium)] leading-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 data-[state=on]:bg-petrol-soft data-[state=on]:text-petrol-strong data-[state=on]:shadow-[var(--shadow-pressed)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-transparent bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground hover:bg-surface hover:text-foreground",
        rail:
          "border border-transparent bg-transparent text-muted-foreground hover:bg-surface hover:text-foreground",
        tab:
          "rounded-none border-0 bg-transparent text-muted-foreground hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground data-[state=on]:shadow-[inset_0_-2px_0_var(--primary)]"
      },
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 px-2 text-[var(--type-xs)]",
        icon: "size-9 p-0",
        rail: "size-12 p-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, size, variant, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size }), className)}
    {...props}
  />
));

Toggle.displayName = TogglePrimitive.Root.displayName;
