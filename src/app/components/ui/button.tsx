import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm text-[var(--type-sm)] font-[var(--weight-semibold)] leading-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-border bg-background text-foreground hover:bg-surface hover:text-foreground",
        primary:
          "border border-transparent bg-primary text-primary-foreground hover:bg-petrol-strong",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground hover:bg-surface hover:text-foreground",
        subtle:
          "border border-transparent bg-surface text-foreground hover:bg-surface-strong",
        outline:
          "border border-border bg-background text-foreground hover:bg-surface",
        destructive:
          "border border-destructive bg-destructive text-destructive-foreground hover:brightness-95",
        rail:
          "border border-transparent bg-transparent text-muted-foreground hover:bg-surface hover:text-foreground data-[active=true]:bg-petrol-soft data-[active=true]:text-petrol-strong",
        tab:
          "rounded-none border-0 bg-transparent px-2.5 text-muted-foreground hover:text-foreground data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_-2px_0_var(--primary)]",
        inspector:
          "border border-border bg-surface text-foreground hover:bg-surface-strong"
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5 text-[var(--type-xs)]",
        lg: "h-10 px-4",
        icon: "size-9 p-0",
        "icon-sm": "size-8 p-0",
        rail: "size-12 p-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
  asChild?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, type = "button", variant, ...props }, ref) => {
    const Component = asChild ? Slot : "button";

    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        type={asChild ? undefined : type}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
