import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository
} from "../../test/inMemoryRepositories";
import { CloudBackupError } from "../cloud/dropbox";
import type {
  CloudBackupProvider,
  CloudBackupProviderStatus,
  CloudProjectFolder
} from "../cloud/provider";
import { createInertCrossTabSync } from "../crossTabSync";
import { createAppStore, type AppStoreDeps } from "../store";
import { telemetry } from "../telemetry/telemetry";

// The slice owns its own sonner toasts; capture them without rendering.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));

const FOLDERS: CloudProjectFolder[] = [
  {
    folderName: "Winter Show — 1a2b3c4d",
    title: "Winter Show",
    projectIdPrefix: "1a2b3c4d",
    backupCount: 5,
    latestBackup: {
      path: "/backups/Winter Show — 1a2b3c4d/2026-08-19.sightlines",
      name: "2026-08-19.sightlines",
      serverModifiedIso: "2026-08-19T10:00:00.000Z",
      sizeBytes: 4096
    }
  },
  {
    folderName: "Summer Rotation — 99887766",
    title: "Summer Rotation",
    projectIdPrefix: "99887766",
    backupCount: 1,
    latestBackup: {
      path: "/backups/Summer Rotation — 99887766/2026-08-18.sightlines",
      name: "2026-08-18.sightlines",
      serverModifiedIso: "2026-08-18T10:00:00.000Z",
      sizeBytes: 2048
    }
  }
];

type FakeProviderOptions = {
  status?: CloudBackupProviderStatus;
  list?: () => Promise<CloudProjectFolder[]>;
  download?: () => Promise<Uint8Array>;
};

// Hand-written stand-in: the slice is coded against the provider interface, so
// no Dropbox implementation detail belongs in these tests.
function makeFakeProvider(
  options: FakeProviderOptions = {}
): CloudBackupProvider & { lists: number; downloads: string[] } {
  return {
    id: "fake",
    label: "Fake",
    lists: 0,
    downloads: [],
    async startConnect() {},
    async completeConnect() {
      return false;
    },
    disconnect() {},
    getStatus() {
      return options.status ?? "connected";
    },
    accountLabel() {
      return "Tester";
    },
    async uploadBackup() {},
    async createShareLink() {
      return "https://www.dropbox.com/scl/fi/share/project.sightlines?rlkey=test&dl=0";
    },
    async listCloudProjects() {
      this.lists += 1;
      return options.list ? await options.list() : FOLDERS;
    },
    async downloadBackup(path) {
      this.downloads.push(path);
      return options.download ? await options.download() : new Uint8Array([1, 2, 3]);
    }
  };
}

