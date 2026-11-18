// Dropbox storage manager (docs/dropbox-storage-plan.md phase 2): lists what
// this app stores per project, trims old backups to an account-wide "keep the
// newest N" limit, and removes individual shared snapshots. Sync heads are
// never deletable from here — the plan only ever names backup files, and a
// share is removed one explicit file at a time.

import {
  CloudBackupError,
  type CloudBackupProvider,
  type StorageDeleteResult,
  type StorageFile,
  type StorageInventory,
  type StorageSettings
} from "../cloud/provider";
import {
  confirmTrimAgainstFresh,
  planBackupTrim,
  type BackupTrimPlan
} from "../cloud/storagePlan";
import type { AppState, AppStoreDeps } from "../store";
import { providerStatusPatch } from "./cloudBackupSlice";

export type CloudStorageStatus = "idle" | "loading" | "loaded" | "error" | "reauth-required";

export type CloudStorageCleanupResult = {
  kind: "trim" | "share";
  // Outcomes "deleted" + "gone".
  removedCount: number;
  // sizeBytes of those files.
  removedBytes: number;
  // Previewed-but-not-confirmed files + outcome "changed".
  skippedCount: number;
  // Outcome "failed" (+ every previewed file if the fresh inventory could not
  // be read).
  failedCount: number;
  // trim: writeStorageSettings succeeded; share: always true.
  settingSaved: boolean;
};

export type CloudStorageSliceState = {
  // null = never listed.
  cloudStorage: StorageInventory | null;
  cloudStorageStatus: CloudStorageStatus;
  cloudStorageError: string | null;
  // null = none saved / unknown → the UI uses DEFAULT_BACKUPS_PER_PROJECT.
  cloudStorageSettings: StorageSettings | null;
  cloudStorageBusy: "trim" | "share" | null;
  cloudStorageLastResult: CloudStorageCleanupResult | null;
};

export type CloudStorageSliceActions = {
  refreshCloudStorage: () => Promise<void>;
  applyBackupTrim: (previewed: BackupTrimPlan) => Promise<CloudStorageCleanupResult | null>;
  removeCloudShare: (file: StorageFile) => Promise<CloudStorageCleanupResult | null>;
  clearCloudStorageResult: () => void;
};

export const CLOUD_STORAGE_SLICE_INITIAL: CloudStorageSliceState = {
  cloudStorage: null,
  cloudStorageStatus: "idle",
  cloudStorageError: null,
  cloudStorageSettings: null,
  cloudStorageBusy: null,
  cloudStorageLastResult: null
};

export type CloudStorageSliceInternals = {
  deps: AppStoreDeps;
};

const READ_FAILED_MESSAGE = "Couldn't read your Dropbox.";

function isReauth(error: unknown): boolean {
  return error instanceof CloudBackupError && error.kind === "reauth";
}

function isRemoved(result: StorageDeleteResult): boolean {
  return result.outcome === "deleted" || result.outcome === "gone";
}

