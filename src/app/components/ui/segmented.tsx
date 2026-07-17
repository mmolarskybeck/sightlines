import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "./utils";

/* Two sliding-indicator tab families sharing one measuring hook.

   Soft segmented track: a recessed grey rail (.seg-track) whose active item
   is marked by one raised white chip (.seg-chip) that slides between
   segments — for value pickers (filters, units, arrange modes).

   Underline tabs: transparent .tabs-underline rail whose active item is
   marked by a 2px petrol underline (.seg-underline) that slides the same
   way — for navigation (the topbar view modes).

   Radix keeps the semantics (Tabs or ToggleGroup); the indicator is a
   purely presentational sibling positioned off the active trigger's
   measured box, so any mix of segment widths works. Until the first
   measurement lands, a CSS fallback paints the active item's own chip or
   underline, so there is no unstyled flash (and no-JS still reads
   correctly). */

function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

function useSlidingIndicator(listRef: React.RefObject<HTMLDivElement | null>) {
  const indicatorRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const chip = indicatorRef.current;
    if (!list || !chip) return;

    const measure = () => {
      // Match on ARIA state, not data-state: wrapping a trigger in a Radix
      // TooltipTrigger (topbar tooltips) makes Tooltip clobber data-state
      // with "closed"/"open", while aria-selected/aria-checked stay owned by
      // Tabs/ToggleGroup.
      const active = list.querySelector<HTMLElement>(
        ':scope > [aria-selected="true"], :scope > [aria-checked="true"], :scope > [data-state="active"], :scope > [data-state="on"]'
      );
      if (!active) {
        // Nothing selected (possible in a type="single" toggle group):
        // drop back to the CSS fallback and hide the chip.
        list.removeAttribute("data-seg-ready");
        return;
      }
      chip.style.width = `${active.offsetWidth}px`;
      chip.style.transform = `translateX(${active.offsetLeft}px)`;
      list.setAttribute("data-seg-ready", "");
    };

    measure();

    // Radix flips data-state on the triggers when the selection moves;
    // resizes (font load, container squeeze, label swap) re-measure too.
    // Both observers are guarded for non-browser environments (jsdom has
    // no ResizeObserver); there the one-shot measure above still runs.
    const mutations =
      typeof MutationObserver !== "undefined" ? new MutationObserver(measure) : null;
    mutations?.observe(list, {
      attributes: true,
      attributeFilter: ["data-state", "aria-selected", "aria-checked"],
      subtree: true
    });
    const resizes =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (resizes) {
      resizes.observe(list);
      for (const child of Array.from(list.children)) {
        resizes.observe(child);
      }
    }

    return () => {
      mutations?.disconnect();
      resizes?.disconnect();
    };
  }, [listRef]);

  return indicatorRef;
}

export const SegmentedTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const chipRef = useSlidingIndicator(listRef);

  return (
    <TabsPrimitive.List
      ref={composeRefs(ref, listRef)}
      className={cn("seg-track", className)}
      {...props}
    >
      <div aria-hidden className="seg-chip" ref={chipRef} />
      {children}
    </TabsPrimitive.List>
  );
});

SegmentedTabsList.displayName = "SegmentedTabsList";

export const SegmentedTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn("seg-item", className)} {...props} />
));

SegmentedTabsTrigger.displayName = "SegmentedTabsTrigger";

export const SegmentedToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const chipRef = useSlidingIndicator(listRef);

  return (
    <ToggleGroupPrimitive.Root
      ref={composeRefs(ref, listRef)}
      className={cn("seg-track", className)}
      {...props}
    >
      <div aria-hidden className="seg-chip" ref={chipRef} />
      {children}
    </ToggleGroupPrimitive.Root>
  );
});

SegmentedToggleGroup.displayName = "SegmentedToggleGroup";

export const SegmentedToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item ref={ref} className={cn("seg-item", className)} {...props} />
));

SegmentedToggleGroupItem.displayName = "SegmentedToggleGroupItem";

export const UnderlineTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const indicatorRef = useSlidingIndicator(listRef);

  return (
    <TabsPrimitive.List
      ref={composeRefs(ref, listRef)}
      className={cn("tabs-underline", className)}
      {...props}
    >
      <div aria-hidden className="seg-underline" ref={indicatorRef} />
      {children}
    </TabsPrimitive.List>
  );
});

UnderlineTabsList.displayName = "UnderlineTabsList";

export const UnderlineTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn("tab-button", className)} {...props} />
));

UnderlineTabsTrigger.displayName = "UnderlineTabsTrigger";

export const UnderlineToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const indicatorRef = useSlidingIndicator(listRef);

  return (
    <ToggleGroupPrimitive.Root
      ref={composeRefs(ref, listRef)}
      className={cn("tabs-underline", className)}
      {...props}
    >
      <div aria-hidden className="seg-underline" ref={indicatorRef} />
      {children}
    </ToggleGroupPrimitive.Root>
  );
});

UnderlineToggleGroup.displayName = "UnderlineToggleGroup";

export const UnderlineToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item ref={ref} className={cn("tab-button", className)} {...props} />
));

UnderlineToggleGroupItem.displayName = "UnderlineToggleGroupItem";
