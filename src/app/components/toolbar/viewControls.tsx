import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/dist/csr/BookmarkSimple";
import { CornersOutIcon } from "@phosphor-icons/react/dist/csr/CornersOut";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import type { DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { getGridPrecisionFloorOptionsMm } from "../../../domain/units/precision";
import type { UnitSystem } from "../../../domain/units/unitSystem";
import type { ThreeDViewActions } from "../three/ThreeDView";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ToolbarTooltipKbd } from "./ToolbarTooltipKbd";

export function ViewOptionButton({
  active,
  disabled,
  icon,
  label,
  labelPriority = false,
  title,
  kbd,
  onClick
}: {
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  // Keeps this label through the trimmed density tier (see global.css). Used
  // for Overlap, whose glyph reads weakest of the view toggles.
  labelPriority?: boolean;
  title: string;
  // The single-key accelerator (useToolbarShortcuts), echoed as a dimmed
  // suffix in the tooltip so the hint teaches the key.
  kbd?: string;
  onClick: () => void;
}) {
  const toggle = (
    <Toggle
      // Kept the same string as the visible label below: on a narrow canvas
      // column the container query in global.css hides .view-option-label
      // and the button goes icon-only, so the accessible name must not
      // depend on the span's visibility (and must never diverge from it).
      aria-label={label}
      className="view-option-button"
      disabled={disabled}
      pressed={active}
      variant="default"
      onPressedChange={onClick}
    >
      {icon}
      <span
        className={
          labelPriority ? "view-option-label view-option-label-priority" : "view-option-label"
        }
      >
        {label}
      </span>
    </Toggle>
  );

  // toggleVariants applies `disabled:pointer-events-none`, so a disabled
  // Toggle never receives the hover that would open a Radix tooltip. A
  // wrapping span keeps receiving pointer events, so the disabled-state
  // title stays reachable on hover instead of silently going dark.
  if (disabled) return <span title={title}>{toggle}</span>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{toggle}</TooltipTrigger>
      <TooltipContent className="toolbar-tooltip" side="bottom">
        {title}
        {kbd ? <ToolbarTooltipKbd hint={kbd} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function ThreeDCameraTools({
  actionsRef,
  canFocus,
  onSaveView
}: {
  actionsRef: { current: ThreeDViewActions | null };
  canFocus: boolean;
  onSaveView?: () => void;
}) {
  const focusButton = (
    <Button
      className="view-option-button"
      disabled={!canFocus}
      variant="inspector"
      onClick={() => actionsRef.current?.focusSelection()}
    >
      <CrosshairIcon aria-hidden="true" size={16} />
      <span className="view-option-label">Focus selection</span>
    </Button>
  );

  return (
    <div className="three-camera-tools" role="group" aria-label="3D camera">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="view-option-button"
            variant="inspector"
            onClick={() => actionsRef.current?.overview()}
          >
            <CornersOutIcon aria-hidden="true" size={16} />
            <span className="view-option-label">Overview</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          Frame the whole layout
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="view-option-button"
            variant="inspector"
            onClick={() => actionsRef.current?.eyeLevel()}
          >
            <EyeIcon aria-hidden="true" size={16} />
            <span className="view-option-label">Eye level</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          View the selected wall at eye level
        </TooltipContent>
      </Tooltip>
      {canFocus ? (
        <Tooltip>
          <TooltipTrigger asChild>{focusButton}</TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            Focus the selected room, wall, or artwork
          </TooltipContent>
        </Tooltip>
      ) : (
        // Disabled buttons drop pointer events, so the hint rides a span.
        <span title="Focus the selected room, wall, or artwork">{focusButton}</span>
      )}
      {onSaveView ? (
        <>
          <span className="three-camera-divider" aria-hidden="true" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="view-option-button"
                variant="inspector"
                onClick={onSaveView}
              >
                <BookmarkSimpleIcon aria-hidden="true" size={16} />
                <span className="view-option-label view-option-label-priority">Save view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              Bookmark this camera for the PDF and Saved views
            </TooltipContent>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

export function UnitSystemToggle({
  disabled,
  labels = { imperial: "ft", metric: "m" },
  system,
  onChange
}: {
  disabled: boolean;
  labels?: {
    imperial: string;
    metric: string;
  };
  system: UnitSystem;
  onChange: (system: UnitSystem) => void;
}) {
  // Re-clicking the already-active side is a no-op: it must never fire
  // onChange, or a legacy project stored as "in"/"cm" would get rewritten to
  // "ft"/"m" and land a redundant entry on the undo stack.
  const select = (next: UnitSystem) => {
    if (next === system) return;
    onChange(next);
  };

  // A traditional slide switch with the two unit systems as flanking words —
  // one small track, no label-inside-track nesting. The words are pointer
  // shortcuts to a specific side (routed through select(), so clicking the
  // already-active side stays inert); the switch itself is the single
  // accessible control, so the words stay out of the tab order and the
  // accessibility tree rather than announcing as three separate controls.
  return (
    <div
      className="unit-switch"
      data-system={system}
      role="group"
      aria-label={`Units: ${labels.imperial} / ${labels.metric}`}
    >
      <button
        aria-hidden="true"
        className="unit-switch-side"
        data-active={system === "imperial"}
        disabled={disabled}
        tabIndex={-1}
        type="button"
        onClick={() => select("imperial")}
      >
        {labels.imperial}
      </button>
      <Switch
        aria-labelledby="unit-system-label unit-system-value"
        checked={system === "metric"}
        className="unit-switch-control"
        disabled={disabled}
        onCheckedChange={(checked) => select(checked ? "metric" : "imperial")}
      >
        <span className="visually-hidden" id="unit-system-label">
          Units
        </span>
        <span className="visually-hidden" id="unit-system-value">
          {system === "metric" ? `Metric (${labels.metric})` : `Imperial (${labels.imperial})`}
        </span>
      </Switch>
      <button
        aria-hidden="true"
        className="unit-switch-side"
        data-active={system === "metric"}
        disabled={disabled}
        tabIndex={-1}
        type="button"
        onClick={() => select("metric")}
      >
        {labels.metric}
      </button>
    </div>
  );
}

export function PrecisionSelect({
  disabled,
  floorMm,
  unit,
  onChange
}: {
  disabled: boolean;
  floorMm: number | null;
  unit: DisplayUnit;
  onChange: (floorMm: number | null) => void;
}) {
  // Options are a curated subset of the active unit family's own grid
  // interval table (domain/units/precision.ts), so a floor picked here is
  // guaranteed to line up with an actual grid step rather than an arbitrary
  // value. Always formatted with the family's "natural" unit (feet-and-
  // inches for imperial, cm for metric) regardless of the project's current
  // display unit, since the stored value is mm and clamps to the nearest
  // table entry if the project unit later changes.
  const labelUnit: DisplayUnit = unit === "in" ? "in" : unit === "ft" ? "ft" : "cm";
  const options = getGridPrecisionFloorOptionsMm(unit);

  return (
    <div className="unit-select">
      <span className="unit-select-label view-option-label-priority">Precision</span>
      <Select
        disabled={disabled}
        value={floorMm === null ? "auto" : String(floorMm)}
        onValueChange={(value) =>
          onChange(value === "auto" ? null : Number(value))
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger className="precision-select-trigger" aria-label="Grid precision">
              <SelectValue />
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            Grid precision
          </TooltipContent>
        </Tooltip>
        <SelectContent>
          <SelectItem value="auto">Auto</SelectItem>
        {options.map((optionMm) => (
          <SelectItem key={optionMm} value={String(optionMm)}>
            {formatLength(optionMm, { unit: labelUnit })}
          </SelectItem>
        ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// A real button (not the plain <span> this used to be) so it can double as a
// Popover trigger for the storage-details popover in App.tsx — forwardRef +
// spread props let `<PopoverTrigger asChild>` attach its onClick/aria-expanded/
// aria-haspopup/ref directly to this element rather than wrapping it in an
// extra DOM node. The dot + label visual is unchanged.
export const StatusBadge = forwardRef<
  HTMLButtonElement,
  { state: "idle" | "saving" | "saved" | "error" } & ComponentPropsWithoutRef<"button">
>(({ state, className, ...props }, ref) => {
  const label =
    state === "saving"
      ? "Saving"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Save issue"
          : "Idle";

  return (
    <button
      ref={ref}
      type="button"
      className={["status-badge", state, className].filter(Boolean).join(" ")}
      {...props}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-badge-label">{label}</span>
    </button>
  );
});
StatusBadge.displayName = "StatusBadge";