export function createCloudStorageSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: CloudStorageSliceInternals
): { actions: CloudStorageSliceActions } {
  const { deps } = internals;

  function provider(): CloudBackupProvider | null {
    return deps.cloudBackupProvider ?? null;
  }

  function markReauth(active: CloudBackupProvider): void {
    set({
      cloudStorageStatus: "reauth-required",
      ...providerStatusPatch(active)
    });
  }

  // Per-file delete, with a thrown call (the provider refusing a path, or a
  // transport failure before any result) read as every file failing.
  async function deleteFiles(
    active: CloudBackupProvider,
    files: StorageFile[]
  ): Promise<StorageDeleteResult[]> {
    if (files.length === 0) return [];
    try {
      return await active.deleteStorageFiles(
        files.map((file) => ({ path: file.path, rev: file.rev }))
      );
    } catch {
      return files.map((file) => ({ path: file.path, outcome: "failed" as const }));
    }
  }

  const actions: CloudStorageSliceActions = {
    async refreshCloudStorage() {
      const active = provider();
      if (!active || active.getStatus() !== "connected") {
        set({ ...CLOUD_STORAGE_SLICE_INITIAL });
        return;
      }

      // The previous inventory stays on screen while this one loads.
      set({ cloudStorageStatus: "loading" });
      const [inventory, settings] = await Promise.allSettled([
        active.getStorageInventory(),
        active.readStorageSettings()
      ]);

      // A settings read failure is not a reason to forget a saved limit.
      if (settings.status === "fulfilled") {
        set({ cloudStorageSettings: settings.value });
      }

      if (inventory.status === "fulfilled") {
        set({
          cloudStorage: inventory.value,
          cloudStorageStatus: "loaded",
          cloudStorageError: null
        });
        return;
      }
      if (isReauth(inventory.reason)) {
        markReauth(active);
        return;
      }
      set({
        cloudStorageStatus: "error",
        cloudStorageError:
          inventory.reason instanceof Error ? inventory.reason.message : READ_FAILED_MESSAGE,
        ...providerStatusPatch(active)
      });
    },

    async applyBackupTrim(previewed) {
      const active = provider();
      if (!active || get().cloudStorageBusy !== null) return null;

      set({ cloudStorageBusy: "trim", cloudStorageLastResult: null });
      let result: CloudStorageCleanupResult | null = null;
      let reauth = false;
      try {
        // The limit first: it is what future backups obey, and it is worth
        // saving even when nothing is removed today.
        const settingSaved = await active
          .writeStorageSettings({ backupsPerProject: previewed.keep })
          .then(
            () => true,
            () => false
          );
        if (settingSaved) {
          set({ cloudStorageSettings: { backupsPerProject: previewed.keep } });
        }

        if (previewed.removeCount === 0) {
          result = {
            kind: "trim",
            removedCount: 0,
            removedBytes: 0,
            skippedCount: 0,
            failedCount: 0,
            settingSaved
          };
        } else {
          let fresh: StorageInventory | null = null;
          try {
            fresh = await active.getStorageInventory();
          } catch (error) {
            if (isReauth(error)) {
              reauth = true;
              markReauth(active);
            }
          }

          if (fresh === null) {
            // Without a fresh read nothing can be confirmed, so nothing is
            // deleted.
            result = {
              kind: "trim",
              removedCount: 0,
              removedBytes: 0,
              skippedCount: 0,
              failedCount: previewed.removeCount,
              settingSaved
            };
          } else {
            const confirmed = confirmTrimAgainstFresh(
              previewed,
              planBackupTrim(fresh, previewed.keep)
            );
            const results = await deleteFiles(active, confirmed);
            const sizeByPath = new Map(confirmed.map((file) => [file.path, file.sizeBytes]));
            const removed = results.filter(isRemoved);
            result = {
              kind: "trim",
              removedCount: removed.length,
              removedBytes: removed.reduce(
                (sum, entry) => sum + (sizeByPath.get(entry.path) ?? 0),
                0
              ),
              skippedCount:
                previewed.removeCount -
                confirmed.length +
                results.filter((entry) => entry.outcome === "changed").length,
              failedCount: results.filter((entry) => entry.outcome === "failed").length,
              settingSaved
            };
            if (results.some((entry) => entry.errorKind === "reauth")) {
              reauth = true;
              markReauth(active);
            }
          }
        }

        set({ cloudStorageLastResult: result, cloudStorageBusy: null });
      } finally {
        set({ cloudStorageBusy: null });
      }

      if (!reauth) await get().refreshCloudStorage();
      return result;
    },

    async removeCloudShare(file) {
      const active = provider();
      if (!active || get().cloudStorageBusy !== null) return null;

      set({ cloudStorageBusy: "share", cloudStorageLastResult: null });
      let result: CloudStorageCleanupResult | null = null;
      let reauth = false;
      try {
        const [entry] = await deleteFiles(active, [file]);
        const removed = entry !== undefined && isRemoved(entry);
        result = {
          kind: "share",
          removedCount: removed ? 1 : 0,
          removedBytes: removed ? file.sizeBytes : 0,
          skippedCount: entry?.outcome === "changed" ? 1 : 0,
          failedCount: entry === undefined || entry.outcome === "failed" ? 1 : 0,
          settingSaved: true
        };
        if (entry?.errorKind === "reauth") {
          reauth = true;
          markReauth(active);
        }
        set({ cloudStorageLastResult: result, cloudStorageBusy: null });
      } finally {
        set({ cloudStorageBusy: null });
      }

      if (!reauth) await get().refreshCloudStorage();
      return result;
    },

    clearCloudStorageResult() {
      set({ cloudStorageLastResult: null });
    }
  };

  return { actions };
}
