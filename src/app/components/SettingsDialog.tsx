import { useEffect, useId, useState, type ReactNode } from "react";
import type { DisplayUnit } from "../../domain/project";
import {
  getStorageNoteCopy,
  type StoragePersistenceState
} from "../hooks/useStoragePersistence";
import { useAppStore } from "../store";
import { LengthField } from "./LengthField";
import { getScopedUnitContext } from "./scopedUnits";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageState: StoragePersistenceState;
  onRetryStorage: () => void;
  resetPreferences: () => void;
  onExport: () => void;
  onImport: () => void;
  onOpenHelp: () => void;
}

// The four display units, spelled out. There's no display-name helper in
// src/domain/units — the app only ever shows the terse unit glyphs elsewhere —
// so the long-form labels live here, the one place they're needed.
const UNIT_OPTIONS: { value: DisplayUnit; label: string }[] = [
  { value: "in", label: "Inches (in)" },
  { value: "ft", label: "Feet & inches (ft)" },
  { value: "cm", label: "Centimeters (cm)" },
  { value: "m", label: "Meters (m)" }
];

// A settings surface, not a wizard: two stacked sections (Project, Storage &
// data) inside the shared .dialog-content overlay. Project data and the store
// actions are read straight from useAppStore; everything that reaches back
// into App (storage retry, export/import, reset, help) arrives as a prop so
// the wiring pass owns those side effects. The delete-project confirmation is
// a sibling Dialog gated by local state — the destructive path never fires
// without a second, explicit click.
export function SettingsDialog({
  open,
  onOpenChange,
  storageState,
  onRetryStorage,
  resetPreferences,
  onExport,
  onImport,
  onOpenHelp
}: SettingsDialogProps) {
  const project = useAppStore((state) => state.project);
  const renameProject = useAppStore((state) => state.renameProject);
  const setUnit = useAppStore((state) => state.setUnit);
  const setDefaultWallHeightMm = useAppStore((state) => state.setDefaultWallHeightMm);
  const setDefaultCenterlineHeightMm = useAppStore(
    (state) => state.setDefaultCenterlineHeightMm
  );
  const deleteProject = useAppStore((state) => state.deleteProject);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const wallContext = project ? getScopedUnitContext(project.unit, "wall") : null;
  const eyelineContext = project ? getScopedUnitContext(project.unit, "artwork") : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>

          <div className="settings-body">
            {project && wallContext && eyelineContext ? (
              <SettingsSection title="Project">
                <ProjectTitleRow title={project.title} onCommit={renameProject} />

                <SettingsRow label="Display units">
                  <Select
                    value={project.unit}
                    onValueChange={(value) => void setUnit(value as DisplayUnit)}
                  >
                    <SelectTrigger aria-label="Display units">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>

                <div className="settings-field">
                  <LengthField
                    positiveOnly
                    label="Default wall height"
                    valueMm={project.defaultWallHeightMm}
                    displayUnit={wallContext.displayUnit}
                    parseUnit={wallContext.parseUnit}
                    placeholder={wallContext.placeholder}
                    stepMm={wallContext.stepMm}
                    onCommit={setDefaultWallHeightMm}
                    commitErrorFallback="Could not save the default wall height."
                  />
                  <p className="settings-row-note">
                    Applies to rooms and walls you draw from now on; existing walls
                    keep their height.
                  </p>
                </div>

                <div className="settings-field">
                  <LengthField
                    positiveOnly
                    label="Default eyeline height"
                    valueMm={project.defaultCenterlineHeightMm}
                    displayUnit={eyelineContext.displayUnit}
                    parseUnit={eyelineContext.parseUnit}
                    placeholder={eyelineContext.placeholder}
                    stepMm={eyelineContext.stepMm}
                    onCommit={setDefaultCenterlineHeightMm}
                    commitErrorFallback="Could not save the default eyeline height."
                  />
                  <p className="settings-row-note">
                    Moves the eyeline in Elevation and 3D and guides new placements.
                    Hung artworks stay where they are; walls with their own eyeline
                    keep it.
                  </p>
                </div>
              </SettingsSection>
            ) : null}

            <SettingsSection title="Storage &amp; data">
              <p className="settings-status">
                {getStorageNoteCopy(storageState)}
                {storageState === "denied" ? (
                  <Button
                    className="settings-status-action"
                    size="sm"
                    variant="ghost"
                    onClick={onRetryStorage}
                  >
                    Request durable storage
                  </Button>
                ) : null}
              </p>

              <div className="settings-actions">
                <Button variant="outline" onClick={onExport}>
                  Export backup
                </Button>
                <Button variant="outline" onClick={onImport}>
                  Import project file…
                </Button>
              </div>

              {project ? (
                <div className="settings-danger">
                  <div className="settings-danger-item">
                    <Button
                      variant="destructive-ghost"
                      onClick={() => setConfirmDeleteOpen(true)}
                    >
                      Delete this project
                    </Button>
                  </div>
                  <div className="settings-danger-item">
                    <Button variant="outline" onClick={resetPreferences}>
                      Reset workspace preferences
                    </Button>
                    <p className="settings-row-note">
                      Restores grid, snap, panel, and layout preferences on this
                      device.
                    </p>
                  </div>
                </div>
              ) : null}
            </SettingsSection>
          </div>

          <div className="settings-footer">
            <p className="settings-row-note">
              Keyboard shortcuts and product info are in{" "}
              <button
                className="settings-footer-link"
                type="button"
                onClick={onOpenHelp}
              >
                Help
              </button>
              .
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {project ? (
        <Dialog
          open={confirmDeleteOpen}
          onOpenChange={(next) => setConfirmDeleteOpen(next)}
        >
          <DialogContent showClose={false}>
            <DialogHeader>
              <DialogTitle>Delete &ldquo;{project.title}&rdquo;?</DialogTitle>
              <DialogDescription>This can&rsquo;t be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  void deleteProject(project.id);
                  setConfirmDeleteOpen(false);
                  onOpenChange(false);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

// Uppercase kicker + a 12px-gap stack, mirroring .help-dialog-kicker so the
// two sections read as one family with the rest of the overlay chrome.
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {children}
    </section>
  );
}

// One labelled control on a label-left / control-right grid line. LengthField
// brings its own .field-row label, so the measurement rows skip this and sit
// directly in the section instead.
function SettingsRow({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <label className="settings-row-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

// Commit-on-blur/Enter, Escape reverts — the same dance as App's
// ProjectTitleInput, with an Escape revert added (this field lives in a dialog
// where abandoning an edit is the natural expectation). Blank titles snap back
// rather than committing an empty name.
function ProjectTitleRow({
  title,
  onCommit
}: {
  title: string;
  onCommit: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(title);
  const inputId = useId();

  useEffect(() => {
    setValue(title);
  }, [title]);

  const commit = () => {
    if (value.trim().length === 0) {
      setValue(title);
      return;
    }
    void onCommit(value);
  };

  return (
    <SettingsRow htmlFor={inputId} label="Project title">
      <Input
        aria-label="Project title"
        id={inputId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            return;
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setValue(title);
          }
        }}
      />
    </SettingsRow>
  );
}
