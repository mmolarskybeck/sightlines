import { useEffect, useId, useState, type ReactNode } from "react";
import type { DisplayUnit } from "../../../domain/project";
import {
  getStorageNoteCopy,
  type StoragePersistenceState
} from "../../hooks/useStoragePersistence";
import { CloudCheckIcon } from "@phosphor-icons/react/dist/csr/CloudCheck";
import { CloudWarningIcon } from "@phosphor-icons/react/dist/csr/CloudWarning";
import {
  formatBackupRelativeTime
} from "../../cloud/cloudBackupCopy";
import type { CloudBackupProviderStatus } from "../../cloud/provider";
import type { CloudBackupUploadStatus } from "../../store/cloudBackupSlice";
import { useAppStore } from "../../store";
import { LengthField } from "../shared/LengthField";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageState: StoragePersistenceState;
  onRetryStorage: () => void;
  cloudBackupConfigured: boolean;
  cloudBackupProviderStatus: CloudBackupProviderStatus;
  cloudBackupAccountLabel: string | null;
  cloudBackupStatus: CloudBackupUploadStatus;
  lastCloudBackupAt: string | null;
  onConnectCloudBackup: () => Promise<void>;
  onDisconnectCloudBackup: () => void;
  onRunCloudBackup: () => Promise<void>;
  resetPreferences: () => void;
  onExport: () => void;
  onImport: () => void;
  onOpenHelp: () => void;
  usageAnalyticsEnabled: boolean;
  crashReportsEnabled: boolean;
  onUsageAnalyticsChange: (enabled: boolean) => boolean;
  onCrashReportsChange: (enabled: boolean) => boolean;
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
  cloudBackupConfigured,
  cloudBackupProviderStatus,
  cloudBackupAccountLabel,
  cloudBackupStatus,
  lastCloudBackupAt,
  onConnectCloudBackup,
  onDisconnectCloudBackup,
  onRunCloudBackup,
  resetPreferences,
  onExport,
  onImport,
  onOpenHelp,
  usageAnalyticsEnabled,
  crashReportsEnabled,
  onUsageAnalyticsChange,
  onCrashReportsChange
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
  const [privacySaveFailed, setPrivacySaveFailed] = useState(false);

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
                  <p className="settings-row-hint">
                    Applies to rooms and walls you draw from now on.
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
                  <p className="settings-row-hint">
                    Guides the eyeline in Elevation and 3D and new placements. Hung
                    artworks stay put.
                  </p>
                </div>
              </SettingsSection>
            ) : null}

            <SettingsSection title="Storage &amp; data">
              <div className="settings-action-row">
                <div className="settings-action-text">
                  <strong className="settings-action-title">
                    {getStorageNoteCopy(storageState)}
                  </strong>
                  <p className="settings-action-desc">
                    Some browsers clear local data after inactivity.
                  </p>
                </div>
                {storageState === "denied" ? (
                  <div className="settings-action-buttons">
                    <button
                      className="settings-link"
                      type="button"
                      onClick={onRetryStorage}
                    >
                      Request durable storage
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="settings-action-row">
                <div className="settings-action-text">
                  <strong className="settings-action-title">Backup file</strong>
                  <p className="settings-action-desc">
                    A portable .sightlines file you can store anywhere or hand off.
                  </p>
                </div>
                <div className="settings-action-buttons">
                  <Button size="sm" variant="outline" onClick={onExport}>
                    Export
                  </Button>
                  <Button size="sm" variant="outline" onClick={onImport}>
                    Import…
                  </Button>
                </div>
              </div>

              {cloudBackupConfigured ? (
                <CloudBackupBlock
                  status={cloudBackupProviderStatus}
                  uploadStatus={cloudBackupStatus}
                  accountLabel={cloudBackupAccountLabel}
                  lastCloudBackupAt={lastCloudBackupAt}
                  onConnect={onConnectCloudBackup}
                  onDisconnect={onDisconnectCloudBackup}
                  onRunBackup={onRunCloudBackup}
                />
              ) : null}
            </SettingsSection>

            <SettingsSection title="Analytics">
              <div className="settings-switch-group">
                <SwitchRow
                  checked={usageAnalyticsEnabled}
                  description="Share anonymous feature-use and performance data. Never includes project or artwork content."
                  note="Turning this off reloads Sightlines."
                  id="settings-usage-analytics"
                  label="Anonymous usage analytics"
                  onCheckedChange={(enabled) =>
                    setPrivacySaveFailed(!onUsageAnalyticsChange(enabled))
                  }
                />
                <SwitchRow
                  checked={crashReportsEnabled}
                  description="Send sanitized error reports when Sightlines stops working. Not active yet — this saves your choice for launch."
                  id="settings-crash-reports"
                  label="Anonymous crash reports"
                  onCheckedChange={(enabled) =>
                    setPrivacySaveFailed(!onCrashReportsChange(enabled))
                  }
                />
              </div>
              <a className="settings-link" href="https://sightlines.art/privacy">
                Read the privacy policy
              </a>
              {privacySaveFailed ? (
                <p className="settings-privacy-error" role="alert">
                  This choice could not be saved. Reporting remains off.
                </p>
              ) : null}
            </SettingsSection>

            {project ? (
              <SettingsSection title="Danger zone">
                <div className="settings-action-row">
                  <div className="settings-action-text">
                    <p className="settings-action-desc">
                      Removes this project from this browser.
                    </p>
                  </div>
                  <div className="settings-action-buttons">
                    <Button
                      size="sm"
                      variant="destructive-ghost"
                      onClick={() => setConfirmDeleteOpen(true)}
                    >
                      Delete this project
                    </Button>
                  </div>
                </div>
                <div className="settings-action-row">
                  <div className="settings-action-text">
                    <p className="settings-action-desc">
                      Restores grid, snap, panel, and layout preferences on this
                      device.
                    </p>
                  </div>
                  <div className="settings-action-buttons">
                    <Button size="sm" variant="outline" onClick={resetPreferences}>
                      Reset workspace preferences
                    </Button>
                  </div>
                </div>
              </SettingsSection>
            ) : null}
          </div>

          <div className="settings-footer">
            <p className="settings-row-hint">
              Keyboard shortcuts and product info are in{" "}
              <button className="settings-link" type="button" onClick={onOpenHelp}>
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
          <DialogContent className="dialog-alert" showClose={false}>
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

function SwitchRow({
  checked,
  description,
  note,
  id,
  label,
  onCheckedChange
}: {
  checked: boolean;
  description: string;
  note?: string;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-switch-row" htmlFor={id}>
      <span className="settings-switch-text">
        <strong>{label}</strong>
        <small>{description}</small>
        {note ? <small className="settings-switch-note">{note}</small> : null}
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        className="settings-switch"
        id={id}
        onCheckedChange={onCheckedChange}
      />
    </label>
  );
}

// The "Cloud backup" block inside the Storage section. Three states, all inside
// the existing settings chrome (no new dialog): disconnected → connect;
// connected → a status row (account + last-backup time) with Back up now +
// Disconnect; reauth → a caution note + reconnect. The account never receives a
// copy of the work — the browser uploads straight to the user's own Dropbox,
// said once here.
function CloudBackupBlock({
  status,
  uploadStatus,
  accountLabel,
  lastCloudBackupAt,
  onConnect,
  onDisconnect,
  onRunBackup
}: {
  status: CloudBackupProviderStatus;
  uploadStatus: CloudBackupUploadStatus;
  accountLabel: string | null;
  lastCloudBackupAt: string | null;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  onRunBackup: () => Promise<void>;
}) {
  const uploading = uploadStatus === "uploading";
  return (
    <div className="settings-action-row">
      <div className="settings-action-text">
        <strong className="settings-action-title">Cloud backup</strong>
        {status === "connected" ? (
          <>
            <span className="settings-cloud-status-line">
              <CloudCheckIcon aria-hidden="true" size={14} />
              {accountLabel ? `Connected as ${accountLabel}` : "Connected"}
            </span>
            <p className="settings-action-note">
              {lastCloudBackupAt
                ? `Backed up ${formatBackupRelativeTime(lastCloudBackupAt)} · Backs up automatically.`
                : "Waiting for the first backup. Backs up automatically."}
            </p>
          </>
        ) : status === "reauthorization-required" ? (
          <span className="settings-cloud-status-line settings-cloud-status-caution">
            <CloudWarningIcon aria-hidden="true" size={14} />
            Dropbox access expired. Backups are paused.
          </span>
        ) : (
          <p className="settings-action-desc">
            Backs up this project to your Dropbox automatically. Sightlines never
            receives a copy.
          </p>
        )}
      </div>
      <div className="settings-action-buttons">
        {status === "connected" ? (
          <>
            <Button
              disabled={uploading}
              size="sm"
              variant="outline"
              onClick={() => void onRunBackup()}
            >
              {uploading ? "Backing up…" : "Back up now"}
            </Button>
            <button className="settings-link" type="button" onClick={onDisconnect}>
              Disconnect
            </button>
          </>
        ) : status === "reauthorization-required" ? (
          <Button size="sm" variant="outline" onClick={() => void onConnect()}>
            Reconnect Dropbox
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => void onConnect()}>
            Connect Dropbox
          </Button>
        )}
      </div>
    </div>
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
  hint,
  children
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-labelgroup">
        <label className="settings-row-label" htmlFor={htmlFor}>
          {label}
        </label>
        {hint ? <p className="settings-row-hint">{hint}</p> : null}
      </div>
      <div className="settings-row-control">{children}</div>
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
        size="compact"
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
