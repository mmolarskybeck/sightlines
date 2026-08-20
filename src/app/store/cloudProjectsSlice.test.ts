import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository,
  InMemorySyncMetaRepository,
  makeImageFile
} from "../../test/inMemoryRepositories";
import { createSightlinesPackage } from "../../domain/package/buildPackage";
import type { Project } from "../../domain/project";
import { CloudBackupError } from "../cloud/dropbox";
import { MAX_BACKUP_DOWNLOAD_BYTES } from "../cloud/dropboxAuth";
import {
  getCloudSyncRowKey,
  shouldWarnSyncHeadsUnavailable
} from "../cloud/cloudBackupCopy";
import { readCloudBackupMeta } from "./cloudBackupMeta";
import type {
  CloudBackupProvider,
  CloudBackupProviderStatus,
  CloudProjectFolder,
  SyncHeadListing
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

// The sync head for the first folder: a full project id, of which the folder
// name carries only the first 8 chars.
const HEAD_PROJECT_ID = "1a2b3c4d-1111-2222-3333-444455556666";
const HEADS: SyncHeadListing[] = [
  {
    projectId: HEAD_PROJECT_ID,
    path: `/projects/${HEAD_PROJECT_ID}/current.sightlines`,
    rev: "head-rev-1",
    serverModifiedIso: "2026-08-19T11:00:00.000Z",
    sizeBytes: 4096
  }
];

// A head with no backup folder behind it — what "new project → sync on → close
// the tab" leaves in the account, since the head is written at once while the
// first automatic backup waits out the settle delay. No folder row can carry
// it, so it gets its own row and its own open.
const LONE_HEAD_PROJECT_ID = "deadbeef-1111-2222-3333-444455556666";
const LONE_HEAD: SyncHeadListing = {
  projectId: LONE_HEAD_PROJECT_ID,
  path: `/projects/${LONE_HEAD_PROJECT_ID}/current.sightlines`,
  rev: "lone-rev-1",
  serverModifiedIso: "2026-08-19T12:00:00.000Z",
  sizeBytes: 4096
};

type FakeProviderOptions = {
  status?: CloudBackupProviderStatus;
  list?: () => Promise<CloudProjectFolder[]>;
  download?: () => Promise<Uint8Array>;
  heads?: () => Promise<SyncHeadListing[]>;
  downloadHead?: () => Promise<{ bytes: Uint8Array; rev: string }>;
};

// Hand-written stand-in: the slice is coded against the provider interface, so
// no Dropbox implementation detail belongs in these tests.
function makeFakeProvider(
  options: FakeProviderOptions = {}
): CloudBackupProvider & {
  lists: number;
  downloads: string[];
  headDownloads: string[];
} {
  return {
    id: "fake",
    label: "Fake",
    lists: 0,
    downloads: [],
    headDownloads: [],
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
    },
    accountId() {
      return "dbid:tester";
    },
    // The sync LOOP is exercised in its own slice tests; what this surface
    // needs from the seam is the head listing and the head download.
    async getSyncHead() {
      return null;
    },
    async downloadSyncHead(projectId) {
      this.headDownloads.push(projectId);
      return options.downloadHead
        ? await options.downloadHead()
        : { bytes: new Uint8Array([1, 2, 3]), rev: "head-rev-1" };
    },
    async uploadSyncHead() {
      return { rev: "rev-1", serverModifiedIso: null, sizeBytes: null };
    },
    async listSyncHeads() {
      return options.heads ? await options.heads() : [];
    }
  };
}

