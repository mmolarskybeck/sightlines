import type { ReactNode } from "react";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/dist/csr/BookmarksSimple";
import { BoundingBoxIcon } from "@phosphor-icons/react/dist/csr/BoundingBox";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { ImagesSquareIcon } from "@phosphor-icons/react/dist/csr/ImagesSquare";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// The full-height icon rail — the layout's left anchor, spanning beside both
// the topbar and the workspace. Its top 80×80 cell is the brand cell (the "S"
// monogram); below it sit the left-panel selectors (checklist / rooms), the
// live placement-issue count, and — pushed to the bottom utility cluster —
// the Settings/Help affordances.
export function AppRail({
  leftPanel,
  onSelectLeftPanel,
  isLibraryView,
  onOpenLibrary,
  onOpenSettings,
  onOpenHelp,
  issueCount,
  onSelectFirstIssue
}: {
  leftPanel: "checklist" | "rooms" | "savedViews" | null;
  // Toggle semantic: the active panel's icon collapses to null, the other
  // switches. App owns that logic; the rail just reports which was clicked.
  onSelectLeftPanel: (panel: "checklist" | "rooms" | "savedViews") => void;
  isLibraryView: boolean;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  issueCount: number;
  onSelectFirstIssue: () => void;
}) {
  const hasIssues = issueCount > 0;

  return (
    <nav className="app-rail" aria-label="Workspace">
      <div className="rail-brand" aria-label="Sightlines">
        S
      </div>

      <div className="rail-buttons">
        <RailButton
          active={leftPanel === "checklist"}
          icon={<ListChecksIcon aria-hidden="true" size={22} />}
          label={leftPanel === "checklist" ? "Hide checklist" : "Show checklist"}
          pressed={leftPanel === "checklist"}
          onClick={() => onSelectLeftPanel("checklist")}
        />

        <RailButton
          active={leftPanel === "rooms"}
          icon={<BoundingBoxIcon aria-hidden="true" size={22} />}
          label={leftPanel === "rooms" ? "Hide rooms & walls" : "Show rooms & walls"}
          pressed={leftPanel === "rooms"}
          onClick={() => onSelectLeftPanel("rooms")}
        />

        <RailButton
          active={leftPanel === "savedViews"}
          icon={<BookmarksSimpleIcon aria-hidden="true" size={22} />}
          label={leftPanel === "savedViews" ? "Hide saved views" : "Show saved views"}
          pressed={leftPanel === "savedViews"}
          onClick={() => onSelectLeftPanel("savedViews")}
        />

        <RailButton
          active={isLibraryView}
          icon={<ImagesSquareIcon aria-hidden="true" size={22} />}
          label="Artwork library"
          onClick={onOpenLibrary}
        />

        <RailButton
          disabled={!hasIssues}
          icon={<WarningIcon aria-hidden="true" size={22} />}
          label={
            hasIssues
              ? `Review ${issueCount} placement issue${issueCount === 1 ? "" : "s"}`
              : "No placement issues"
          }
          onClick={onSelectFirstIssue}
        >
          {hasIssues ? (
            <span className="rail-issue-count" aria-hidden="true">
              {issueCount}
            </span>
          ) : null}
        </RailButton>

        <div className="rail-spacer" />

        <RailButton
          icon={<SlidersHorizontalIcon aria-hidden="true" size={22} />}
          label="Settings"
          onClick={onOpenSettings}
        />
        <RailButton
          icon={<QuestionIcon aria-hidden="true" size={22} />}
          label="Help"
          onClick={onOpenHelp}
        />
      </div>
    </nav>
  );
}

function RailButton({
  active = false,
  children,
  disabled = false,
  icon,
  label,
  pressed,
  onClick
}: {
  active?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  // Only functional toggles carry aria-pressed; navigation-style buttons
  // (Artwork Library) and disabled placeholders leave it off.
  pressed?: boolean;
  onClick?: () => void;
}) {
  const control =
    pressed !== undefined ? (
      <Toggle
        aria-label={label}
        className="rail-button"
        disabled={disabled}
        pressed={pressed}
        size="rail"
        variant="rail"
        onPressedChange={() => onClick?.()}
      >
        {icon}
        {children}
      </Toggle>
    ) : (
      <Button
        aria-label={label}
        data-active={active ? "true" : undefined}
        className={active ? "rail-button active" : "rail-button"}
        disabled={disabled}
        size="rail"
        variant="rail"
        onClick={onClick}
      >
        {icon}
        {children}
      </Button>
    );

  return (
    <Tooltip>
      {/* Disabled controls drop pointer events, so the hint rides a
          pointer-events-keeping span under the Tooltip trigger. */}
      <TooltipTrigger asChild>{disabled ? <span>{control}</span> : control}</TooltipTrigger>
      <TooltipContent className="toolbar-tooltip" side="right">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
