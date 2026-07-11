import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "./utils";

/* Soft segmented track: a recessed grey rail (.seg-track) whose active item
   is marked by one raised white chip (.seg-chip) that slides between
   segments. Radix keeps the semantics (Tabs or ToggleGroup); the chip is a
   purely presentational sibling positioned off the active trigger's
   measured box, so any mix of segment widths works. Until the first
   measurement lands, the CSS fallback paints the active item as its own
   chip, so there is no unstyled flash (and no-JS still reads correctly). */

function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

function useSlidingChip(listRef: React.RefObject<HTMLDivElement | null>) {
  const chipRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const chip = chipRef.current;
    if (!list || !chip) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>(
        ':scope > [data-state="active"], :scope > [data-state="on"]'
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
    const mutations = new MutationObserver(measure);
    mutations.observe(list, {
      attributes: true,
      attributeFilter: ["data-state"],
      subtree: true
    });
    const resizes = new ResizeObserver(measure);
    resizes.observe(list);
    for (const child of Array.from(list.children)) {
      resizes.observe(child);
    }

    return () => {
      mutations.disconnect();
      resizes.disconnect();
    };
  }, [listRef]);

  return chipRef;
}

export const SegmentedTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const chipRef = useSlidingChip(listRef);

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
  const chipRef = useSlidingChip(listRef);

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
