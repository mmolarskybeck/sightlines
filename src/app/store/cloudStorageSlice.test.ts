import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudBackupError,
  type CloudBackupProvider,
  type StorageDeleteResult,
  type StorageFile,
  type StorageInventory,
  type StorageSettings
} from "../cloud/provider";
import { planBackupTrim } from "../cloud/storagePlan";
import { createInertCrossTabSync } from "../crossTabSync";
import { createAppStore, type AppStoreDeps } from "../store";
import { makeFakeCloudBackupProvider } from "../../test/fakeCloudBackupProvider";
import { createTestAppStore } from "../../test/testAppStore";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));

const FOLDER = "/backups/Winter Show — 1a2b3c4d";

function backup(day: number, rev = `rev-${day}`): StorageFile {
  const name = `2026-08-${String(day).padStart(2, "0")}.sightlines`;
  return {
    path: `${FOLDER}/${name}`,
    name,
    sizeBytes: 1000 * day,
    serverModifiedIso: `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    rev
  };
}

const HEAD: StorageFile = {
  path: "/projects/1a2b3c4d-1111-2222-3333-444455556666/current.sightlines",
  name: "current.sightlines",
  sizeBytes: 9000,
  serverModifiedIso: "2026-08-20T10:00:00.000Z",
  rev: "head-rev"
};

const SHARE: StorageFile = {
  path: "/shares/Winter Show — 1a2b3c4d/share-1.sightlines",
  name: "share-1.sightlines",
  sizeBytes: 5000,
  serverModifiedIso: "2026-08-15T10:00:00.000Z",
  rev: "share-rev"
};

function inventory(backups: StorageFile[]): StorageInventory {
  return {
    groups: [
      {
        key: "1a2b3c4d-1111-2222-3333-444455556666",
        projectId: "1a2b3c4d-1111-2222-3333-444455556666",
        idPrefix: "1a2b3c4d",
        title: "Winter Show",
        head: HEAD,
        backupFolders: [
          { path: FOLDER, folderName: "Winter Show — 1a2b3c4d", backups }
        ],
        shares: [SHARE]
      }
    ],
    otherFiles: [],
    usage: { usedBytes: 1_000_000, allocatedBytes: 2_000_000 },
    listedAtIso: "2026-08-20T12:00:00.000Z"
  };
}

// Five backups, days 1..5: keep 2 removes days 1, 2, 3.
const BACKUPS = [1, 2, 3, 4, 5].map((day) => backup(day));
const INVENTORY = inventory(BACKUPS);

type Calls = {
  inventoryReads: number;
  deletes: Array<Array<{ path: string; rev: string | null }>>;
  settingsWrites: StorageSettings[];
  order: string[];
};

function makeProvider(
  overrides: Partial<CloudBackupProvider> = {},
  status: "connected" | "disconnected" = "connected"
): CloudBackupProvider & { calls: Calls } {
  const calls: Calls = { inventoryReads: 0, deletes: [], settingsWrites: [], order: [] };
  const base = makeFakeCloudBackupProvider({
    getStatus: () => status,
    async getStorageInventory() {
      return INVENTORY;
    },
    async readStorageSettings() {
      return { backupsPerProject: 3 };
    },
    ...overrides
  });
  return {
    ...base,
    calls,
    async getStorageInventory() {
      calls.inventoryReads += 1;
      calls.order.push("inventory");
      return base.getStorageInventory();
    },
    async deleteStorageFiles(files) {
      calls.deletes.push(files);
      calls.order.push("delete");
      return base.deleteStorageFiles(files);
    },
    async writeStorageSettings(settings) {
      calls.settingsWrites.push(settings);
      calls.order.push("write-settings");
      return base.writeStorageSettings(settings);
    }
  };
}

describe("cloudStorageSlice", () => {
  let testStore: ReturnType<typeof createTestAppStore>;

  function makeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
    return {
      projectRepository: testStore.projectRepository,
      artworkLibraryRepository: testStore.artworkLibraryRepository,
      assetRepository: testStore.assetRepository,
      imageProcessor: testStore.imageProcessor,
      projectSnapshotRepository: testStore.projectSnapshotRepository,
      syncMetaRepository: testStore.syncMetaRepository,
      crossTabSync: createInertCrossTabSync(),
      ...overrides
    };
  }

  async function bootStore(provider?: CloudBackupProvider) {
    const store = createAppStore(makeDeps({ cloudBackupProvider: provider }));
    await store.getState().boot();
    return store;
  }

  beforeEach(() => {
    window.localStorage.clear();
    testStore = createTestAppStore();
  });

  describe("refreshCloudStorage", () => {
    it("loads the inventory and the saved settings", async () => {
      const store = await bootStore(makeProvider());
      expect(store.getState().cloudStorageStatus).toBe("idle");

      await store.getState().refreshCloudStorage();

      expect(store.getState().cloudStorageStatus).toBe("loaded");
      expect(store.getState().cloudStorage).toEqual(INVENTORY);
      expect(store.getState().cloudStorageSettings).toEqual({ backupsPerProject: 3 });
      expect(store.getState().cloudStorageError).toBeNull();
    });

    it("stays inert while disconnected", async () => {
      const provider = makeProvider({}, "disconnected");
      const store = await bootStore(provider);
      await store.getState().refreshCloudStorage();
      expect(provider.calls.inventoryReads).toBe(0);
      expect(store.getState().cloudStorageStatus).toBe("idle");
    });

    it("keeps the inventory loaded when only the settings read fails", async () => {
      const store = await bootStore(
        makeProvider({
          async readStorageSettings() {
            throw new Error("nope");
          }
        })
      );
      await store.getState().refreshCloudStorage();
      expect(store.getState().cloudStorageStatus).toBe("loaded");
      expect(store.getState().cloudStorage).toEqual(INVENTORY);
      expect(store.getState().cloudStorageSettings).toBeNull();
    });

    it("flips to reauth-required on a lapsed grant", async () => {
      const store = await bootStore(
        makeProvider({
          async getStorageInventory() {
            throw new CloudBackupError("reauth", "Reconnect Dropbox.");
          }
        })
      );
      await store.getState().refreshCloudStorage();
      expect(store.getState().cloudStorageStatus).toBe("reauth-required");
    });

    it("reports an ordinary failure with its message", async () => {
      const store = await bootStore(
        makeProvider({
          async getStorageInventory() {
            throw new CloudBackupError("transient", "Dropbox is slow today.");
          }
        })
      );
      await store.getState().refreshCloudStorage();
      expect(store.getState().cloudStorageStatus).toBe("error");
      expect(store.getState().cloudStorageError).toBe("Dropbox is slow today.");
    });
  });

  describe("applyBackupTrim", () => {
    it("saves the limit first, deletes the confirmed backups, and refreshes", async () => {
      const provider = makeProvider();
      const store = await bootStore(provider);
      const plan = planBackupTrim(INVENTORY, 2);

      const result = await store.getState().applyBackupTrim(plan);

      expect(provider.calls.order[0]).toBe("write-settings");
      expect(provider.calls.settingsWrites).toEqual([{ backupsPerProject: 2 }]);
      expect(provider.calls.deletes).toHaveLength(1);
      expect(provider.calls.deletes[0].map((file) => file.path).sort()).toEqual(
        [backup(1).path, backup(2).path, backup(3).path].sort()
      );
      expect(result).toEqual({
        kind: "trim",
        removedCount: 3,
        removedBytes: 6000,
        skippedCount: 0,
        failedCount: 0,
        settingSaved: true
      });
      expect(store.getState().cloudStorageLastResult).toEqual(result);
      expect(store.getState().cloudStorageSettings).toEqual({ backupsPerProject: 3 });
      // Preview read (none here) + fresh read + refresh afterwards.
      expect(provider.calls.inventoryReads).toBe(2);
      expect(store.getState().cloudStorageBusy).toBeNull();
    });

    it("never passes a sync head or a share to deleteStorageFiles", async () => {
      const provider = makeProvider();
      const store = await bootStore(provider);
      await store.getState().applyBackupTrim(planBackupTrim(INVENTORY, 1));
      const paths = provider.calls.deletes.flat().map((file) => file.path);
      expect(paths).toHaveLength(4);
      expect(paths).not.toContain(HEAD.path);
      expect(paths).not.toContain(SHARE.path);
      expect(paths.every((path) => path.startsWith("/backups/"))).toBe(true);
    });

    it("skips a previewed file whose rev changed in the fresh inventory", async () => {
      const fresh = inventory([backup(1, "rev-1-new"), ...BACKUPS.slice(1)]);
      let reads = 0;
      const provider = makeProvider({
        async getStorageInventory() {
          reads += 1;
          return fresh;
        }
      });
      const store = await bootStore(provider);

      const result = await store.getState().applyBackupTrim(planBackupTrim(INVENTORY, 2));

      expect(reads).toBeGreaterThan(0);
      expect(provider.calls.deletes[0].map((file) => file.path)).not.toContain(backup(1).path);
      expect(provider.calls.deletes[0]).toHaveLength(2);
      expect(result).toMatchObject({ removedCount: 2, removedBytes: 5000, skippedCount: 1 });
    });

    it("counts deleted, gone, changed and failed outcomes", async () => {
      const provider = makeProvider({
        async deleteStorageFiles(files): Promise<StorageDeleteResult[]> {
          const outcomes = ["deleted", "gone", "changed", "failed"] as const;
          return files.map((file, index) => ({ path: file.path, outcome: outcomes[index] }));
        }
      });
      const store = await bootStore(provider);
      const plan = planBackupTrim(INVENTORY, 1);
      // Newest first: removes days 4, 3, 2, 1 in that order.
      const result = await store.getState().applyBackupTrim(plan);

      expect(result).toEqual({
        kind: "trim",
        removedCount: 2,
        removedBytes: 4000 + 3000,
        skippedCount: 1,
        failedCount: 1,
        settingSaved: true
      });
    });

    it("treats a thrown delete as every confirmed file failing", async () => {
      const store = await bootStore(
        makeProvider({
          async deleteStorageFiles() {
            throw new Error("boom");
          }
        })
      );
      const result = await store.getState().applyBackupTrim(planBackupTrim(INVENTORY, 2));
      expect(result).toMatchObject({ removedCount: 0, failedCount: 3, skippedCount: 0 });
    });

    it("still deletes when the limit can't be saved, and says so", async () => {
      const provider = makeProvider({
        async writeStorageSettings() {
          throw new Error("write failed");
        }
      });
      const store = await bootStore(provider);
      await store.getState().refreshCloudStorage();

      const result = await store.getState().applyBackupTrim(planBackupTrim(INVENTORY, 2));

      expect(result).toMatchObject({ removedCount: 3, settingSaved: false });
      expect(provider.calls.deletes).toHaveLength(1);
      expect(store.getState().cloudStorageSettings).toEqual({ backupsPerProject: 3 });
    });

    it("deletes nothing when the fresh inventory can't be read", async () => {
      let reads = 0;
      const provider = makeProvider({
        async getStorageInventory() {
          reads += 1;
          throw new Error("listing failed");
        }
      });
      const store = await bootStore(provider);

      const result = await store.getState().applyBackupTrim(planBackupTrim(INVENTORY, 2));

      expect(provider.calls.deletes).toHaveLength(0);
      expect(result).toEqual({
        kind: "trim",
        removedCount: 0,
        removedBytes: 0,
        skippedCount: 0,
        failedCount: 3,
        settingSaved: true
      });
      // The fresh read, then the refresh afterwards.
      expect(reads).toBe(2);
    });

    it("marks reauth-required and skips the refresh when the fresh read needs reauth", async () => {
      let reads = 0;
      const provider = makeProvider({
        async getStorageInventory() {
          reads += 1;
          throw new CloudBackupError("reauth", "Reconnect Dropbox.");
        }
      });
      const store = await bootStore(provider);
      const result = await store.getState().applyBackupTrim(planBackupTrim(INVENTORY, 2));
      expect(result).toMatchObject({ failedCount: 3 });
      expect(store.getState().cloudStorageStatus).toBe("reauth-required");
      expect(reads).toBe(1);
    });

    it("only saves the limit when nothing needs removing", async () => {
      const provider = makeProvider();
      const store = await bootStore(provider);
      const result = await store.getState().applyBackupTrim(planBackupTrim(INVENTORY, 5));
      expect(provider.calls.settingsWrites).toEqual([{ backupsPerProject: 5 }]);
      expect(provider.calls.deletes).toHaveLength(0);
      expect(result).toEqual({
        kind: "trim",
        removedCount: 0,
        removedBytes: 0,
        skippedCount: 0,
        failedCount: 0,
        settingSaved: true
      });
    });

    it("refuses a second trim while one is running", async () => {
      let release: () => void = () => undefined;
      const provider = makeProvider({
        writeStorageSettings: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      });
      const store = await bootStore(provider);
      const plan = planBackupTrim(INVENTORY, 2);

      const first = store.getState().applyBackupTrim(plan);
      expect(store.getState().cloudStorageBusy).toBe("trim");
      expect(await store.getState().applyBackupTrim(plan)).toBeNull();
      expect(await store.getState().removeCloudShare(SHARE)).toBeNull();

      release();
      expect(await first).not.toBeNull();
      expect(store.getState().cloudStorageBusy).toBeNull();
    });
  });

  describe("removeCloudShare", () => {
    it.each([
      ["deleted", { removedCount: 1, removedBytes: 5000, skippedCount: 0, failedCount: 0 }],
      ["gone", { removedCount: 1, removedBytes: 5000, skippedCount: 0, failedCount: 0 }],
      ["changed", { removedCount: 0, removedBytes: 0, skippedCount: 1, failedCount: 0 }],
      ["failed", { removedCount: 0, removedBytes: 0, skippedCount: 0, failedCount: 1 }]
    ] as const)("maps a %s outcome", async (outcome, expected) => {
      const provider = makeProvider({
        async deleteStorageFiles(files) {
          return files.map((file) => ({ path: file.path, outcome }));
        }
      });
      const store = await bootStore(provider);

      const result = await store.getState().removeCloudShare(SHARE);

      expect(provider.calls.deletes).toEqual([[{ path: SHARE.path, rev: SHARE.rev }]]);
      expect(result).toEqual({ kind: "share", settingSaved: true, ...expected });
      expect(store.getState().cloudStorageLastResult).toEqual(result);
      expect(store.getState().cloudStorageBusy).toBeNull();
      // Refreshed afterwards.
      expect(provider.calls.inventoryReads).toBe(1);
    });

    it("treats a thrown delete as a failure", async () => {
      const store = await bootStore(
        makeProvider({
          async deleteStorageFiles() {
            throw new Error("boom");
          }
        })
      );
      const result = await store.getState().removeCloudShare(SHARE);
      expect(result).toMatchObject({ removedCount: 0, failedCount: 1 });
    });
  });

  it("clears the last result", async () => {
    const store = await bootStore(makeProvider());
    await store.getState().removeCloudShare(SHARE);
    expect(store.getState().cloudStorageLastResult).not.toBeNull();
    store.getState().clearCloudStorageResult();
    expect(store.getState().cloudStorageLastResult).toBeNull();
  });
});