describe("cloudProjectsSlice", () => {
  let repository: InMemoryProjectRepository;
  let artworkLibraryRepository: InMemoryArtworkLibraryRepository;
  let assetRepository: InMemoryAssetRepository;
  let imageProcessor: FakeImageProcessor;
  let projectSnapshotRepository: InMemoryProjectSnapshotRepository;
  let syncMetaRepository: InMemorySyncMetaRepository;

  function makeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
    return {
      projectRepository: repository,
      artworkLibraryRepository,
      assetRepository,
      imageProcessor,
      projectSnapshotRepository,
      syncMetaRepository,
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
    syncMetaRepository = new InMemorySyncMetaRepository();
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

  it("lists the account's sync heads alongside the folders", async () => {
    const store = await bootStore(makeFakeProvider({ heads: async () => HEADS }));

    await store.getState().refreshCloudProjects();

    expect(store.getState().cloudSyncHeads).toEqual(HEADS);
  });

  // The heads are an enhancement of this listing; the folders are the listing.
  // Losing the first must never cost the second.
  it("keeps the backup listing when the heads listing fails", async () => {
    const store = await bootStore(
      makeFakeProvider({
        heads: async () => {
          throw new CloudBackupError("transient", "Network down.");
        }
      })
    );

    await store.getState().refreshCloudProjects();

    expect(store.getState().cloudProjectsStatus).toBe("loaded");
    expect(store.getState().cloudProjects).toEqual(FOLDERS);
    // Not [] — "we couldn't ask" is not "nothing is synced".
    expect(store.getState().cloudSyncHeads).toBeNull();
    // …and the pair reads as a FAILED pass, which is what puts the degraded
    // notice on screen. A fresh store wears the same null and must not.
    expect(
      shouldWarnSyncHeadsUnavailable({
        status: store.getState().cloudProjectsStatus,
        syncHeads: store.getState().cloudSyncHeads
      })
    ).toBe(true);

    const untouched = await bootStore(makeFakeProvider());
    expect(
      shouldWarnSyncHeadsUnavailable({
        status: untouched.getState().cloudProjectsStatus,
        syncHeads: untouched.getState().cloudSyncHeads
      })
    ).toBe(false);
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

  // Device handoff (docs/cloud-sync-plan.md stage 2): a project with a
  // canonical copy in Dropbox and nothing here opens from the HEAD, not from a
  // timestamped backup — that is what makes the two devices one project.
  describe("a folder backed by a sync head", () => {
    async function bootWithHeads() {
      const provider = makeFakeProvider({ heads: async () => HEADS });
      const store = await bootStore(provider);
      await store.getState().refreshCloudProjects();
      return { store, provider };
    }

    it("opens the head and links this device, never the newest backup", async () => {
      const { store, provider } = await bootWithHeads();
      const importSyncHeadPackage = vi.fn().mockResolvedValue(true);
      const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
      store.setState({ importSyncHeadPackage, importCloudBackupPackage });

      expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(true);

      expect(provider.headDownloads).toEqual([HEAD_PROJECT_ID]);
      expect(provider.downloads).toEqual([]);
      expect(importCloudBackupPackage).not.toHaveBeenCalled();
      expect(importSyncHeadPackage).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
        link: { projectId: HEAD_PROJECT_ID, rev: "head-rev-1" }
      });
      expect(store.getState().cloudProjectOpening).toBeNull();
    });

    // Copies are never linked: a folder that looks like something already here
    // keeps the stage-1 save-a-copy path untouched, head or no head.
    it("still copies when a local project id matches the folder's prefix", async () => {
      const { store, provider } = await bootWithHeads();
      const project = store.getState().project!;
      await repository.save({ ...project, id: `${FOLDERS[0]!.projectIdPrefix}-0000-local` });
      const importSyncHeadPackage = vi.fn().mockResolvedValue(true);
      const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
      store.setState({ importSyncHeadPackage, importCloudBackupPackage });

      await store.getState().openCloudProjectBackup(FOLDERS[0]!);

      expect(provider.headDownloads).toEqual([]);
      expect(importSyncHeadPackage).not.toHaveBeenCalled();
      expect(importCloudBackupPackage).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
        asCopy: true,
        lastBackupIso: FOLDERS[0]!.latestBackup!.serverModifiedIso
      });
    });

    // A folder with no head keeps restoring from its backups.
    it("leaves an unsynced folder on the backup path", async () => {
      const { store, provider } = await bootWithHeads();
      const importSyncHeadPackage = vi.fn().mockResolvedValue(true);
      store.setState({
        importSyncHeadPackage,
        importCloudBackupPackage: vi.fn().mockResolvedValue(true)
      });

      await store.getState().openCloudProjectBackup(FOLDERS[1]!);

      expect(importSyncHeadPackage).not.toHaveBeenCalled();
      expect(provider.downloads).toEqual([FOLDERS[1]!.latestBackup!.path]);
    });

    it("refuses an oversized head from the listing alone, without downloading", async () => {
      const provider = makeFakeProvider({
        heads: async () => [
          { ...HEADS[0]!, sizeBytes: MAX_BACKUP_DOWNLOAD_BYTES + 1 }
        ]
      });
      const store = await bootStore(provider);
      await store.getState().refreshCloudProjects();
      const importSyncHeadPackage = vi.fn().mockResolvedValue(true);
      store.setState({ importSyncHeadPackage });

      expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(false);

      expect(provider.headDownloads).toEqual([]);
      expect(importSyncHeadPackage).not.toHaveBeenCalled();
      // Named as the project, not as a backup: this is the file the user's
      // other devices are working against.
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "That project is too large to open here. You can download it from dropbox.com."
      );
    });

    it("re-lists and says so when the head has vanished", async () => {
      const provider = makeFakeProvider({
        heads: async () => HEADS,
        downloadHead: async () => {
          throw new CloudBackupError("not-found", "path/not_found");
        }
      });
      const store = await bootStore(provider);
      await store.getState().refreshCloudProjects();
      store.setState({ importSyncHeadPackage: vi.fn().mockResolvedValue(true) });

      expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(false);

      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "That project's synced copy is no longer in Dropbox."
      );
      expect(provider.lists).toBe(2);
    });

    // The whole point of the handoff: after this open, the state machine has a
    // rev to compare against, so the next check pushes or pulls rather than
    // treating the project as unlinked.
    it("records the head's rev at the commit, so the device is linked", async () => {
      let bytes = new Uint8Array();
      const provider = makeFakeProvider({
        heads: async () => HEADS,
        downloadHead: async () => ({ bytes, rev: "head-rev-1" })
      });
      const store = await bootStore(provider);
      await store.getState().refreshCloudProjects();
      const built = await createSightlinesPackage({
        project: {
          ...store.getState().project!,
          id: HEAD_PROJECT_ID,
          title: "Winter Show"
        },
        libraryArtworks: store.getState().libraryArtworks,
        mode: "display",
        getAsset: (id) => assetRepository.getAsset(id),
        getBlob: (key) => assetRepository.getBlob(key)
      });
      bytes = new Uint8Array(built.zip);

      expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(true);

      // Identity preserved — the head IS this project, not a copy of it.
      expect(store.getState().project?.id).toBe(HEAD_PROJECT_ID);
      const meta = await syncMetaRepository.get(HEAD_PROJECT_ID);
      expect(meta?.lastAcceptedRev).toBe("head-rev-1");
      expect(meta?.accountId).toBe("dbid:tester");
      expect(meta?.paused).toBe(false);
      expect(meta?.lastPullAtIso).not.toBeNull();
      // Observable state follows the commit, so the popover can say it.
      expect(store.getState().syncMeta?.lastAcceptedRev).toBe("head-rev-1");
      // The content is already in Dropbox; an auto-backup minutes later would
      // burn a retention slot on a duplicate of what was just downloaded.
      expect(readCloudBackupMeta(HEAD_PROJECT_ID).lastCloudBackupAt).not.toBeNull();
    });
  });

  // A project the account holds ONLY as a head. There is no folder to route
  // through and no backup to fall back to, so this is its own action — over the
  // same head-open implementation the folder rows reach.
  describe("a project with a head and no backup folder", () => {
    async function bootWithLoneHead(
      options: Parameters<typeof makeFakeProvider>[0] = {}
    ) {
      const provider = makeFakeProvider({ heads: async () => [LONE_HEAD], ...options });
      const store = await bootStore(provider);
      await store.getState().refreshCloudProjects();
      return { store, provider };
    }

    it("opens the head and links this device", async () => {
      const { store, provider } = await bootWithLoneHead();
      const importSyncHeadPackage = vi.fn().mockResolvedValue(true);
      const importCloudBackupPackage = vi.fn().mockResolvedValue(true);
      store.setState({ importSyncHeadPackage, importCloudBackupPackage });

      expect(await store.getState().openCloudSyncedProject(LONE_HEAD)).toBe(true);

      expect(provider.headDownloads).toEqual([LONE_HEAD_PROJECT_ID]);
      expect(provider.downloads).toEqual([]);
      expect(importCloudBackupPackage).not.toHaveBeenCalled();
      expect(importSyncHeadPackage).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
        link: { projectId: LONE_HEAD_PROJECT_ID, rev: "head-rev-1" }
      });
      expect(store.getState().cloudProjectOpening).toBeNull();
    });

    // The row disables on the same field the folder rows use, keyed so the two
    // namespaces can never be mistaken for each other.
    it("claims the open under the row's own key", async () => {
      let release: (() => void) | null = null;
      const { store } = await bootWithLoneHead({
        downloadHead: () =>
          new Promise((resolve) => {
            release = () => resolve({ bytes: new Uint8Array([1]), rev: "head-rev-1" });
          })
      });
      store.setState({ importSyncHeadPackage: vi.fn().mockResolvedValue(true) });

      const open = store.getState().openCloudSyncedProject(LONE_HEAD);
      await Promise.resolve();
      expect(store.getState().cloudProjectOpening).toBe(
        getCloudSyncRowKey(LONE_HEAD_PROJECT_ID)
      );
      // A second open — of anything — loses the race.
      expect(await store.getState().openCloudProjectBackup(FOLDERS[0]!)).toBe(false);

      release!();
      await open;
      expect(store.getState().cloudProjectOpening).toBeNull();
    });

    // Linking imports under the project's OWN id, with no snapshot behind it.
    // A stale row must never talk this path into overwriting the project it
    // claims is missing.
    it("refuses when that project is already on this device", async () => {
      const { store, provider } = await bootWithLoneHead();
      const project = store.getState().project!;
      await repository.save({ ...project, id: LONE_HEAD_PROJECT_ID });
      const importSyncHeadPackage = vi.fn().mockResolvedValue(true);
      store.setState({ importSyncHeadPackage });

      expect(await store.getState().openCloudSyncedProject(LONE_HEAD)).toBe(false);

      expect(provider.headDownloads).toEqual([]);
      expect(importSyncHeadPackage).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "That project is already on this device."
      );
      expect(store.getState().cloudProjectOpening).toBeNull();
    });

    // Fail closed: a device that cannot list its own projects cannot prove this
    // one is absent, and the copy escape hatch the folder rows have doesn't
    // exist here.
    it("refuses when this device's projects can't be read", async () => {
      const { store, provider } = await bootWithLoneHead();
      const importSyncHeadPackage = vi.fn().mockResolvedValue(true);
      store.setState({ importSyncHeadPackage });
      repository.list = async () => {
        throw new Error("IndexedDB unavailable.");
      };

      expect(await store.getState().openCloudSyncedProject(LONE_HEAD)).toBe(false);

      expect(provider.headDownloads).toEqual([]);
      expect(importSyncHeadPackage).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "Couldn't check the projects on this device. Try opening that project again."
      );
    });

    // Shared implementation, shared ceiling: answered from the listing before
    // any bytes are spent.
    it("refuses an oversized head without downloading", async () => {
      const { store, provider } = await bootWithLoneHead();
      store.setState({ importSyncHeadPackage: vi.fn().mockResolvedValue(true) });

      expect(
        await store.getState().openCloudSyncedProject({
          ...LONE_HEAD,
          sizeBytes: MAX_BACKUP_DOWNLOAD_BYTES + 1
        })
      ).toBe(false);

      expect(provider.headDownloads).toEqual([]);
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "That project is too large to open here. You can download it from dropbox.com."
      );
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
