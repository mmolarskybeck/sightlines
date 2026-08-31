import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command, CommandItem, CommandList } from "./command";
import { Input } from "./input";
import { cn } from "./utils";

// A FREE-SOLO combobox: the trigger is an ordinary styled text input, any text
// is a valid value, and the popup only OFFERS a short list of known strings.
// It replaces the native <datalist>, whose one fatal behaviour was that a
// committed value filtered the list down to itself — pick "Photograph" once and
// the list looks empty forever after, so switching to another suggestion reads
// as broken. Hence the rule below: filtering happens only while the typed text
// is something no suggestion equals.
//
// The input stays outside the popup (rather than the shadcn command-palette
// arrangement, where a second input lives inside it) because the field IS the
// control: focus never leaves it, so blur/Enter keep committing exactly as they
// do on every other text field in the inspector.

// cmdk highlights its first item whenever its value is empty, which would leave
// a suggestion looking chosen before the user has pressed a key — and Enter
// would then swap their free text for it. Parking the value on a string no
// suggestion can equal is how "nothing is highlighted" stays representable.
const NO_HIGHLIGHT = "\u0000no-highlight";

type ComboboxProps = Omit<
  React.ComponentPropsWithoutRef<typeof Input>,
  "onChange" | "onSelect" | "role" | "value"
> & {
  // The offered strings, in the order they should read. Never a constraint:
  // anything typed is committed as typed.
  suggestions: string[];
  value: string;
  // Free typing. Mirrors an input's onChange, minus the event.
  onValueChange: (next: string) => void;
  // A suggestion was picked (click, or Enter on the highlighted row). Separate
  // from onValueChange because picking is also a COMMIT — the caller writes the
  // value through without waiting for a blur.
  onSelectSuggestion: (next: string) => void;
};

export const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(
  function Combobox(
    {
      className,
      onBlur,
      onClick,
      onFocus,
      onKeyDown,
      onSelectSuggestion,
      onValueChange,
      suggestions,
      value,
      ...inputProps
    },
    forwardedRef
  ) {
    const [open, setOpen] = React.useState(false);
    const [highlight, setHighlight] = React.useState<string | null>(null);
    const [listbox, setListbox] = React.useState<HTMLDivElement | null>(null);
    const [activeItemId, setActiveItemId] = React.useState<string | undefined>();

    // THE datalist FIX. An exact match (or an empty field) shows the whole list:
    // that is the state a committed value sits in, and it is precisely when a
    // curator wants to see the other five. Substring filtering applies only
    // mid-word, while the text is still on its way to being something.
    const query = value.trim().toLowerCase();
    const isExactMatch = suggestions.some(
      (suggestion) => suggestion.toLowerCase() === query
    );
    const visible =
      query.length === 0 || isExactMatch
        ? suggestions
        : suggestions.filter((suggestion) =>
            suggestion.toLowerCase().includes(query)
          );

    // Derived rather than stored, so a highlight can never outlive the row it
    // pointed at when the list refilters under it.
    const active = highlight !== null && visible.includes(highlight) ? highlight : null;
    const expanded = open && visible.length > 0;

    const close = () => {
      setOpen(false);
      setHighlight(null);
    };

    const select = (next: string) => {
      close();
      onSelectSuggestion(next);
    };

    const moveHighlight = (delta: number) => {
      if (visible.length === 0) return;
      const index = active === null ? -1 : visible.indexOf(active);
      if (index === -1) {
        setHighlight(delta > 0 ? visible[0] : visible[visible.length - 1]);
        return;
      }
      const next = Math.min(visible.length - 1, Math.max(0, index + delta));
      setHighlight(visible[next]);
    };

    // aria-activedescendant has to name the option's DOM id, and cmdk generates
    // those internally. Read it back off the row's data-value (written when the
    // row mounts, unlike aria-selected, which lands a render later) so the
    // announcement can't lag the highlight.
    const visibleKey = visible.join("\u0000");
    React.useLayoutEffect(() => {
      if (!expanded || active === null || listbox === null) {
        setActiveItemId(undefined);
        return;
      }
      const rows = Array.from(listbox.querySelectorAll<HTMLElement>("[cmdk-item]"));
      setActiveItemId(
        rows.find((row) => row.getAttribute("data-value") === active)?.id
      );
    }, [active, expanded, listbox, visibleKey]);

    return (
      <PopoverPrimitive.Root
        open={expanded}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <PopoverPrimitive.Anchor asChild>
          <Input
            ref={forwardedRef}
            aria-activedescendant={activeItemId}
            aria-autocomplete="list"
            aria-controls={expanded && listbox ? listbox.id : undefined}
            aria-expanded={expanded}
            autoComplete="off"
            className={className}
            role="combobox"
            value={value}
            onBlur={(event) => {
              close();
              onBlur?.(event);
            }}
            onChange={(event) => {
              setOpen(true);
              setHighlight(null);
              onValueChange(event.target.value);
            }}
            onClick={(event) => {
              setOpen(true);
              onClick?.(event);
            }}
            onFocus={(event) => {
              setOpen(true);
              onFocus?.(event);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                // Opens the list without touching the text, which is the
                // keyboard-only way in.
                event.preventDefault();
                if (!open) setOpen(true);
                moveHighlight(event.key === "ArrowDown" ? 1 : -1);
                return;
              }
              if (event.key === "Escape" && expanded) {
                // Dismisses the list and nothing else: the typed text stands,
                // and the inspector's own Escape handling stays out of it.
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (event.key === "Enter" && expanded && active !== null) {
                event.preventDefault();
                select(active);
                return;
              }
              // Tab (and Enter with nothing highlighted) fall through to the
              // caller's commit-and-move-on handling.
              if (event.key === "Tab") close();
              onKeyDown?.(event);
            }}
            {...inputProps}
          />
        </PopoverPrimitive.Anchor>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            className={cn(
              "combobox-content z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-sm border border-border bg-popover text-popover-foreground shadow-[var(--shadow-panel)] data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1"
            )}
            sideOffset={4}
            // The popup never takes focus: the caret has to stay in the field,
            // or a mousedown on a row would blur it and commit the half-typed
            // text before the click ever landed.
            onCloseAutoFocus={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <Command
              // Fully controlled: this component owns the highlight, so cmdk is
              // here for the roles, the rows and click-to-select only.
              value={active ?? NO_HIGHLIGHT}
              shouldFilter={false}
              onValueChange={setHighlight}
            >
              <CommandList ref={setListbox}>
                {visible.map((suggestion) => (
                  <CommandItem key={suggestion} value={suggestion} onSelect={select}>
                    {suggestion}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  }
);
