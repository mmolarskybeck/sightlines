// Pure Dropbox storage-inventory logic (no fetch): turns one recursive
// listing of the app folder into per-project groups, and holds the parsers and
// the delete-path guard the storage manager relies on.

import {
  isBareProjectIdFolderName,
  parseProjectFolderName,
  type DropboxFileEntry
} from "./dropboxAuth";
import type {
  StorageBackupFolder,
  StorageFile,
  StorageInventory,
  StorageProjectGroup,
  StorageSettings,
  StorageUsage
} from "./provider";
import {
  compareNewestFirst,
  isValidBackupsPerProject,
  storageGroupTotals
} from "./storagePlan";

export const STORAGE_SETTINGS_PATH = "/settings/storage.json";

type Area = "backups" | "shares";

export function buildStorageInventory(
  entries: DropboxFileEntry[],
  usage: StorageUsage | null,
  listedAtIso: string
): StorageInventory {
  const heads: Array<{ projectId: string; file: StorageFile }> = [];
  const backupFiles: Array<{ folder: string; file: StorageFile }> = [];
  const shareFiles: Array<{ folder: string; file: StorageFile }> = [];
  const otherFiles: StorageFile[] = [];

  for (const entry of entries) {
    if (entry[".tag"] === "folder") continue;
    if (!entry.path_display && !entry.path_lower) continue;
    const displayPath = entry.path_display ?? entry.path_lower!;
    const lower = (entry.path_lower ?? displayPath).toLowerCase();
    const lowerSegs = lower.split("/").filter(Boolean);
    const displaySegs = displayPath.split("/").filter(Boolean);
    const file: StorageFile = {
      path: displayPath,
      name: entry.name,
      sizeBytes: typeof entry.size === "number" ? entry.size : 0,
      serverModifiedIso: entry.server_modified ?? null,
      rev: entry.rev ?? null
    };
    if (lower === STORAGE_SETTINGS_PATH) continue;
    if (
      lowerSegs.length === 3 &&
      lowerSegs[0] === "projects" &&
      lowerSegs[2] === "current.sightlines" &&
      isBareProjectIdFolderName(lowerSegs[1])
    ) {
      heads.push({ projectId: lowerSegs[1], file });
    } else if (
      lowerSegs.length === 3 &&
      lowerSegs[0] === "backups" &&
      lowerSegs[2].endsWith(".sightlines")
    ) {
      backupFiles.push({ folder: displaySegs[1], file });
    } else if (
      lowerSegs.length === 3 &&
      lowerSegs[0] === "shares" &&
      lowerSegs[2].endsWith(".sightlines")
    ) {
      shareFiles.push({ folder: displaySegs[1], file });
    } else {
      otherFiles.push(file);
    }
  }

  const groups = new Map<string, StorageProjectGroup>();
  for (const { projectId, file } of heads) {
    groups.set(projectId, {
      key: projectId,
      projectId,
      idPrefix: projectId.slice(0, 8),
      title: null,
      head: file,
      backupFolders: [],
      shares: []
    });
  }

  const ensure = (
    key: string,
    projectId: string | null,
    idPrefix: string
  ): StorageProjectGroup => {
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        projectId,
        idPrefix,
        title: null,
        head: null,
        backupFolders: [],
        shares: []
      };
      groups.set(key, group);
    }
    return group;
  };

  const groupForFolder = (area: Area, name: string): StorageProjectGroup => {
    let fullId: string | null = null;
    let prefix = "";
    let title: string | null = null;
    if (isBareProjectIdFolderName(name)) {
      fullId = name.toLowerCase();
      prefix = fullId.slice(0, 8);
    } else {
      const parsed = parseProjectFolderName(name);
      if (parsed) {
        title = parsed.title;
        prefix = parsed.projectIdPrefix.toLowerCase();
      } else {
        title = name;
      }
    }
    let group: StorageProjectGroup;
    if (fullId) {
      group = ensure(fullId, fullId, prefix);
    } else if (prefix !== "") {
      const matches = [...groups.values()].filter(
        (g) => g.head !== null && g.projectId !== null && g.projectId.startsWith(prefix)
      );
      group =
        matches.length === 1 ? matches[0] : ensure(`prefix:${prefix}`, null, prefix);
    } else {
      group = ensure(`folder:${area}:${name.toLowerCase()}`, null, "");
    }
    if (group.title === null && title !== null) group.title = title;
    return group;
  };

  for (const { folder, file } of backupFiles) {
    const group = groupForFolder("backups", folder);
    let bucket: StorageBackupFolder | undefined = group.backupFolders.find(
      (f) => f.folderName.toLowerCase() === folder.toLowerCase()
    );
    if (!bucket) {
      bucket = { path: `/backups/${folder}`, folderName: folder, backups: [] };
      group.backupFolders.push(bucket);
    }
    bucket.backups.push(file);
  }
  for (const { folder, file } of shareFiles) {
    groupForFolder("shares", folder).shares.push(file);
  }

  const list = [...groups.values()];
  for (const group of list) {
    for (const folder of group.backupFolders) folder.backups.sort(compareNewestFirst);
    group.shares.sort(compareNewestFirst);
  }
  list.sort(
    (a, b) =>
      storageGroupTotals(b).totalBytes - storageGroupTotals(a).totalBytes ||
      a.key.localeCompare(b.key)
  );
  return { groups: list, otherFiles, usage, listedAtIso };
}

export function parseSpaceUsage(body: unknown): StorageUsage | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { used?: unknown; allocation?: unknown };
  if (typeof record.used !== "number" || !Number.isFinite(record.used)) return null;
  const allocated =
    record.allocation && typeof record.allocation === "object"
      ? (record.allocation as { allocated?: unknown }).allocated
      : undefined;
  return {
    usedBytes: record.used,
    allocatedBytes:
      typeof allocated === "number" && Number.isFinite(allocated) ? allocated : null
  };
}

export function isDeletableStoragePath(path: string): boolean {
  if (!/^\/(backups|shares)\/[^/]+\/[^/]+\.sightlines$/i.test(path)) return false;
  return !path.split("/").some((segment) => segment === "." || segment === "..");
}

export function parseStorageSettings(text: string): StorageSettings | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { version?: unknown; backupsPerProject?: unknown };
  if (obj.version !== 1 || !isValidBackupsPerProject(obj.backupsPerProject)) return null;
  return { backupsPerProject: obj.backupsPerProject };
}

export function serializeStorageSettings(
  settings: StorageSettings,
  updatedAtIso: string
): string {
  return JSON.stringify({
    version: 1,
    backupsPerProject: settings.backupsPerProject,
    updatedAtIso
  });
}
