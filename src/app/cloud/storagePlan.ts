// Pure planning for Dropbox storage cleanup (docs/dropbox-storage-plan.md
// phase 2). Provider-agnostic: works on the StorageInventory the provider
// returns. A plan only ever names BACKUP files — sync heads and shares are
// outside it by construction; shares are removed one at a time, explicitly.

import type {
  StorageFile,
  StorageInventory,
  StorageProjectGroup
} from "./provider";

// Today's built-in retention, used when no account setting was ever saved.
export const DEFAULT_BACKUPS_PER_PROJECT = 5;
// The choices the storage dialog offers.
export const BACKUPS_PER_PROJECT_CHOICES = [1, 2, 3, 5] as const;
// What a stored setting may hold; anything else reads as "no setting". The
// ceiling MUST NOT exceed DEFAULT_BACKUPS_PER_PROJECT: upload-time pruning falls
// back to the default when it cannot read the setting, and a fallback below the
// saved limit would delete backups the user chose to keep.
export const MIN_BACKUPS_PER_PROJECT = 1;
export const MAX_BACKUPS_PER_PROJECT = DEFAULT_BACKUPS_PER_PROJECT;

export function isValidBackupsPerProject(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_BACKUPS_PER_PROJECT &&
    value <= MAX_BACKUPS_PER_PROJECT
  );
}

export type BackupTrimFolderPlan = {
  groupKey: string;
  folderPath: string;
  retain: StorageFile[];
  remove: StorageFile[];
};

export type BackupTrimPlan = {
  keep: number;
  // Only folders with something to remove.
  folders: BackupTrimFolderPlan[];
  removeCount: number;
  // Exact for self-contained packages: each removed file's own size.
  reclaimableBytes: number;
};

// Newest first: server_modified desc, then name desc (names carry a
// timestamp, so this matches time order when Dropbox omits server_modified).
// The same order selectBackupsToPrune keeps, so the preview agrees with what
// upload-time pruning would do.
export function compareNewestFirst(a: StorageFile, b: StorageFile): number {
  return (
    (b.serverModifiedIso ?? "").localeCompare(a.serverModifiedIso ?? "") ||
    b.name.localeCompare(a.name)
  );
}

// Retention is per backup FOLDER (the unit the app wrote), never per display
// group: two folders joined only by an 8-char prefix are not proof of one
// project.
export function planBackupTrim(inventory: StorageInventory, keep: number): BackupTrimPlan {
  if (!isValidBackupsPerProject(keep)) {
    throw new RangeError(`keep must be an integer ${MIN_BACKUPS_PER_PROJECT}–${MAX_BACKUPS_PER_PROJECT}`);
  }
  const folders: BackupTrimFolderPlan[] = [];
  for (const group of inventory.groups) {
    for (const folder of group.backupFolders) {
      const sorted = [...folder.backups].sort(compareNewestFirst);
      const remove = sorted.slice(keep);
      if (remove.length === 0) continue;
      folders.push({
        groupKey: group.key,
        folderPath: folder.path,
        retain: sorted.slice(0, keep),
        remove
      });
    }
  }
  const removed = folders.flatMap((folder) => folder.remove);
  return {
    keep,
    folders,
    removeCount: removed.length,
    reclaimableBytes: removed.reduce((sum, file) => sum + file.sizeBytes, 0)
  };
}

// The files safe to delete at apply time: in BOTH the plan the user previewed
// and a plan recomputed from a fresh inventory, matched on lowercased path AND
// rev. Anything that changed, vanished, or is no longer selected is left alone.
export function confirmTrimAgainstFresh(
  previewed: BackupTrimPlan,
  fresh: BackupTrimPlan
): StorageFile[] {
  const freshKeys = new Set(
    fresh.folders.flatMap((folder) => folder.remove).map(fileKey)
  );
  return previewed.folders
    .flatMap((folder) => folder.remove)
    .filter((file) => freshKeys.has(fileKey(file)));
}

function fileKey(file: StorageFile): string {
  return `${file.path.toLowerCase()}\u0001${file.rev ?? ""}`;
}

export type StorageGroupTotals = {
  headBytes: number;
  backupCount: number;
  backupBytes: number;
  shareCount: number;
  shareBytes: number;
  totalBytes: number;
};

export function storageGroupTotals(group: StorageProjectGroup): StorageGroupTotals {
  const backups = group.backupFolders.flatMap((folder) => folder.backups);
  const headBytes = group.head?.sizeBytes ?? 0;
  const backupBytes = backups.reduce((sum, file) => sum + file.sizeBytes, 0);
  const shareBytes = group.shares.reduce((sum, file) => sum + file.sizeBytes, 0);
  return {
    headBytes,
    backupCount: backups.length,
    backupBytes,
    shareCount: group.shares.length,
    shareBytes,
    totalBytes: headBytes + backupBytes + shareBytes
  };
}

// Sum of every file this app wrote (plus unrecognized app-folder files).
export function sightlinesStoredBytes(inventory: StorageInventory): number {
  return (
    inventory.groups.reduce((sum, group) => sum + storageGroupTotals(group).totalBytes, 0) +
    inventory.otherFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
  );
}
