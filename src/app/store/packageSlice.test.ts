// The sync-provenance import paths (docs/cloud-sync-plan.md, "Replace mode is
// real new work"). Everything here runs the REAL pipeline end to end, because
// the whole point of a replace is what it does to storage: a recovery snapshot
// before the write, an abort that leaves the existing copy untouched, and the
// rev recorded only once the document is really open.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createSightlinesPackage } from "../../domain/package/buildPackage";
import type { Project } from "../../domain/project";
import { syncHeadPath } from "../cloud/dropboxAuth";
import type { CloudBackupProvider } from "../cloud/provider";
import { createInertCrossTabSync } from "../crossTabSync";
import { createAppStore, type AppStoreDeps } from "../store";
import { readCloudBackupMeta } from "./cloudBackupMeta";
import { selectBackupFingerprint } from "./cloudBackupSlice";
import { BOOKKEEPING_MESSAGE } from "./cloudSyncSlice";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository,
  InMemorySyncMetaRepository,
  makeImageFile
} from "../../test/inMemoryRepositories";

// The import pipeline owns its own sonner toasts; capture them without rendering.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));

// Only the account id matters here: it is what sync metadata binds to.
function makeFakeProvider(accountId: string | null = "dbid:tester"): CloudBackupProvider {
  return {
    id: "fake",
    label: "Fake",
    async startConnect() {},
    async completeConnect() {
      return false;
    },
    disconnect() {},
    getStatus() {
      return "connected";
    },
    accountLabel() {
      return "Tester";
    },
    accountId() {
      return accountId;
    },
    async uploadBackup() {},
    async createShareLink() {
      return "https://www.dropbox.com/scl/fi/share/project.sightlines?rlkey=test&dl=0";
    },
    async listCloudProjects() {
      return [];
    },
    async downloadBackup() {
      return new Uint8Array();
    },
    async getSyncHead() {
      return null;
    },
    async downloadSyncHead() {
      return { bytes: new Uint8Array(), rev: "rev-1" };
    },
    async uploadSyncHead() {
      return { rev: "rev-1", serverModifiedIso: null, sizeBytes: null };
    },
    async listSyncHeads() {
      return [];
    }
  };
}

