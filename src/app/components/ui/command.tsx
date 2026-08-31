import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "./utils";

// The shadcn Command wrapper over cmdk, trimmed to the parts this app uses: a
// root, a listbox, and its options. There is deliberately no CommandInput —
// the one consumer (ui/combobox.tsx) keeps its text input OUTSIDE the popup so
// the field itself stays the control a curator types into — and no
// CommandDialog, since nothing here is a command palette.
//
// Styling mirrors ui/select.tsx and ui/dropdown-menu.tsx so a Command list
// reads as a sibling of those menus; the one divergence is the highlight
// attribute, which cmdk writes as `data-selected` where Radix writes
// `data-highlighted`.

export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "command flex w-full flex-col overflow-hidden text-popover-foreground",
      className
    )}
    {...props}
  />
));

Command.displayName = "Command";

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      "command-list max-h-72 overflow-y-auto overflow-x-hidden p-1",
      className
    )}
    {...props}
  />
));

CommandList.displayName = "CommandList";

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "command-item relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 [font-size:var(--type-sm)] outline-none transition-colors duration-150 ease-out data-[disabled=true]:pointer-events-none data-[selected=true]:bg-surface data-[disabled=true]:opacity-45",
      className
    )}
    {...props}
  />
));

CommandItem.displayName = "CommandItem";
