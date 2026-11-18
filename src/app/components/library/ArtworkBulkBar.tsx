import { useEffect, useState, type ReactNode } from "react";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { CursorClickIcon } from "@phosphor-icons/react/dist/csr/CursorClick";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export type ArtworkBulkBarProps = {
  scope: "checklist" | "library";
  // "compact" = icon buttons with tooltips, for the narrow checklist pane.
  variant?: "full" | "compact";
  checkedCount: number;
  // Checked ids that are not in the currently visible rows (filtered/searched out).
  hiddenCount: number;
  onClear: () => void;
  // Rendered only when provided. Checks every visible row.
  onSelectAll?: () => void;
  allVisibleChecked?: boolean;
  // Bulk field and mat & frame editing live in the inspector, which edits the
  // checked set directly. onEdit only reveals a collapsed inspector, so the
  // button renders only when the parent passes it.
  onEdit?: () => void;
  onDuplicate: () => void;
  // checklist scope
  placedCheckedCount?: number;
  onSelectOnCanvas?: () => void;
  // Called only after the bar's own inline two-step confirm.
  onRemove?: () => void;
  // library scope
  onAddToChecklist?: () => void;
  // Opens the parent's existing delete dialog; no inline confirm.
  onDelete?: () => void;
};

export function ArtworkBulkBar({
  scope,
  variant = "full",
  checkedCount,
  hiddenCount,
  onClear,
  onSelectAll,
  allVisibleChecked,
  onEdit,
  onDuplicate,
  placedCheckedCount,
  onSelectOnCanvas,
  onRemove,
  onAddToChecklist,
  onDelete
}: ArtworkBulkBarProps) {
  const [confirming, setConfirming] = useState(false);
  const compact = variant === "compact";
  const isChecklist = scope === "checklist";

  // A changed selection invalidates an armed confirm.
  useEffect(() => {
    setConfirming(false);
  }, [checkedCount]);

  const countText = `${checkedCount} selected${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}`;

  const action = (
    text: string,
    icon: ReactNode,
    onClick: (() => void) | undefined,
    buttonVariant: "primary" | "outline" | "destructive-ghost",
    disabled = false,
    tooltipText = text
  ) =>
    compact ? (
      <Tooltip key={text}>
        <TooltipTrigger asChild>
          {/* span wrapper so a disabled button still shows its tooltip */}
          <span className="artwork-bulk-bar-action">
            <Button
              aria-label={text}
              disabled={disabled}
              size="icon-sm"
              variant="ghost"
              onClick={onClick}
            >
              {icon}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    ) : (
      <Button
        key={text}
        disabled={disabled}
        size="sm"
        title={disabled ? tooltipText : undefined}
        variant={buttonVariant}
        onClick={onClick}
      >
        {icon} {text}
      </Button>
    );

  const noPlaced = !placedCheckedCount;
  const removeConfirmText = `Remove ${checkedCount} work${checkedCount === 1 ? "" : "s"} from the checklist? They stay in your Artwork Library.${hiddenCount > 0 ? ` (${hiddenCount} not shown)` : ""}`;

  return (
    <div className="artwork-bulk-bar" data-variant={variant} role="toolbar" aria-label="Selected works">
      <span className="artwork-bulk-bar-count" aria-live={compact ? "polite" : undefined}>{countText}</span>
      {onSelectAll ? (
        <Button disabled={allVisibleChecked} size="sm" variant="ghost" onClick={onSelectAll}>
          Select all
        </Button>
      ) : null}
      {confirming ? (
        <div
          className="artwork-bulk-bar-confirm"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setConfirming(false);
            }
          }}
        >
          <span>{removeConfirmText}</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              onRemove?.();
              setConfirming(false);
            }}
          >
            Remove
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          {!isChecklist ? action("Add to checklist", <PlusIcon aria-hidden="true" size={14} />, onAddToChecklist, "primary") : null}
          {onEdit ? action("Edit in inspector", <PencilSimpleIcon aria-hidden="true" size={14} />, onEdit, "outline") : null}
          {action("Duplicate", <CopyIcon aria-hidden="true" size={14} />, onDuplicate, "outline")}
          {isChecklist
            ? action(
                "Select on canvas",
                <CursorClickIcon aria-hidden="true" size={14} />,
                onSelectOnCanvas,
                "outline",
                noPlaced,
                noPlaced ? "None of the selected works are placed" : "Select on canvas"
              )
            : null}
          {isChecklist
            ? action("Remove", <TrashIcon aria-hidden="true" size={14} />, () => setConfirming(true), "destructive-ghost")
            : null}
          {!isChecklist && onDelete ? action("Delete", <TrashIcon aria-hidden="true" size={14} />, onDelete, "destructive-ghost") : null}
        </>
      )}
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="Clear selection" size="icon-sm" variant="ghost" onClick={onClear}>
              <XIcon aria-hidden="true" size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            Clear selection
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
