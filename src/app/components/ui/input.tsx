import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const inputVariants = cva(
  "input-control flex w-full border border-input bg-background text-foreground font-[var(--weight-medium)] outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-out placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45 read-only:bg-surface read-only:text-muted-foreground",
  {
    variants: {
      variant: {
        default: "rounded-sm",
        title:
          "rounded-sm border-0 bg-transparent font-[var(--weight-strong)] text-foreground hover:border-0 hover:bg-surface focus-visible:bg-background focus-visible:ring-offset-0"
      },
      size: {
        default: "min-h-[38px] px-2.5 py-2 text-[var(--type-md)]",
        compact: "min-h-8 px-2 py-1.5 text-[var(--type-sm)]",
        title: "min-h-0 px-1.5 py-[3px] text-[var(--type-project)]"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> &
  VariantProps<typeof inputVariants>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, variant, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(inputVariants({ size, variant }), className)}
      {...props}
    />
  )
);

Input.displayName = "Input";
