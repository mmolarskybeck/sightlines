import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository,
  makeImageFile
} from "../../test/inMemoryRepositories";
import { createSightlinesPackage } from "../../domain/package/buildPackage";
import type { Project } from "../../domain/project";
import { CloudBackupError } from "../cloud/dropbox";
import { MAX_BACKUP_DOWNLOAD_BYTES } from "../cloud/dropboxAuth";
import { readCloudBackupMeta } from "./cloudBackupMeta";
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
      asCopy: false,
      lastBackupIso: FOLDERS[0]!.latestBackup!.serverModifiedIso
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
      asCopy: true,
      lastBackupIso: FOLDERS[0]!.latestBackup!.serverModifiedIso
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
      asCopy: true,
      lastBackupIso: FOLDERS[0]!.latestBackup!.serverModifiedIso
    });
  });

  // The restore paths below run the REAL import pipeline, because both the
  // "cloud project opened" count and the backup-meta seed live at the commit —
  // the only moment a restore has actually happened.
  describe("a committed restore", () => {
    async function bootRestorable() {
      let bytes = new Uint8Array();
      const provider = makeFakeProvider({ download: async () => bytes });
      const store = await bootStore(provider);
      async function serveBackupOf(project: Project) {
        const built = await createSightlinesPackage({
          project,
          libraryArtworks: store.getState().libraryArtworks,
          mode: "originals",
          getAsset: (id) => assetRepository.getAsset(id),
          getBlob: (key) => assetRepository.getBlob(key)
        });
        // Copy, like a real download: the provider seam hands back bytes the
        // caller owns, not a view into whatever buffer the zip built into.
        bytes = new Uint8Array(built.zip);
      }
      return { store, provider, serveBackupOf };
    }

    // Without this seed the scheduler's fingerprint dirty-check re-uploads the
    // just-restored content minutes later and burns one of the five retention
    // slots on a duplicate of the file it came from.
    it("seeds this device's backup meta when identity was preserved", async () => {
      const track = vi.spyOn(telemetry, "track");
      const { store, serveBackupOf } = await bootRestorable();
      await serveBackupOf({
        ...store.getState().project!,
        id: "cloud-project",
        title: "Cloud Project"
      });

      expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(true);

      expect(store.getState().project?.id).toBe("cloud-project");
      expect(track).toHaveBeenCalledWith("cloud_project_opened", {});
      const meta = readCloudBackupMeta("cloud-project");
      // The timestamp of the very file that was restored — this device is now
      // as backed-up as that folder says it is.
      expect(meta.lastCloudBackupAt).toBe(FOLDERS[0]!.latestBackup!.serverModifiedIso);
      expect(meta.backedUpFingerprint).not.toBeNull();
      track.mockRestore();
    });

    // A save-a-copy restore is a NEW project with its own, still-empty backup
    // folder: its first upload is correct behavior, so seeding here would leave
    // it with no cloud copy at all.
    it("still counts, but seeds nothing, for a save-a-copy restore", async () => {
      const track = vi.spyOn(telemetry, "track");
      const { store, serveBackupOf } = await bootRestorable();
      await repository.save({
        ...store.getState().project!,
        id: `${FOLDERS[0]!.projectIdPrefix}-0000-local`
      });
      await serveBackupOf({
        ...store.getState().project!,
        id: "cloud-project",
        title: "Cloud Project"
      });

      expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(true);

      const copiedId = store.getState().project!.id;
      expect(copiedId).not.toBe("cloud-project");
      expect(track).toHaveBeenCalledWith("cloud_project_opened", {});
      expect(readCloudBackupMeta(copiedId).lastCloudBackupAt).toBeNull();
      expect(readCloudBackupMeta("cloud-project").lastCloudBackupAt).toBeNull();
      track.mockRestore();
    });

    // Parking in the artwork conflict dialog is not a restore yet: the
    // provenance has to wait there with the plan, and a dismissal must leave no
    // trace of a project that was never opened.
    async function parkOnAConflict() {
      const { store, serveBackupOf } = await bootRestorable();
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().libraryArtworks[0]!.id;
      await serveBackupOf({
        ...store.getState().project!,
        id: "cloud-project",
        title: "Cloud Project"
      });
      // Same id, different content on this device: a §6 conflict.
      const local = artworkLibraryRepository.artworks.get(artworkId)!;
      await artworkLibraryRepository.save({ ...local, title: "Local piece" });
      store.setState({ libraryArtworks: await artworkLibraryRepository.list() });

      const track = vi.spyOn(telemetry, "track");
      expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(true);
      expect(store.getState().pendingPackageImport?.plan.conflicts).toHaveLength(1);
      expect(track).not.toHaveBeenCalledWith("cloud_project_opened", {});
      return { store, artworkId, track };
    }

    it("counts nothing and seeds nothing when the review is dismissed", async () => {
      const { store, track } = await parkOnAConflict();

      store.getState().dismissPackageImport();

      expect(store.getState().pendingPackageImport).toBeNull();
      expect(track).not.toHaveBeenCalledWith("cloud_project_opened", {});
      expect(readCloudBackupMeta("cloud-project").lastCloudBackupAt).toBeNull();
      track.mockRestore();
    });

    it("carries the restore provenance through the review to the commit", async () => {
      const { store, artworkId, track } = await parkOnAConflict();

      await store.getState().resolvePackageImportConflicts({ [artworkId]: "mine" });

      expect(store.getState().project?.id).toBe("cloud-project");
      expect(track).toHaveBeenCalledWith("cloud_project_opened", {});
      expect(readCloudBackupMeta("cloud-project").lastCloudBackupAt).toBe(
        FOLDERS[0]!.latestBackup!.serverModifiedIso
      );
      track.mockRestore();
    });
  });

  // Backups are uploaded uncapped on purpose, so a folder can hold a file this
  // tab could never buffer. The listing already knows its size — say so before
  // spending the download.
  it("refuses an oversized backup from the listing alone, without downloading", async () => {
    const provider = makeFakeProvider();
    const store = await bootStore(provider);
    const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
    store.setState({ importCloudBackupPackage });
    const huge = {
      ...FOLDERS[0]!,
      latestBackup: {
        ...FOLDERS[0]!.latestBackup!,
        sizeBytes: MAX_BACKUP_DOWNLOAD_BYTES + 1
      }
    };

    expect(await store.getState().openCloudProjectBackup(huge)).toBe(false);

    expect(provider.downloads).toEqual([]);
    expect(importCloudBackupPackage).not.toHaveBeenCalled();
    expect(store.getState().cloudProjectOpening).toBeNull();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "That backup is too large to open here. You can download it from dropbox.com."
    );
  });

  it("words an oversize the download itself discovers the same way", async () => {
    const store = await bootStore(
      makeFakeProvider({
        download: async () => {
          throw new CloudBackupError("too-large", "larger than 256 MB");
        }
      })
    );
    const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
    store.setState({ importCloudBackupPackage });

    expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(false);

    expect(importCloudBackupPackage).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "That backup is too large to open here. You can download it from dropbox.com."
    );
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
