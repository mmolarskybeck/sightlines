import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { CloudIcon } from "@phosphor-icons/react/dist/csr/Cloud";
import { CloudCheckIcon } from "@phosphor-icons/react/dist/csr/CloudCheck";
import { CloudWarningIcon } from "@phosphor-icons/react/dist/csr/CloudWarning";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import {
  getDropboxRowState,
  getStatusBadgeDisplay,
  getStatusBadgeTooltip,
  type CloudBackupCloudIcon,
  type DropboxRowAction
} from "../../cloud/cloudBackupCopy";
import { CLOUD_BACKUP_CONFIGURED } from "../../cloud/configured";
import {
  getStorageNoteCopy,
  type StoragePersistenceState
} from "../../hooks/useStoragePersistence";
import { useSyncLinked } from "../../hooks/useSyncLink";
import { useAppStore } from "../../store";
import { StatusBadge } from "../toolbar";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useCloudActions } from "./useCloudActions";

// The save/backup status badge and the popover behind it. Every field it shows
// is store state, read here rather than threaded through the top bar; only the
// two things App owns (durable-storage state, the export it launches) and the
// Settings handoff arrive as props.
export function CloudStatusPopover({
  storagePersistence,
  onExportBackup,
  onOpenSettings
}: {
  storagePersistence: StoragePersistenceState;
  onExportBackup: () => void;
  onOpenSettings: () => void;
}) {
  const saveState = useAppStore((state) => state.saveState);
  const cloudBackupProviderStatus = useAppStore(
    (state) => state.cloudBackupProviderStatus
  );
  const cloudBackupStatus = useAppStore((state) => state.cloudBackupStatus);
  const lastCloudBackupAt = useAppStore((state) => state.lastCloudBackupAt);
  const cloudBackupPending = useAppStore((state) => state.cloudBackupPending);
  // Sync for the OPEN project: linked = this device holds usable sync metadata
  // for it. Status and error are the sync loop's own, kept apart from the
  // backup upload status they are folded together with for display only.
  const syncLinked = useSyncLinked();
  const syncStatus = useAppStore((state) => state.syncStatus);
  const syncError = useAppStore((state) => state.syncError);
  const enableProjectSync = useAppStore((state) => state.enableProjectSync);
  const checkProjectSync = useAppStore((state) => state.checkProjectSync);
  const { runCloudAction } = useCloudActions({ onOpenSettings });

  const badgeDisplay = getStatusBadgeDisplay({
    saveState,
    configured: CLOUD_BACKUP_CONFIGURED,
    providerStatus: cloudBackupProviderStatus,
    uploadStatus: cloudBackupStatus,
    pending: cloudBackupPending,
    lastCloudBackupAt
  });
  const cloudConnected =
    CLOUD_BACKUP_CONFIGURED && cloudBackupProviderStatus === "connected";
  const badgeTooltip = getStatusBadgeTooltip(badgeDisplay, cloudConnected);
  const dropboxRow = getDropboxRowState({
    backup: {
      configured: CLOUD_BACKUP_CONFIGURED,
      status: cloudBackupProviderStatus,
      uploadStatus: cloudBackupStatus,
      lastCloudBackupAt,
      pending: cloudBackupPending
    },
    sync: { linked: syncLinked, status: syncStatus, error: syncError }
  });
  // One dispatcher for the merged row's union. "Review" is the same gesture as
  // a manual check: it clears a postponed ("Not now") project and re-evaluates,
  // which re-parks the conflict dialog when the two versions really have both
  // moved on. "Enable" covers both turning sync on and retrying an enable that
  // failed — the row layer decides which retry an error gets, because it knows
  // whether any metadata exists.
  const runDropboxRowAction = (action: DropboxRowAction) => {
    if (action === "enable") void enableProjectSync();
    else if (action === "sync-now" || action === "review") {
      void checkProjectSync({ manual: true });
    } else if (action === "backup-retry") runCloudAction("retry");
    else runCloudAction(action);
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <StatusBadge
              state={saveState}
              tone={badgeDisplay.tone}
              label={badgeDisplay.label}
              cloud={badgeDisplay.cloud}
            />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          {badgeTooltip}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="end" className="storage-popover">
        <div className="storage-popover-heading">
          <h3>Save &amp; backup</h3>
        </div>
        <div className="storage-popover-destinations">
          <section className="storage-popover-destination">
            <FloppyDiskIcon
              aria-hidden="true"
              className="storage-popover-destination-icon"
              size={16}
            />
            <div className="storage-popover-destination-copy">
              <h4>On this device</h4>
              <p>{getStorageNoteCopy(storagePersistence)}</p>
            </div>
          </section>
          {/* One Dropbox row, not one per mechanism: the curator is owed a
              single answer about the copy in Dropbox — is it there, and is
              it on the other devices. Backup and sync remain separate
              machinery behind it; the row states whichever needs a decision
              first and offers that state's one next step. Turning sync OFF
              lives in Settings — this row stays status + next step. */}
          <section
            className={`storage-popover-destination storage-popover-cloud-${dropboxRow.tone}`}
          >
            <CloudRowIcon icon={dropboxRow.icon} />
            <div className="storage-popover-destination-copy">
              <h4>Dropbox</h4>
              <p>{dropboxRow.text}</p>
              {dropboxRow.action ? (
                <Button
                  className="storage-popover-row-action"
                  disabled={dropboxRow.actionDisabled}
                  size="sm"
                  variant="ghost"
                  onClick={() => runDropboxRowAction(dropboxRow.action!)}
                >
                  {dropboxRow.actionLabel}
                </Button>
              ) : null}
            </div>
          </section>
        </div>
        <div className="storage-popover-footer">
          <Button size="sm" variant="outline" onClick={onExportBackup}>
            <DownloadSimpleIcon aria-hidden="true" size={15} />
            Export backup file
          </Button>
          <button className="settings-link" type="button" onClick={onOpenSettings}>
            Storage settings
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// The state-matched cloud glyph for the save-status popover row. The spinner
// reuses the shared animate-spin (suppressed under reduced motion in
// global.css); every glyph is decorative, so the row's text carries meaning.
function CloudRowIcon({ icon }: { icon: CloudBackupCloudIcon }) {
  if (icon === "cloud-spinner") {
    return (
      <CircleNotchIcon
        aria-hidden="true"
        className="storage-popover-cloud-icon animate-spin"
        size={15}
      />
    );
  }
  const Glyph =
    icon === "cloud-check"
      ? CloudCheckIcon
      : icon === "cloud-warning"
        ? CloudWarningIcon
        : CloudIcon;
  return <Glyph aria-hidden="true" className="storage-popover-cloud-icon" size={15} />;
}
