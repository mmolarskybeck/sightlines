import type { ReactNode } from "react";
import {
  Box,
  CircleHelp,
  FileJson,
  PanelLeft,
  Settings,
  TriangleAlert
} from "lucide-react";

// The full-height icon rail — the layout's left anchor, spanning beside both
// the topbar and the workspace. It carries the app's identity (the oxblood S
// monogram, the app's only oxblood element) and the workspace-level toggles
// that aren't curatorial modes: showing/hiding the checklist, the developer
// Data view, the live placement-issue count, and mocked (disabled) 3D/Settings/
// Help affordances.
export function AppRail({
  showChecklistPanel,
  onToggleChecklistPanel,
  isDataView,
  onOpenDataView,
  issueCount,
  onSelectFirstIssue
}: {
  showChecklistPanel: boolean;
  onToggleChecklistPanel: () => void;
  isDataView: boolean;
  onOpenDataView: () => void;
  issueCount: number;
  onSelectFirstIssue: () => void;
}) {
  const hasIssues = issueCount > 0;

  return (
    <nav className="app-rail" aria-label="Workspace">
      <div className="rail-brand" aria-hidden="true">
        S
      </div>

      <RailButton
        active={showChecklistPanel}
        icon={<PanelLeft aria-hidden="true" size={18} />}
        label={showChecklistPanel ? "Hide checklist" : "Show checklist"}
        pressed={showChecklistPanel}
        onClick={onToggleChecklistPanel}
      />

      <RailButton
        active={isDataView}
        icon={<FileJson aria-hidden="true" size={18} />}
        label="Data view"
        onClick={onOpenDataView}
      />

      <RailButton
        disabled={!hasIssues}
        icon={<TriangleAlert aria-hidden="true" size={18} />}
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
        disabled
        icon={<Box aria-hidden="true" size={18} />}
        label="3D preview — planned"
      />

      <div className="rail-spacer" />

      <RailButton
        disabled
        icon={<Settings aria-hidden="true" size={18} />}
        label="Settings — coming soon"
      />
      <RailButton
        disabled
        icon={<CircleHelp aria-hidden="true" size={18} />}
        label="Help — coming soon"
      />
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
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={active ? "rail-button active" : "rail-button"}
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