describe("packageSlice sync imports", () => {
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

  // A booted store whose open project is artwork-free (so packages build without
  // stored assets) and whose stored record matches what is on screen.
  async function bootStore(provider: CloudBackupProvider | undefined = makeFakeProvider()) {
    const store = createAppStore(makeDeps({ cloudBackupProvider: provider }));
    await store.getState().boot();
    const project = store.getState().project!;
    const local: Project = {
      ...project,
      title: "On this device",
      checklistArtworkIds: [],
      wallObjects: [],
      floorObjects: []
    };
    await repository.save(local);
    store.setState({ project: local, libraryArtworks: [] });
    return store;
  }

  async function packageBytesOf(
    project: Project,
    libraryArtworks = [] as Parameters<typeof createSightlinesPackage>[0]["libraryArtworks"]
  ): Promise<ArrayBuffer> {
    const built = await createSightlinesPackage({
      project,
      libraryArtworks,
      mode: "display",
      getAsset: (id) => assetRepository.getAsset(id),
      getBlob: (key) => assetRepository.getBlob(key)
    });
    // Copy, like a real download: the caller owns the bytes.
    const buffer = new ArrayBuffer(built.zip.byteLength);
    new Uint8Array(buffer).set(built.zip);
    return buffer;
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

  describe("a sync pull that replaces the open project", () => {
    it("keeps the identity, snapshots the old copy first, and records the rev", async () => {
      const store = await bootStore();
      const target = store.getState().project!;
      const expectedLocalFingerprint = selectBackupFingerprint(target, []);
      const bytes = await packageBytesOf({ ...target, title: "From the other device" });

      const accepted = await store.getState().importSyncHeadPackage(bytes, {
        replace: {
          targetProjectId: target.id,
          rev: "rev-9",
          expectedLocalFingerprint
        }
      });

      expect(accepted).toBe(true);
      // Identity preserved: this is the same project, not a copy of it.
      expect(store.getState().project?.id).toBe(target.id);
      expect(store.getState().project?.title).toBe("From the other device");
      expect((await repository.load(target.id)).title).toBe("From the other device");

      // The newest snapshot is the copy that was overwritten — proof it was
      // taken BEFORE the replace, not after.
      const snapshots = await projectSnapshotRepository.listByProject(target.id);
      expect(snapshots[0]?.projectTitle).toBe("On this device");

      const meta = await syncMetaRepository.get(target.id);
      expect(meta?.lastAcceptedRev).toBe("rev-9");
      expect(meta?.accountId).toBe("dbid:tester");
      expect(meta?.remotePath).toBe(syncHeadPath(target.id));
      expect(meta?.paused).toBe(false);
      expect(meta?.lastPullAtIso).not.toBeNull();
      // The recorded fingerprint describes exactly what is now open, so the next
      // check reads "synced" rather than immediately pushing back.
      expect(meta?.fingerprintAtRev).toBe(
        selectBackupFingerprint(store.getState().project!, store.getState().libraryArtworks)
      );
      // Observable state followed the commit without the caller re-reading.
      expect(store.getState().syncMeta?.lastAcceptedRev).toBe("rev-9");
      expect(store.getState().syncStatus).toBe("synced");
      // The pulled content is already in Dropbox; don't burn a retention slot.
      expect(readCloudBackupMeta(target.id).backedUpFingerprint).not.toBeNull();
    });

    // The replace's write order is the whole guarantee: the target's record is
    // the LAST thing written, so a repository failure part-way through leaves
    // the project the curator is looking at exactly as it was — never replaced
    // with its images missing. The library write below stands in for every
    // write in that middle stretch (assets share the same position).
    it("leaves the stored project untouched when a library write fails mid-replace", async () => {
      const store = await bootStore();
      // An artwork gives the commit something to write between the snapshot and
      // the project record.
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const target = store.getState().project!;
      await repository.save(target);
      const bytes = await packageBytesOf(
        { ...target, title: "From the other device" },
        store.getState().libraryArtworks
      );

      // Drop the artwork from this device so the incoming one is new: nothing to
      // park a §6 conflict on, and a library write the commit must make.
      artworkLibraryRepository.artworks.clear();
      store.setState({ libraryArtworks: [] });
      const expectedLocalFingerprint = selectBackupFingerprint(target, []);
      artworkLibraryRepository.save = async () => {
        throw new Error("library store unavailable");
      };

      const accepted = await store.getState().importSyncHeadPackage(bytes, {
        replace: { targetProjectId: target.id, rev: "rev-9", expectedLocalFingerprint }
      });

      expect(accepted).toBe(false);
      expect((await repository.load(target.id)).title).toBe("On this device");
      expect(store.getState().project?.title).toBe("On this device");
      expect(await syncMetaRepository.get(target.id)).toBeUndefined();
      // The recovery snapshot was still taken first, so even this abort left a
      // copy behind.
      const snapshots = await projectSnapshotRepository.listByProject(target.id);
      expect(snapshots[0]?.projectTitle).toBe("On this device");
    });

    // Bookkeeping runs AFTER the commit point, so its failure cannot be
    // reported as "the import failed" — the project really was replaced.
    it("keeps the replace and reports the bookkeeping failure honestly", async () => {
      const store = await bootStore();
      const target = store.getState().project!;
      const expectedLocalFingerprint = selectBackupFingerprint(target, []);
      const bytes = await packageBytesOf({ ...target, title: "From the other device" });
      syncMetaRepository.put = async () => {
        throw new Error("sync meta store unavailable");
      };

      const accepted = await store.getState().importSyncHeadPackage(bytes, {
        replace: { targetProjectId: target.id, rev: "rev-9", expectedLocalFingerprint }
      });

      expect(accepted).toBe(true);
      expect(store.getState().project?.title).toBe("From the other device");
      expect((await repository.load(target.id)).title).toBe("From the other device");
      // Not "Import failed": the import happened. What failed is this device's
      // record of which revision its copy descends from, which makes the next
      // check read as a conflict rather than as licence to overwrite Dropbox.
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(store.getState().syncStatus).toBe("error");
      expect(store.getState().syncError).toBe(BOOKKEEPING_MESSAGE);
    });

    it("aborts untouched when the recovery snapshot cannot be written", async () => {
      const store = await bootStore();
      const target = store.getState().project!;
      const expectedLocalFingerprint = selectBackupFingerprint(target, []);
      const bytes = await packageBytesOf({ ...target, title: "From the other device" });
      projectSnapshotRepository.add = async () => {
        throw new Error("snapshot store unavailable");
      };

      const accepted = await store.getState().importSyncHeadPackage(bytes, {
        replace: { targetProjectId: target.id, rev: "rev-9", expectedLocalFingerprint }
      });

      expect(accepted).toBe(false);
      expect(store.getState().project?.title).toBe("On this device");
      expect((await repository.load(target.id)).title).toBe("On this device");
      expect(await syncMetaRepository.get(target.id)).toBeUndefined();
    });

    it("aborts when the project changed on this device since the pull was decided", async () => {
      const store = await bootStore();
      const target = store.getState().project!;
      const bytes = await packageBytesOf({ ...target, title: "From the other device" });

      const accepted = await store.getState().importSyncHeadPackage(bytes, {
        replace: {
          targetProjectId: target.id,
          rev: "rev-9",
          // A fingerprint from before an edit that has since landed.
          expectedLocalFingerprint: "stale-fingerprint"
        }
      });

      expect(accepted).toBe(false);
      expect(store.getState().project?.title).toBe("On this device");
      expect((await repository.load(target.id)).title).toBe("On this device");
      expect(await syncMetaRepository.get(target.id)).toBeUndefined();
    });

    it("refuses a head that holds a different project than it is named for", async () => {
      const store = await bootStore();
      const target = store.getState().project!;
      const expectedLocalFingerprint = selectBackupFingerprint(target, []);
      const bytes = await packageBytesOf({
        ...target,
        id: "a-completely-different-project",
        title: "Someone else's show"
      });

      const accepted = await store.getState().importSyncHeadPackage(bytes, {
        replace: { targetProjectId: target.id, rev: "rev-9", expectedLocalFingerprint }
      });

      expect(accepted).toBe(false);
      expect(store.getState().project?.title).toBe("On this device");
      expect(repository.projects.has("a-completely-different-project")).toBe(false);
    });

    // v1 scope: a pull only ever replaces the project on screen.
    it("refuses to replace a project that is not the open one", async () => {
      const store = await bootStore();
      const open = store.getState().project!;
      const background: Project = { ...open, id: "background-project", title: "Elsewhere" };
      await repository.save(background);
      const bytes = await packageBytesOf({ ...background, title: "From the other device" });

      const accepted = await store.getState().importSyncHeadPackage(bytes, {
        replace: {
          targetProjectId: background.id,
          rev: "rev-9",
          expectedLocalFingerprint: selectBackupFingerprint(background, [])
        }
      });

      expect(accepted).toBe(false);
      expect(store.getState().project?.id).toBe(open.id);
      expect((await repository.load(background.id)).title).toBe("Elsewhere");
      expect(await syncMetaRepository.get(background.id)).toBeUndefined();
    });

    // The prerequisites live at the COMMIT, not at the download, precisely
    // because an artwork review can sit open while the curator keeps working.
    it("re-checks the prerequisites after an artwork review, not before it", async () => {
      const store = await bootStore();
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().libraryArtworks[0]!.id;
      const target = store.getState().project!;
      await repository.save(target);
      const expectedLocalFingerprint = selectBackupFingerprint(
        target,
        store.getState().libraryArtworks
      );
      const bytes = await packageBytesOf(
        { ...target, title: "From the other device" },
        store.getState().libraryArtworks
      );

      // Same artwork id, different content on this device: a §6 conflict, which
      // parks the pull instead of committing it.
      const local = artworkLibraryRepository.artworks.get(artworkId)!;
      await artworkLibraryRepository.save({ ...local, title: "Local piece" });
      store.setState({ libraryArtworks: await artworkLibraryRepository.list() });

      expect(
        await store.getState().importSyncHeadPackage(bytes, {
          replace: { targetProjectId: target.id, rev: "rev-9", expectedLocalFingerprint }
        })
      ).toBe(true);
      expect(store.getState().pendingPackageImport?.plan.conflicts).toHaveLength(1);
      // The parked record still carries the replace authorization.
      expect(store.getState().pendingPackageImport?.syncPull?.rev).toBe("rev-9");

      // The drift the commit must catch: an edit made while the dialog was open.
      store.setState({
        project: { ...store.getState().project!, title: "Edited while reviewing" }
      });

      await store.getState().resolvePackageImportConflicts({ [artworkId]: "mine" });

      expect(store.getState().project?.title).toBe("Edited while reviewing");
      expect(await syncMetaRepository.get(target.id)).toBeUndefined();
    });
  });

  describe("a sync link for a project this device does not have", () => {
    it("imports under its own identity and links it to the head", async () => {
      const store = await bootStore();
      const open = store.getState().project!;
      const incoming: Project = {
        ...open,
        id: "cloud-only-project",
        title: "Only in Dropbox"
      };
      const bytes = await packageBytesOf(incoming);

      const accepted = await store.getState().importSyncHeadPackage(bytes, {
        link: { projectId: incoming.id, rev: "rev-3" }
      });

      expect(accepted).toBe(true);
      expect(store.getState().project?.id).toBe("cloud-only-project");
      const meta = await syncMetaRepository.get("cloud-only-project");
      expect(meta?.lastAcceptedRev).toBe("rev-3");
      expect(meta?.paused).toBe(false);
      expect(meta?.fingerprintAtRev).toBe(
        selectBackupFingerprint(store.getState().project!, store.getState().libraryArtworks)
      );
      // Nothing was replaced, so the only snapshot of this project is the
      // ordinary open snapshot of the copy that just arrived — there was no
      // earlier document of the user's here to preserve.
      const snapshots = await projectSnapshotRepository.listByProject("cloud-only-project");
      expect(snapshots.map((snapshot) => snapshot.projectTitle)).toEqual(["Only in Dropbox"]);
    });

    it("still imports, but links nothing, when the account id is unknown", async () => {
      const store = await bootStore(makeFakeProvider(null));
      const open = store.getState().project!;
      const bytes = await packageBytesOf({
        ...open,
        id: "cloud-only-project",
        title: "Only in Dropbox"
      });

      expect(
        await store.getState().importSyncHeadPackage(bytes, {
          link: { projectId: "cloud-only-project", rev: "rev-3" }
        })
      ).toBe(true);

      expect(store.getState().project?.id).toBe("cloud-only-project");
      // Sync bookkeeping binds to an account; with none there is nothing honest
      // to bind to, so the project simply reads as unlinked.
      expect(await syncMetaRepository.get("cloud-only-project")).toBeUndefined();
    });
  });
});
