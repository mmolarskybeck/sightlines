import type { ReactNode } from "react";
import {
  Blocks,
  CircleHelp,
  FileJson,
  PanelLeft,
  Settings,
  TriangleAlert
} from "lucide-react";

// The full-height icon rail — the layout's left anchor, spanning beside both
// the topbar and the workspace. Its top 80×80 cell is the brand cell (the "S"
// monogram); below it sit the left-panel selectors (checklist / rooms), the
// live placement-issue count, and — pushed to the bottom utility cluster — the
// developer Data view and mocked (disabled) Settings/Help affordances.
export function AppRail({
  leftPanel,
  onSelectLeftPanel,
  isDataView,
  onOpenDataView,
  issueCount,
  onSelectFirstIssue
}: {
  leftPanel: "checklist" | "rooms" | null;
  // Toggle semantic: the active panel's icon collapses to null, the other
  // switches. App owns that logic; the rail just reports which was clicked.
  onSelectLeftPanel: (panel: "checklist" | "rooms") => void;
  isDataView: boolean;
  onOpenDataView: () => void;
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
          icon={<PanelLeft aria-hidden="true" size={22} />}
          label={leftPanel === "checklist" ? "Hide checklist" : "Show checklist"}
          pressed={leftPanel === "checklist"}
          onClick={() => onSelectLeftPanel("checklist")}
        />

        <RailButton
          active={leftPanel === "rooms"}
          icon={<Blocks aria-hidden="true" size={22} />}
          label={leftPanel === "rooms" ? "Hide rooms & walls" : "Show rooms & walls"}
          pressed={leftPanel === "rooms"}
          onClick={() => onSelectLeftPanel("rooms")}
        />

        <RailButton
          disabled={!hasIssues}
          icon={<TriangleAlert aria-hidden="true" size={22} />}
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

        <div className="rail-spacer" />

        <RailButton
          active={isDataView}
          icon={<FileJson aria-hidden="true" size={22} />}
          label="Data view"
          onClick={onOpenDataView}
        />
        <RailButton
          disabled
          icon={<Settings aria-hidden="true" size={22} />}
          label="Settings — coming soon"
        />
        <RailButton
          disabled
          icon={<CircleHelp aria-hidden="true" size={22} />}
          label="Help — coming soon"
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
