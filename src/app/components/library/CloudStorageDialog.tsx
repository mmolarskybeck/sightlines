import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import type { StorageFile, StorageInventory, StorageProjectGroup } from "../../cloud/provider";
import {
  BACKUPS_PER_PROJECT_CHOICES,
  DEFAULT_BACKUPS_PER_PROJECT,
  planBackupTrim,
  sightlinesStoredBytes,
  storageGroupTotals
} from "../../cloud/storagePlan";
import { useAppStore } from "../../store";
import type { CloudStorageCleanupResult } from "../../store/cloudStorageSlice";
import { pluralize } from "../shared/pluralize";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Progress } from "../ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { formatStorageBytes } from "./formatStorageBytes";

type LocalProject = { id: string; title: string };

// What Sightlines keeps in the user's Dropbox, by project (docs/dropbox-
// storage-plan.md phase 2): space used, the account-wide backup limit with a
// trim preview, and per-share removal. Synced copies are shown, never offered
// for deletion.
export function CloudStorageDialog({
  open,
  onOpenChange,
  localProjects
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  localProjects: LocalProject[] | null;
}) {
  const inventory = useAppStore((state) => state.cloudStorage);
  const status = useAppStore((state) => state.cloudStorageStatus);
  const error = useAppStore((state) => state.cloudStorageError);
  const settings = useAppStore((state) => state.cloudStorageSettings);
  const busy = useAppStore((state) => state.cloudStorageBusy);
  const lastResult = useAppStore((state) => state.cloudStorageLastResult);
  const refreshCloudStorage = useAppStore((state) => state.refreshCloudStorage);
  const applyBackupTrim = useAppStore((state) => state.applyBackupTrim);
  const removeCloudShare = useAppStore((state) => state.removeCloudShare);
  const clearCloudStorageResult = useAppStore((state) => state.clearCloudStorageResult);
  const connectCloudBackup = useAppStore((state) => state.connectCloudBackup);

  // Fire on the open transition only, not on every render while open.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      clearCloudStorageResult();
      void refreshCloudStorage();
    }
    wasOpen.current = open;
  }, [open, clearCloudStorageResult, refreshCloudStorage]);

  let body: ReactNode;
  if (status === "reauth-required") {
    body = (
      <p className="cloud-storage-state">
        Reconnect Dropbox to manage storage.
        <Button size="sm" variant="outline" onClick={() => void connectCloudBackup()}>
          Reconnect Dropbox
        </Button>
      </p>
    );
  } else if (inventory === null && status === "error") {
    body = (
      <p className="cloud-storage-state">
        {error}
        <Button size="sm" variant="outline" onClick={() => void refreshCloudStorage()}>
          Try again
        </Button>
      </p>
    );
  } else if (inventory === null) {
    body = (
      <p className="cloud-storage-state">
        <CircleNotchIcon aria-hidden="true" className="animate-spin" size={14} />
        <span>Reading your Dropbox…</span>
      </p>
    );
  } else {
    body = (
      <>
        {status === "error" ? (
          // A failed refresh keeps the last rows, but must not pass them off as
          // current — this is also how a failed post-cleanup refresh surfaces.
          <p className="cloud-storage-state" role="alert">
            {error} The figures below may be out of date.
            <Button size="sm" variant="outline" onClick={() => void refreshCloudStorage()}>
              Try again
            </Button>
          </p>
        ) : null}
        <UsageSection inventory={inventory} />
        <BackupHistorySection
          busy={busy}
          currentLimit={settings?.backupsPerProject ?? DEFAULT_BACKUPS_PER_PROJECT}
          inventory={inventory}
          lastResult={lastResult}
          onApply={(plan) => void applyBackupTrim(plan)}
        />
        <ProjectsSection
          busy={busy}
          groups={inventory.groups}
          lastResult={lastResult}
          localProjects={localProjects}
          onRemoveShare={removeCloudShare}
        />
        {inventory.otherFiles.length > 0 ? (
          <p className="cloud-storage-muted">
            Other files in the Sightlines folder: {pluralize(inventory.otherFiles.length, "file")},{" "}
            {formatStorageBytes(
              inventory.otherFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
            )}
            . Sightlines doesn't manage these.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cloud-storage-dialog">
        <DialogHeader>
          <DialogTitle>Dropbox storage</DialogTitle>
          {inventory !== null && status === "loading" ? (
            <span className="cloud-storage-updating">Updating…</span>
          ) : null}
        </DialogHeader>
        <div className="cloud-storage-body">
          <DialogDescription className="cloud-storage-intro">
            What Sightlines keeps in your Dropbox, by project. Removing files here never changes
            the projects on this device.
          </DialogDescription>
          {body}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UsageSection({ inventory }: { inventory: StorageInventory }) {
  const usage = inventory.usage;
  return (
    <section aria-label="Space used" className="cloud-storage-section">
      {usage === null ? (
        <p className="cloud-storage-text">Couldn't read your Dropbox space usage.</p>
      ) : usage.allocatedBytes !== null && usage.allocatedBytes > 0 ? (
        <>
          <p className="cloud-storage-text">
            {formatStorageBytes(usage.usedBytes)} of {formatStorageBytes(usage.allocatedBytes)}{" "}
            used
          </p>
          <Progress
            aria-label="Dropbox space used"
            className="cloud-storage-progress"
            value={Math.round((usage.usedBytes / usage.allocatedBytes) * 100)}
          />
        </>
      ) : (
        <p className="cloud-storage-text">{formatStorageBytes(usage.usedBytes)} used</p>
      )}
      <p className="cloud-storage-muted">
        Sightlines files: {formatStorageBytes(sightlinesStoredBytes(inventory))}. Space used counts
        everything in your Dropbox, not only Sightlines.
      </p>
    </section>
  );
}

function BackupHistorySection({
  busy,
  currentLimit,
  inventory,
  lastResult,
  onApply
}: {
  busy: "trim" | "share" | null;
  currentLimit: number;
  inventory: StorageInventory;
  lastResult: CloudStorageCleanupResult | null;
  onApply: (plan: ReturnType<typeof planBackupTrim>) => void;
}) {
  const [keep, setKeep] = useState(currentLimit);
  useEffect(() => {
    setKeep(currentLimit);
  }, [currentLimit]);

  const choices = useMemo(() => {
    const values = new Set<number>(BACKUPS_PER_PROJECT_CHOICES);
    values.add(currentLimit);
    return [...values].sort((a, b) => a - b);
  }, [currentLimit]);

  const plan = useMemo(() => planBackupTrim(inventory, keep), [inventory, keep]);
  const isTrimming = busy === "trim";

  return (
    <section aria-labelledby="cloud-storage-backups-heading" className="cloud-storage-section">
      <h3 className="cloud-storage-heading" id="cloud-storage-backups-heading">
        Backup history
      </h3>
      <p className="cloud-storage-text">
        After each backup, Sightlines removes older backups of that project beyond this limit.
        Every device uses the same limit.
      </p>
      <div className="cloud-storage-field">
        <span className="cloud-storage-label">Keep per project</span>
        <Select value={String(keep)} onValueChange={(value) => setKeep(Number(value))}>
          <SelectTrigger aria-label="Backups to keep per project" className="cloud-storage-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((value) => (
              <SelectItem key={value} value={String(value)}>
                Newest {pluralize(value, "backup")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {plan.removeCount > 0 ? (
        <div className="cloud-storage-action-row">
          <p className="cloud-storage-text">
            Removes {pluralize(plan.removeCount, "older backup")} from{" "}
            {pluralize(plan.folders.length, "project folder")}, about{" "}
            {formatStorageBytes(plan.reclaimableBytes)}. Synced copies and shared links are not
            touched.
          </p>
          <Button
            aria-busy={isTrimming}
            disabled={busy !== null}
            size="sm"
            variant="destructive"
            onClick={() => onApply(plan)}
          >
            {isTrimming ? (
              <CircleNotchIcon aria-hidden="true" className="animate-spin" size={14} />
            ) : null}
            <span>Remove {pluralize(plan.removeCount, "older backup")}</span>
          </Button>
        </div>
      ) : keep !== currentLimit ? (
        <div className="cloud-storage-action-row">
          <p className="cloud-storage-text">
            Nothing to remove now. Future backups will keep the newest {keep}.
          </p>
          <Button
            aria-busy={isTrimming}
            disabled={busy !== null}
            size="sm"
            onClick={() => onApply(plan)}
          >
            {isTrimming ? (
              <CircleNotchIcon aria-hidden="true" className="animate-spin" size={14} />
            ) : null}
            <span>Save limit</span>
          </Button>
        </div>
      ) : (
        <p className="cloud-storage-text">Every project is within this limit.</p>
      )}

      {lastResult?.kind === "trim" ? (
        <p className="cloud-storage-result" role="status">
          {trimResultMessage(lastResult, currentLimit)}
        </p>
      ) : null}
    </section>
  );
}

function trimResultMessage(result: CloudStorageCleanupResult, currentLimit: number): string {
  let message =
    result.removedCount > 0
      ? `Removed ${pluralize(result.removedCount, "backup")} (${formatStorageBytes(result.removedBytes)}).`
      : "No backups removed.";
  if (result.skippedCount > 0) {
    message += ` ${pluralize(result.skippedCount, "backup")} changed since the preview and ${
      result.skippedCount === 1 ? "was" : "were"
    } left alone.`;
  }
  if (result.failedCount > 0) {
    message += ` ${pluralize(result.failedCount, "backup")} couldn't be removed. Try again.`;
  }
  if (!result.settingSaved) {
    message += ` The new limit couldn't be saved to Dropbox, so future backups still keep the newest ${currentLimit}.`;
  }
  return message;
}

function ProjectsSection({
  busy,
  groups,
  lastResult,
  localProjects,
  onRemoveShare
}: {
  busy: "trim" | "share" | null;
  groups: StorageProjectGroup[];
  lastResult: CloudStorageCleanupResult | null;
  localProjects: LocalProject[] | null;
  onRemoveShare: (file: StorageFile) => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);

  const removeShare = async (file: StorageFile) => {
    await onRemoveShare(file);
    setConfirmingPath(null);
  };

  return (
    <section aria-labelledby="cloud-storage-projects-heading" className="cloud-storage-section">
      <h3 className="cloud-storage-heading" id="cloud-storage-projects-heading">
        By project
      </h3>
      {lastResult?.kind === "share" ? (
        <p className="cloud-storage-result" role="status">
          {shareResultMessage(lastResult)}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="cloud-storage-text">Sightlines hasn't stored anything in this Dropbox yet.</p>
      ) : (
        <div aria-label="Stored projects" className="cloud-storage-list" role="list">
          {groups.map((group) => {
            const totals = storageGroupTotals(group);
            const local = localProjects?.find((project) => project.id === group.projectId);
            const title = group.title ?? local?.title ?? `Synced project ${group.idPrefix}`;
            const onThisDevice = isOnThisDevice(group, localProjects);
            const meta = [formatStorageBytes(totals.totalBytes)];
            if (group.head) meta.push(`Synced copy ${formatStorageBytes(totals.headBytes)}`);
            if (totals.backupCount > 0) {
              meta.push(
                `${pluralize(totals.backupCount, "backup")}, ${formatStorageBytes(totals.backupBytes)}`
              );
            }
            if (totals.shareCount > 0) {
              meta.push(
                `${pluralize(totals.shareCount, "shared link")}, ${formatStorageBytes(totals.shareBytes)}`
              );
            }
            const isExpanded = expanded[group.key] === true;

            return (
              <div className="cloud-storage-group" key={group.key} role="listitem">
                <div className="project-manager-row">
                  <div className="project-manager-cloud-summary">
                    <span className="project-manager-title">
                      {title}
                      {onThisDevice ? (
                        <span className="project-manager-cloud-tag">On this device</span>
                      ) : null}
                    </span>
                    <span className="project-manager-meta">{meta.join(" · ")}</span>
                  </div>
                  {group.shares.length > 0 ? (
                    <div className="project-manager-actions">
                      <Button
                        aria-expanded={isExpanded}
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpanded((current) => ({ ...current, [group.key]: !isExpanded }))
                        }
                      >
                        Shared links ({group.shares.length})
                      </Button>
                    </div>
                  ) : null}
                </div>

                {isExpanded ? (
                  <div className="cloud-storage-shares" role="list">
                    {group.shares.map((share) => {
                      const date = formatShareDate(share.serverModifiedIso);
                      const label = share.name.replace(/\.sightlines$/i, "");
                      const isConfirming = confirmingPath === share.path;
                      return (
                        <div className="cloud-storage-share" key={share.path} role="listitem">
                          {isConfirming ? (
                            <div className="cloud-storage-confirm">
                              <p className="cloud-storage-text">
                                Remove the link to “{label}”, shared {date}? It stops working
                                for anyone you sent it to. Copies they already saved are
                                unaffected.
                              </p>
                              <div className="cloud-storage-confirm-actions">
                                <Button
                                  aria-busy={busy === "share"}
                                  disabled={busy !== null}
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => void removeShare(share)}
                                >
                                  {busy === "share" ? (
                                    <CircleNotchIcon
                                      aria-hidden="true"
                                      className="animate-spin"
                                      size={14}
                                    />
                                  ) : null}
                                  <span>Remove link</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setConfirmingPath(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <span className="cloud-storage-share-label">
                                <span className="cloud-storage-share-date">{date}</span>
                                <span className="project-manager-meta">
                                  {label} · {formatStorageBytes(share.sizeBytes)}
                                </span>
                              </span>
                              <Button
                                aria-label={`Remove shared link ${label}`}
                                className="cloud-storage-share-remove"
                                disabled={busy !== null}
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmingPath(share.path)}
                              >
                                Remove…
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function shareResultMessage(result: CloudStorageCleanupResult): string {
  if (result.removedCount > 0) {
    return `Shared link removed (${formatStorageBytes(result.removedBytes)}).`;
  }
  if (result.skippedCount > 0) {
    return "That shared link changed since this list was read, so it was left alone.";
  }
  return "That shared link couldn't be removed. Try again.";
}

// A full id match is proof; a bare 8-char prefix counts only when exactly one
// local project could own it.
function isOnThisDevice(group: StorageProjectGroup, localProjects: LocalProject[] | null): boolean {
  if (!localProjects) return false;
  if (group.projectId !== null) {
    return localProjects.some((project) => project.id === group.projectId);
  }
  if (group.idPrefix === "") return false;
  return localProjects.filter((project) => project.id.startsWith(group.idPrefix)).length === 1;
}

function formatShareDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  // Time included: two snapshots shared the same day must not look identical.
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
