import type { ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { InsertToolKind } from "../../../domain/placement/createOpening";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ToolbarTooltipKbd } from "./ToolbarTooltipKbd";
import {
  armedDrawMeta,
  armedInsertMeta,
  OPENING_TOOL_META,
  OPENING_TOOL_ORDER,
  OUTLINE_ROOM_TOOL_META,
  PARTITION_TOOL_META,
  RECT_ROOM_TOOL_META,
  type InsertToolMeta
} from "./toolMeta";

// Which of the two renderings the shared picker draws. "full" is the desktop
// segmented cluster (a row of flush icon buttons); "compact" is the narrow-
// canvas dropdown trigger + menu. App renders BOTH variants side by side and a
// container query in global.css shows exactly one per density tier, so the two
// were previously separate components (ToolClusterPicker / CompactClusterPicker
// and their Insert/Draw call sites) — collapsed here behind this one flag.
type ClusterVariant = "full" | "compact";

// One tool as the shared picker consumes it: a meta descriptor plus its live
// active state and toggle handler. Both variants read the SAME (active,
// onToggle) — the full picker paints it as a pressed segment, the compact one
// as a checked menu row — which is exactly why the old ClusterSegment
// (pressed/onClick) and ClusterTool (active/onSelect) pair collapses to this.
type ClusterEntry = InsertToolMeta & { active: boolean; onToggle: () => void };