describe("cloudProjectsSlice", () => {
  let repository: InMemoryProjectRepository;
  let artworkLibraryRepository: InMemoryArtworkLibraryRepository;
  let assetRepository: InMemoryAssetRepository;
  let imageProcessor: FakeImageProcessor;
  let projectSnapshotRepository: InMemoryProjectSnapshotRepository;

  function makeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
    return {
      projectRepository: repository,
      artworkLibraryRepository,
      assetRepository,
      imageProcessor,
      projectSnapshotRepository,
      // Every store in this process would otherwise share one BroadcastChannel.
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
    vi.mocked(toast.error).mockClear();
    window.localStorage.clear();
    repository = new InMemoryProjectRepository();
    artworkLibraryRepository = new InMemoryArtworkLibraryRepository();
    assetRepository = new InMemoryAssetRepository();
    imageProcessor = new FakeImageProcessor();
    projectSnapshotRepository = new InMemoryProjectSnapshotRepository();
  });

  it("starts with no listing at all, which is not an empty listing", async () => {
    const store = await bootStore(makeFakeProvider());
    expect(store.getState().cloudProjects).toBeNull();
    expect(store.getState().cloudProjectsStatus).toBe("idle");
  });

  it("lists the provider's backup folders", async () => {
    const provider = makeFakeProvider();
    const store = await bootStore(provider);

    await store.getState().refreshCloudProjects();

    expect(provider.lists).toBe(1);
    expect(store.getState().cloudProjectsStatus).toBe("loaded");
    expect(store.getState().cloudProjects).toEqual(FOLDERS);
  });

  it("stays inert without a provider or while disconnected", async () => {
    const withoutProvider = await bootStore();
    await withoutProvider.getState().refreshCloudProjects();
    expect(withoutProvider.getState().cloudProjectsStatus).toBe("idle");
    expect(withoutProvider.getState().cloudProjects).toBeNull();

    const disconnected = makeFakeProvider({ status: "disconnected" });
    const store = await bootStore(disconnected);
    await store.getState().refreshCloudProjects();
    expect(disconnected.lists).toBe(0);
    expect(store.getState().cloudProjectsStatus).toBe("idle");
  });

  it("separates a lapsed grant from an ordinary listing failure", async () => {
    const reauth = await bootStore(
      makeFakeProvider({
        list: async () => {
          throw new CloudBackupError("reauth", "Reconnect Dropbox.");
        }
      })
    );
    await reauth.getState().refreshCloudProjects();
    expect(reauth.getState().cloudProjectsStatus).toBe("reauth-required");

    const failed = await bootStore(
      makeFakeProvider({
        list: async () => {
          throw new CloudBackupError("transient", "Network down.");
        }
      })
    );
    await failed.getState().refreshCloudProjects();
    expect(failed.getState().cloudProjectsStatus).toBe("error");
  });

  it("runs one listing at a time", async () => {
    let release: (() => void) | null = null;
    const provider = makeFakeProvider({
      list: () =>
        new Promise<CloudProjectFolder[]>((resolve) => {
          release = () => resolve(FOLDERS);
        })
    });
    const store = await bootStore(provider);

    const first = store.getState().refreshCloudProjects();
    await store.getState().refreshCloudProjects();
    expect(provider.lists).toBe(1);

    release!();
    await first;
    expect(store.getState().cloudProjectsStatus).toBe("loaded");
  });

  it("preserves identity for a folder no local project matches", async () => {
    const provider = makeFakeProvider();
    const store = await bootStore(provider);
    const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
    store.setState({ importCloudBackupPackage });

    const opened = await store.getState().openCloudProjectBackup(FOLDERS[0]!);

    expect(opened).toBe(true);
    expect(provider.downloads).toEqual([FOLDERS[0]!.latestBackup!.path]);
    expect(importCloudBackupPackage).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      asCopy: false
    });
    expect(store.getState().cloudProjectOpening).toBeNull();
  });

  it("forces a copy when a local project id starts with the folder's prefix", async () => {
    const store = await bootStore(makeFakeProvider());
    const project = store.getState().project!;
    await repository.save({ ...project, id: `${FOLDERS[0]!.projectIdPrefix}-0000-local` });
    const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
    store.setState({ importCloudBackupPackage });

    await store.getState().openCloudProjectBackup(FOLDERS[0]!);

    expect(importCloudBackupPackage).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      asCopy: true
    });
  });

  it("falls back to a copy when this device's projects can't be read", async () => {
    const store = await bootStore(makeFakeProvider());
    const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
    store.setState({ importCloudBackupPackage });
    repository.list = async () => {
      throw new Error("IndexedDB unavailable.");
    };

    await store.getState().openCloudProjectBackup(FOLDERS[0]!);

    expect(importCloudBackupPackage).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      asCopy: true
    });
  });

  it("records an opened cloud project once the import is accepted", async () => {
    const track = vi.spyOn(telemetry, "track");
    const store = await bootStore(makeFakeProvider());
    store.setState({ importCloudBackupPackage: vi.fn().mockResolvedValue(true) });

    await store.getState().openCloudProjectBackup(FOLDERS[0]!);
    expect(track).toHaveBeenCalledWith("cloud_project_opened", {});

    track.mockClear();
    store.setState({ importCloudBackupPackage: vi.fn().mockResolvedValue(false) });
    await store.getState().openCloudProjectBackup(FOLDERS[0]!);
    expect(track).not.toHaveBeenCalledWith("cloud_project_opened", {});
    track.mockRestore();
  });

  it("re-lists when the backup it was told about is gone", async () => {
    const provider = makeFakeProvider({
      download: async () => {
        throw new CloudBackupError("not-found", "path/not_found");
      }
    });
    const store = await bootStore(provider);
    const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
    store.setState({ importCloudBackupPackage });

    const opened = await store.getState().openCloudProjectBackup(FOLDERS[0]!);

    expect(opened).toBe(false);
    expect(importCloudBackupPackage).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "That backup is no longer in Dropbox."
    );
    expect(provider.lists).toBe(1);
    expect(store.getState().cloudProjectOpening).toBeNull();
  });

  it("flags a lapsed grant found on download and never imports", async () => {
    const store = await bootStore(
      makeFakeProvider({
        download: async () => {
          throw new CloudBackupError("reauth", "Reconnect Dropbox.");
        }
      })
    );
    const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
    store.setState({ importCloudBackupPackage });

    expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(false);
    expect(store.getState().cloudProjectsStatus).toBe("reauth-required");
    expect(importCloudBackupPackage).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Reconnect Dropbox to open this backup."
    );
  });

  it("refuses a folder with no backup and a second concurrent open", async () => {
    let release: (() => void) | null = null;
    const provider = makeFakeProvider({
      download: () =>
        new Promise<Uint8Array>((resolve) => {
          release = () => resolve(new Uint8Array([1]));
        })
    });
    const store = await bootStore(provider);
    store.setState({ importCloudBackupPackage: vi.fn().mockResolvedValue(true) });

    expect(
      await store.getState().openCloudProjectBackup({ ...FOLDERS[0]!, latestBackup: null })
    ).toBe(false);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("That folder has no backup to open.");

    const first = store.getState().openCloudProjectBackup(FOLDERS[0]!);
    expect(store.getState().cloudProjectOpening).toBe(FOLDERS[0]!.folderName);
    expect(await store.getState().openCloudProjectBackup(FOLDERS[1]!)).toBe(false);
    expect(provider.downloads).toEqual([FOLDERS[0]!.latestBackup!.path]);

    release!();
    await first;
  });
});
