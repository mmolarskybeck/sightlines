import type { ReactNode } from "react";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { BoundingBoxIcon } from "@phosphor-icons/react/dist/csr/BoundingBox";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";

// The full-height icon rail — the layout's left anchor, spanning beside both
// the topbar and the workspace. Its top 80×80 cell is the brand cell (the "S"
// monogram); below it sit the left-panel selectors (checklist / rooms), the
// live placement-issue count, and — pushed to the bottom utility cluster — the
// developer Data view and mocked (disabled) Settings/Help affordances.
export function AppRail({
  leftPanel,
  onSelectLeftPanel,
  inspectorCollapsed,
  onToggleInspector,
  isDataView,
  onOpenDataView,
  onOpenHelp,
  issueCount,
  onSelectFirstIssue
}: {
  leftPanel: "checklist" | "rooms" | null;
  // Toggle semantic: the active panel's icon collapses to null, the other
  // switches. App owns that logic; the rail just reports which was clicked.
  onSelectLeftPanel: (panel: "checklist" | "rooms") => void;
  // The right inspector's collapse toggle — the symmetric counterpart to the
  // left-panel selectors above, so both sides of the workspace are governed
  // from the rail. Pressed (aria-pressed) when the inspector is showing.
  inspectorCollapsed: boolean;
  onToggleInspector: () => void;
  isDataView: boolean;
  onOpenDataView: () => void;
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
          disabled={!hasIssues}
          icon={<WarningIcon aria-hidden="true" size={22} />}
          label={
            hasIssues
              ? `${issueCount} placement issue${issueCount === 1 ? "" : "s"}`
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

        <RailButton
          active={!inspectorCollapsed}
          // The icon is a left-anchored sidebar glyph flipped horizontally so it
          // reads as the right-hand inspector, matching where the panel lives.
          icon={
            <SidebarSimpleIcon
              aria-hidden="true"
              size={22}
              style={{ transform: "scaleX(-1)" }}
            />
          }
          label={inspectorCollapsed ? "Show inspector" : "Hide inspector"}
          pressed={!inspectorCollapsed}
          onClick={onToggleInspector}
        />

        <div className="rail-spacer" />

        <RailButton
          active={isDataView}
          icon={<FileCodeIcon aria-hidden="true" size={22} />}
          label="Data view"
          onClick={onOpenDataView}
        />
        <RailButton
          disabled
          icon={<SlidersHorizontalIcon aria-hidden="true" size={22} />}
          label="Settings — coming soon"
        />
        <RailButton
          icon={<QuestionIcon aria-hidden="true" size={22} />}
          label="Help and product info"
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
  // (Data view) and disabled placeholders leave it off.
  pressed?: boolean;
  onClick?: () => void;
}) {
  return (
    pressed !== undefined ? (
      <Toggle
        aria-label={label}
        className="rail-button"
        disabled={disabled}
        pressed={pressed}
        size="rail"
        title={label}
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
        title={label}
        variant="rail"
        onClick={onClick}
      >
        {icon}
        {children}
      </Button>
    )
  );
}