// The generic captioned cluster picker, in both densities.
//
// full — a quiet caption followed by one joined soft group: a single surface
// fill holding a flush icon segment per tool, split by interior hairlines.
// Toggle semantics match the old floating palette: the armed button reads
// pressed in petrol, clicking it again disarms, and the view's own Escape/
// click-to-place handling disarms via the caller's onToggle. The caption is
// aria-hidden (the group's aria-label already carries it); each button carries
// its own aria-label plus a styled Tooltip — with no visible per-tool text, the
// hover hint is the only sighted name these have, so it matters here.
//
// compact — a single dropdown trigger that stands in for the cluster below the
// narrow breakpoint, so the desktop control keeps its direct-manipulation
// affordance without making the narrow toolbar carry a row of adjacent icon
// buttons. When a tool is armed the trigger stands in for it (the tool's glyph
// replaces the idle icon and its name replaces the caption), so identity
// survives the compact/tight tiers. idleIcon/idleTooltip/armed are consumed
// only by this branch.
function ClusterPicker({
  variant,
  caption,
  entries,
  armed,
  idleIcon,
  idleTooltip,
  disabled = false,
  disabledReason
}: {
  variant: ClusterVariant;
  caption: string;
  entries: ClusterEntry[];
  armed: InsertToolMeta | null;
  idleIcon: ReactNode;
  idleTooltip: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  if (variant === "compact") {
    const triggerButton = (
      <Button
        // Names both the control and the armed mode, so the swapped-in glyph is
        // never the only cue for SR users.
        aria-label={armed ? `${caption}, ${armed.label} armed` : caption}
        aria-disabled={disabled || undefined}
        className="compact-cluster-trigger"
        data-active={armed ? "true" : "false"}
        variant="outline"
      >
        {armed ? armed.icon : idleIcon}
        <span className="compact-cluster-label">{armed ? armed.label : caption}</span>
        <CaretDownIcon aria-hidden="true" className="compact-cluster-caret" size={14} />
      </Button>
    );

    // Disabled: render no menu at all (so the dropdown can never open), just the
    // fogged aria-disabled trigger under the styled reason Tooltip — reachable
    // on hover AND focus, replacing the old pointer-only wrapper-span/title hack.
    if (disabled) {
      return (
        <span className="compact-cluster-tools">
          <Tooltip>
            <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              {disabledReason}
            </TooltipContent>
          </Tooltip>
        </span>
      );
    }

    return (
      <span className="compact-cluster-tools">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              {armed ? (
                <>
                  {armed.armed}
                  <ToolbarTooltipKbd hint="Esc cancels" />
                </>
              ) : (
                idleTooltip
              )}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="compact-cluster-menu">
            {entries.map((entry) => (
              <DropdownMenuItem
                key={entry.key}
                aria-checked={entry.active}
                className="compact-cluster-item"
                data-active={entry.active ? "true" : "false"}
                role="menuitemradio"
                onSelect={entry.onToggle}
              >
                {entry.icon}
                <span>{entry.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    );
  }

  return (
    <div
      className="tool-cluster"
      role="group"
      aria-label={caption}
      aria-disabled={disabled || undefined}
    >
      <div className="tool-cluster-segments">
        {/* The caption docks inside the shared fill behind a hairline (the
            checklist's sort trigger is the precedent), so the word and its
            three tools read as one object. aria-hidden: the group's
            aria-label already announces it. */}
        <span className="tool-cluster-label" aria-hidden="true">
          {caption}
        </span>
        {entries.map((entry) => (
          // aria-disabled (not native disabled) keeps each segment focusable,
          // so keyboard/SR users still reach it and hear WHY it's off — the
          // reason rides the SAME styled Tooltip, firing on hover AND focus.
          // The click is a no-op while disabled; the fogged look ports to
          // [aria-disabled] in global.css. Pressed → the tooltip teaches the
          // exit ("Esc cancels"); resting → it echoes the accelerator in a key chip.
          <Tooltip key={entry.key}>
            <TooltipTrigger asChild>
              <button
                aria-label={entry.label}
                aria-pressed={entry.active}
                aria-disabled={disabled || undefined}
                className="tool-cluster-segment"
                type="button"
                onClick={disabled ? undefined : entry.onToggle}
              >
                {entry.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              {disabled ? (
                disabledReason
              ) : entry.active ? (
                <>
                  {entry.armed}
                  <ToolbarTooltipKbd hint="Esc cancels" />
                </>
              ) : (
                <>
                  {entry.hint}
                  <ToolbarTooltipKbd hint={entry.kbd} />
                </>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// The view-toolbar's Insert cluster: door/window/blocked-zone, identical
// membership in both 2D views (Insert decorates existing geometry; Draw creates
// new structure, so the partition tool lives in the Draw cluster). A thin call
// site over ClusterPicker — planMode's discriminated union keeps every armed
// tool mutually exclusive. `variant` picks the segmented or compact rendering.
export function InsertPicker({
  variant,
  activeTool,
  disabled,
  disabledReason = "Select a wall first",
  onToolChange
}: {
  variant: ClusterVariant;
  activeTool: InsertToolKind | null;
  disabled: boolean;
  disabledReason?: string;
  onToolChange: (tool: InsertToolKind | null) => void;
}) {
  const entries: ClusterEntry[] = OPENING_TOOL_ORDER.map((kind) => ({
    ...OPENING_TOOL_META[kind],
    active: activeTool === kind,
    onToggle: () => onToolChange(activeTool === kind ? null : kind)
  }));

  return (
    <ClusterPicker
      variant={variant}
      caption="Insert"
      entries={entries}
      armed={armedInsertMeta(activeTool)}
      idleIcon={<PlusIcon aria-hidden="true" size={16} />}
      idleTooltip="Choose insert tool"
      disabled={disabled}
      disabledReason={disabledReason}
    />
  );
}

// The view-toolbar's Draw cluster: rectangle room, room outline, partition —
// the three tools that create new structure. Plan-only, never disabled. A thin
// call site over ClusterPicker; `variant` picks the rendering.
export function DrawPicker({
  variant,
  rectActive,
  onRectToggle,
  outlineActive,
  onOutlineToggle,
  partitionActive,
  onPartitionToggle
}: {
  variant: ClusterVariant;
  rectActive: boolean;
  onRectToggle: () => void;
  outlineActive: boolean;
  onOutlineToggle: () => void;
  partitionActive: boolean;
  onPartitionToggle: () => void;
}) {
  const entries: ClusterEntry[] = [
    { ...RECT_ROOM_TOOL_META, active: rectActive, onToggle: onRectToggle },
    { ...OUTLINE_ROOM_TOOL_META, active: outlineActive, onToggle: onOutlineToggle },
    { ...PARTITION_TOOL_META, active: partitionActive, onToggle: onPartitionToggle }
  ];

  return (
    <ClusterPicker
      variant={variant}
      caption="Draw"
      entries={entries}
      armed={armedDrawMeta(rectActive, outlineActive, partitionActive)}
      idleIcon={<PencilSimpleIcon aria-hidden="true" size={16} />}
      idleTooltip="Choose draw tool"
    />
  );
}
