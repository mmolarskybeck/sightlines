// The sync state machine, driven against an in-memory stand-in for Dropbox that
// enforces the one rule the real provider enforces: a rev-conditional write
// fails when the head has moved on. Every "conflict" below is that failure, not
// a simulation of it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createSightlinesPackage } from "../../domain/package/buildPackage";
import type { Project } from "../../domain/project";
import type { ProjectSyncMeta } from "../../domain/repositories/syncMetaRepository";
import { getProjectSyncRowState } from "../cloud/cloudBackupCopy";
import { CloudBackupError } from "../cloud/dropbox";
import { syncHeadPath } from "../cloud/dropboxAuth";
import type {
  CloudBackupProvider,
  CloudBackupProviderStatus,
  SyncHeadMetadata
} from "../cloud/provider";
import { createInertCrossTabSync } from "../crossTabSync";
import { createAppStore, type AppStoreDeps } from "../store";
import { selectBackupFingerprint } from "./cloudBackupSlice";
import { telemetry } from "../telemetry/telemetry";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository,
  InMemorySyncMetaRepository
} from "../../test/inMemoryRepositories";

// The import pipeline a pull runs through owns its own toasts.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));

type StoredHead = { bytes: Uint8Array; rev: string; serverModifiedIso: string | null };

// jsdom's Blob has no arrayBuffer(), so read the uploaded package the long way.
// The real provider streams the blob to Dropbox and never needs its bytes; this
// stand-in keeps them so a later pull can hand them back.
async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("blob read failed"));
    reader.readAsArrayBuffer(blob);
  });
}

type FakeSyncProviderOptions = {
  accountId?: string | null;
  status?: CloudBackupProviderStatus;
  // Fires at the START of a head write, so a test can advance the remote in the
  // window between the check that decided to push and the write itself.
  onUpload?: () => void;
  onGetHead?: () => void;
  failDownload?: CloudBackupError;
};

type FakeSyncProvider = CloudBackupProvider & {
  heads: Map<string, StoredHead>;
  uploads: number;
  downloads: number;
  headReads: number;
  setHead: (projectId: string, bytes: Uint8Array, rev: string) => void;
};

function makeSyncProvider(options: FakeSyncProviderOptions = {}): FakeSyncProvider {
  let revCounter = 0;
  return {
    id: "fake",
    label: "Fake",
    heads: new Map<string, StoredHead>(),
    uploads: 0,
    downloads: 0,
    headReads: 0,
    setHead(projectId, bytes, rev) {
      this.heads.set(projectId, { bytes, rev, serverModifiedIso: "2026-08-19T09:00:00.000Z" });
    },
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
    accountId() {
      return options.accountId === undefined ? "dbid:tester" : options.accountId;
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
    async getSyncHead(projectId) {
      this.headReads += 1;
      options.onGetHead?.();
      const head = this.heads.get(projectId);
      if (!head) return null;
      return {
        rev: head.rev,
        serverModifiedIso: head.serverModifiedIso,
        sizeBytes: head.bytes.byteLength
      };
    },
    async downloadSyncHead(projectId) {
      this.downloads += 1;
      if (options.failDownload) throw options.failDownload;
      const head = this.heads.get(projectId);
      if (!head) throw new CloudBackupError("not-found", "path/not_found");
      return { bytes: head.bytes, rev: head.rev };
    },
    async uploadSyncHead({ projectId, blob, baseRev }): Promise<SyncHeadMetadata> {
      this.uploads += 1;
      options.onUpload?.();
      const existing = this.heads.get(projectId);
      // Exactly the two ways a rev-conditional write loses: creating a head that
      // is already there, or updating one that has moved on.
      if (baseRev === null && existing) {
        throw new CloudBackupError("conflict", "path/conflict/file");
      }
      if (baseRev !== null && existing?.rev !== baseRev) {
        throw new CloudBackupError("conflict", "path/conflict/file");
      }
      revCounter += 1;
      const rev = `rev-uploaded-${revCounter}`;
      const bytes = await readBlobBytes(blob);
      this.heads.set(projectId, {
        bytes,
        rev,
        serverModifiedIso: "2026-08-19T12:00:00.000Z"
      });
      return { rev, serverModifiedIso: "2026-08-19T12:00:00.000Z", sizeBytes: bytes.byteLength };
    },
    async listSyncHeads() {
      return [];
    }
  };
}

describe("cloudSyncSlice", () => {
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
    const project = store.getState().project!;
    // Artwork-free so packages build without stored assets, and stored so a
    // replace can load the copy it is about to overwrite.
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

  async function packageBytesOf(project: Project): Promise<Uint8Array> {
    const built = await createSightlinesPackage({
      project,
      libraryArtworks: [],
      mode: "display",
      getAsset: (id) => assetRepository.getAsset(id),
      getBlob: (key) => assetRepository.getBlob(key)
    });
    return new Uint8Array(built.zip);
  }

  // "Another device wrote the head": a different version of the same project,
  // at a rev this device has never accepted.
  async function seedRemoteEdit(
    provider: FakeSyncProvider,
    project: Project,
    title: string,
    rev: string
  ): Promise<void> {
    provider.setHead(project.id, await packageBytesOf({ ...project, title }), rev);
  }

  function editLocally(store: ReturnType<typeof createAppStore>, title: string): void {
    store.setState({ project: { ...store.getState().project!, title } });
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

  describe("enabling sync", () => {
    it("creates the head and records the rev it wrote", async () => {
      const track = vi.spyOn(telemetry, "track");
      const provider = makeSyncProvider();
      const store = await bootStore(provider);
      const project = store.getState().project!;

      await store.getState().enableProjectSync();

      expect(provider.heads.get(project.id)?.rev).toBe("rev-uploaded-1");
      const meta = await syncMetaRepository.get(project.id);
      expect(meta?.lastAcceptedRev).toBe("rev-uploaded-1");
      expect(meta?.accountId).toBe("dbid:tester");
      expect(meta?.remotePath).toBe(syncHeadPath(project.id));
      expect(meta?.fingerprintAtRev).toBe(selectBackupFingerprint(project, []));
      expect(meta?.lastPushAtIso).not.toBeNull();
      expect(store.getState().syncStatus).toBe("synced");
      expect(track).toHaveBeenCalledWith("cloud_sync_enabled", {});
      track.mockRestore();
    });

    // Another device linked this project first: there is no common base, so the
    // curator picks a whole version rather than one copy silently winning.
    it("parks a conflict instead of replacing a head another device created", async () => {
      const provider = makeSyncProvider();
      const store = await bootStore(provider);
      const project = store.getState().project!;
      await seedRemoteEdit(provider, project, "From the other device", "rev-remote-1");

      await store.getState().enableProjectSync();

      expect(store.getState().syncStatus).toBe("conflict");
      expect(store.getState().syncConflict).toMatchObject({
        remoteRev: "rev-remote-1",
        remoteModifiedIso: "2026-08-19T09:00:00.000Z",
        remoteMissing: false,
        binding: { projectId: project.id }
      });
      // Nothing was linked and nothing was overwritten.
      expect(await syncMetaRepository.get(project.id)).toBeUndefined();
      expect(provider.heads.get(project.id)?.rev).toBe("rev-remote-1");
    });

    it("stays inert without a provider, while disconnected, or with no account id", async () => {
      const withoutProvider = await bootStore();
      await withoutProvider.getState().enableProjectSync();
      expect(withoutProvider.getState().syncStatus).toBe("idle");

      const disconnected = makeSyncProvider({ status: "disconnected" });
      const offline = await bootStore(disconnected);
      await offline.getState().enableProjectSync();
      expect(disconnected.uploads).toBe(0);
      expect(offline.getState().syncStatus).toBe("idle");

      const anonymous = makeSyncProvider({ accountId: null });
      const unbound = await bootStore(anonymous);
      await unbound.getState().enableProjectSync();
      expect(anonymous.uploads).toBe(0);
      expect(unbound.getState().syncStatus).toBe("error");
    });
  });

  describe("the state-machine check", () => {
    async function bootLinked() {
      const provider = makeSyncProvider();
      const store = await bootStore(provider);
      await store.getState().enableProjectSync();
      return { provider, store, project: store.getState().project! };
    }

    it("reports synced when neither side moved", async () => {
      const { provider, store } = await bootLinked();
      const uploadsAfterEnable = provider.uploads;

      await store.getState().checkProjectSync();

      expect(store.getState().syncStatus).toBe("synced");
      expect(provider.uploads).toBe(uploadsAfterEnable);
      expect(provider.downloads).toBe(0);
    });

    it("pushes this device's changes against the accepted rev", async () => {
      const { provider, store, project } = await bootLinked();
      editLocally(store, "Edited here");

      await store.getState().checkProjectSync();

      expect(provider.heads.get(project.id)?.rev).toBe("rev-uploaded-2");
      const meta = await syncMetaRepository.get(project.id);
      expect(meta?.lastAcceptedRev).toBe("rev-uploaded-2");
      expect(meta?.fingerprintAtRev).toBe(
        selectBackupFingerprint(store.getState().project!, [])
      );
      expect(store.getState().syncStatus).toBe("synced");
    });

    it("pulls the other device's version when only the remote moved", async () => {
      const { provider, store, project } = await bootLinked();
      await seedRemoteEdit(provider, project, "From the other device", "rev-remote-2");

      await store.getState().checkProjectSync();

      expect(store.getState().project?.id).toBe(project.id);
      expect(store.getState().project?.title).toBe("From the other device");
      const meta = await syncMetaRepository.get(project.id);
      expect(meta?.lastAcceptedRev).toBe("rev-remote-2");
      expect(meta?.lastPullAtIso).not.toBeNull();
      expect(store.getState().syncStatus).toBe("synced");
      // The overwritten copy is recoverable.
      const snapshots = await projectSnapshotRepository.listByProject(project.id);
      expect(snapshots[0]?.projectTitle).toBe("On this device");
    });

    it("parks a whole-project conflict when both sides moved, writing nothing", async () => {
      const { provider, store, project } = await bootLinked();
      await seedRemoteEdit(provider, project, "From the other device", "rev-remote-2");
      editLocally(store, "Edited here");
      const uploadsAfterEnable = provider.uploads;

      await store.getState().checkProjectSync();

      expect(store.getState().syncStatus).toBe("conflict");
      expect(store.getState().syncConflict?.remoteRev).toBe("rev-remote-2");
      expect(provider.uploads).toBe(uploadsAfterEnable);
      expect(store.getState().project?.title).toBe("Edited here");
      expect(provider.heads.get(project.id)?.rev).toBe("rev-remote-2");
    });

    it("surfaces a head that vanished instead of recreating it", async () => {
      const { provider, store, project } = await bootLinked();
      provider.heads.delete(project.id);
      const uploadsAfterEnable = provider.uploads;

      await store.getState().checkProjectSync();

      expect(store.getState().syncStatus).toBe("needs-review");
      expect(store.getState().syncConflict).toMatchObject({
        remoteRev: null,
        remoteModifiedIso: null,
        remoteMissing: true,
        binding: { projectId: project.id }
      });
      expect(provider.uploads).toBe(uploadsAfterEnable);
      expect(provider.heads.has(project.id)).toBe(false);
    });

    // The head moved between the check that said "push" and the write itself.
    // The conditional write fails; re-running the check answers honestly.
    it("re-evaluates rather than retrying when a push loses its race", async () => {
      const provider = makeSyncProvider();
      const store = await bootStore(provider);
      await store.getState().enableProjectSync();
      const project = store.getState().project!;
      editLocally(store, "Edited here");
      let advanced = false;
      const remoteBytes = await packageBytesOf({ ...project, title: "From the other device" });
      const original = provider.uploadSyncHead.bind(provider);
      provider.uploadSyncHead = async (input) => {
        if (!advanced) {
          advanced = true;
          provider.setHead(project.id, remoteBytes, "rev-remote-3");
        }
        return original(input);
      };

      await store.getState().checkProjectSync();

      // Both sides had changed by the time the write landed, so the honest
      // answer is a conflict — never a blind retry that overwrites.
      expect(store.getState().syncStatus).toBe("conflict");
      expect(store.getState().syncConflict?.remoteRev).toBe("rev-remote-3");
      expect(provider.heads.get(project.id)?.rev).toBe("rev-remote-3");
    });

    // The window the assessment used to be blind to: the check reads the
    // project, then goes to the network, and the curator keeps working while
    // Dropbox answers. Folding that edit in afterwards would have answered
    // "pull" and then quietly overwritten it.
    it("assesses an edit that lands during the head read instead of pulling over it", async () => {
      let duringHeadRead: (() => void) | null = null;
      const provider = makeSyncProvider({ onGetHead: () => duringHeadRead?.() });
      const store = await bootStore(provider);
      await store.getState().enableProjectSync();
      const project = store.getState().project!;
      await seedRemoteEdit(provider, project, "From the other device", "rev-remote-2");
      duringHeadRead = () => editLocally(store, "Edited during the check");

      await store.getState().checkProjectSync();

      // Both sides moved, so the matrix says conflict — the curator decides.
      expect(store.getState().syncStatus).toBe("conflict");
      expect(store.getState().project?.title).toBe("Edited during the check");
      expect(provider.downloads).toBe(0);
    });

    // The operation is bound to one project. If the curator opens another while
    // the head read is in flight, the check belongs to a project nobody is
    // looking at any more.
    it("abandons the check when another project is opened while Dropbox answers", async () => {
      let duringHeadRead: (() => void) | null = null;
      const provider = makeSyncProvider({ onGetHead: () => duringHeadRead?.() });
      const store = await bootStore(provider);
      await store.getState().enableProjectSync();
      const project = store.getState().project!;
      await seedRemoteEdit(provider, project, "From the other device", "rev-remote-2");
      const other: Project = { ...project, id: "another-project", title: "Another show" };
      await repository.save(other);
      duringHeadRead = () => store.setState({ project: other });

      await store.getState().checkProjectSync();

      // Nothing was downloaded, and the newly opened project — which was never
      // assessed, and has no head at all — carries no invented sync state.
      expect(provider.downloads).toBe(0);
      expect(store.getState().project?.id).toBe("another-project");
      expect(store.getState().syncStatus).toBe("idle");
      expect(store.getState().syncConflict).toBeNull();
      expect(store.getState().syncMeta).toBeNull();
    });

    it("is a no-op while a check or a transfer already owns the project", async () => {
      const { provider, store } = await bootLinked();
      const headReadsBefore = provider.headReads;

      store.setState({ syncStatus: "pulling" });
      await store.getState().checkProjectSync();
      expect(provider.headReads).toBe(headReadsBefore);

      store.setState({ syncStatus: "checking" });
      await store.getState().checkProjectSync();
      expect(provider.headReads).toBe(headReadsBefore);
    });

    it("does nothing for a project with no sync metadata", async () => {
      const provider = makeSyncProvider();
      const store = await bootStore(provider);

      await store.getState().checkProjectSync();

      expect(provider.headReads).toBe(0);
      expect(store.getState().syncStatus).toBe("idle");
    });

    // Bookkeeping is bound to the account id, so a browser relinked to another
    // Dropbox account can never inherit this account's revision lineage.
    it("reads metadata from a different account as not linked, and keeps it", async () => {
      const { store, project } = await bootLinked();
      const meta = (await syncMetaRepository.get(project.id))!;
      const foreign: ProjectSyncMeta = { ...meta, accountId: "dbid:someone-else" };
      await syncMetaRepository.put(foreign);

      await store.getState().refreshProjectSyncState();

      expect(store.getState().syncMeta).toBeNull();
      expect(store.getState().syncStatus).toBe("idle");
      // Not deleted: reconnecting the original account restores the link.
      expect((await syncMetaRepository.get(project.id))?.accountId).toBe("dbid:someone-else");
    });
  });

  describe("resolving a conflict", () => {
    async function bootConflicted() {
      const provider = makeSyncProvider();
      const store = await bootStore(provider);
      await store.getState().enableProjectSync();
      const project = store.getState().project!;
      await seedRemoteEdit(provider, project, "From the other device", "rev-remote-2");
      editLocally(store, "Edited here");
      await store.getState().checkProjectSync();
      expect(store.getState().syncStatus).toBe("conflict");
      return { provider, store, project };
    }

    it("replaces this device's copy for “use the Dropbox version”", async () => {
      const track = vi.spyOn(telemetry, "track");
      const { store, project } = await bootConflicted();

      await store.getState().resolveSyncConflict("use-dropbox");

      expect(store.getState().project?.title).toBe("From the other device");
      expect((await syncMetaRepository.get(project.id))?.lastAcceptedRev).toBe("rev-remote-2");
      expect(store.getState().syncStatus).toBe("synced");
      expect(store.getState().syncConflict).toBeNull();
      expect(track).toHaveBeenCalledWith("cloud_sync_conflict_resolved", {
        choice: "use-dropbox"
      });
      track.mockRestore();
    });

    it("replaces the Dropbox version for “keep this device's version”", async () => {
      const { provider, store, project } = await bootConflicted();

      await store.getState().resolveSyncConflict("keep-mine");

      expect(store.getState().project?.title).toBe("Edited here");
      expect(provider.heads.get(project.id)?.rev).toBe("rev-uploaded-2");
      const meta = await syncMetaRepository.get(project.id);
      expect(meta?.lastAcceptedRev).toBe("rev-uploaded-2");
      expect(store.getState().syncStatus).toBe("synced");
      expect(store.getState().syncConflict).toBeNull();
    });

    // The guarded write is still guarded: if the remote advanced AGAIN while the
    // dialog was open, the write fails and the conflict simply re-parks.
    it("re-parks when the remote advanced again during the review", async () => {
      const { provider, store, project } = await bootConflicted();
      const laterBytes = await packageBytesOf({ ...project, title: "Third version" });
      const original = provider.uploadSyncHead.bind(provider);
      provider.uploadSyncHead = async (input) => {
        provider.setHead(project.id, laterBytes, "rev-remote-4");
        return original(input);
      };

      await store.getState().resolveSyncConflict("keep-mine");

      expect(store.getState().syncStatus).toBe("conflict");
      expect(store.getState().syncConflict?.remoteRev).toBe("rev-remote-4");
      expect(store.getState().project?.title).toBe("Edited here");
    });

    it("saves this device's copy as a separate unlinked project for “keep both”", async () => {
      const { store, project } = await bootConflicted();
      const localTitle = store.getState().project!.title;

      await store.getState().resolveSyncConflict("keep-both");

      // The Dropbox version lands in the linked identity...
      expect(store.getState().project?.id).toBe(project.id);
      expect(store.getState().project?.title).toBe("From the other device");
      // ...and the divergent local copy survives as its own project, with a new
      // id, unopened and unlinked.
      const forks = [...repository.projects.values()].filter(
        (candidate) => candidate.title === `${localTitle} (this device)`
      );
      expect(forks).toHaveLength(1);
      expect(forks[0]!.id).not.toBe(project.id);
      expect(await syncMetaRepository.get(forks[0]!.id)).toBeUndefined();
      expect((await syncMetaRepository.get(project.id))?.lastAcceptedRev).toBe("rev-remote-2");
    });

    it("keeps the conflict parked when the separate copy cannot be saved", async () => {
      const { provider, store } = await bootConflicted();
      const downloadsBefore = provider.downloads;
      repository.save = async () => {
        throw new Error("IndexedDB unavailable");
      };

      await store.getState().resolveSyncConflict("keep-both");

      expect(store.getState().syncStatus).toBe("conflict");
      expect(store.getState().syncConflict?.remoteRev).toBe("rev-remote-2");
      // Pulling now would destroy the very copy the user asked to keep.
      expect(provider.downloads).toBe(downloadsBefore);
      expect(store.getState().project?.title).toBe("Edited here");
    });

    // The dialog can sit open for minutes. A choice taken against one version of
    // the project must not silently apply to a newer one: the parked conflict
    // carries the fingerprint it was parked with, and the commit's drift check
    // refuses the replace. The next check re-parks the conflict honestly.
    it("aborts “use the Dropbox version” when this device changed during the review", async () => {
      const { provider, store, project } = await bootConflicted();
      editLocally(store, "Edited while deciding");

      await store.getState().resolveSyncConflict("use-dropbox");

      expect(store.getState().project?.title).toBe("Edited while deciding");
      expect((await syncMetaRepository.get(project.id))?.lastAcceptedRev).toBe("rev-uploaded-1");
      expect(store.getState().syncStatus).toBe("error");
      // Neither side was written.
      expect(provider.heads.get(project.id)?.rev).toBe("rev-remote-2");
    });

    // "Keep both" is the opposite decision: the fork is saved from the CURRENT
    // state, so a dialog-time edit is already safe on disk before the pull runs.
    // Aborting the pull there would strand the user in the conflict having lost
    // nothing — so the pull is re-baselined against the fresh fingerprint.
    it("forks the edits made during the review, then still pulls", async () => {
      const { store, project } = await bootConflicted();
      editLocally(store, "Edited while deciding");

      await store.getState().resolveSyncConflict("keep-both");

      const forks = [...repository.projects.values()].filter(
        (candidate) => candidate.id !== project.id
      );
      expect(forks).toHaveLength(1);
      expect(forks[0]!.title).toBe("Edited while deciding (this device)");
      expect(store.getState().project?.title).toBe("From the other device");
      expect((await syncMetaRepository.get(project.id))?.lastAcceptedRev).toBe("rev-remote-2");
    });

    it("does nothing when the conflict is resolved after another project is opened", async () => {
      const { provider, store, project } = await bootConflicted();
      const other: Project = { ...project, id: "another-project", title: "Another show" };
      await repository.save(other);
      store.setState({ project: other });
      const downloadsBefore = provider.downloads;

      await store.getState().resolveSyncConflict("use-dropbox");

      // The decision belonged to a project nobody is looking at: no download, no
      // replace, and the project that IS open reads as its own unlinked self.
      expect(provider.downloads).toBe(downloadsBefore);
      expect(store.getState().project?.title).toBe("Another show");
      expect(store.getState().syncStatus).toBe("idle");
      expect(store.getState().syncConflict).toBeNull();
      expect((await repository.load(project.id)).title).toBe("On this device");
    });

    it("pauses quietly for “not now”, and a reload lands back in needs review", async () => {
      const { provider, store, project } = await bootConflicted();

      await store.getState().resolveSyncConflict("not-now");

      expect(store.getState().syncStatus).toBe("needs-review");
      expect(store.getState().syncConflict).toBeNull();
      expect((await syncMetaRepository.get(project.id))?.paused).toBe(true);

      // A background cycle must not re-prompt.
      const headReadsAfterPause = provider.headReads;
      await store.getState().checkProjectSync();
      expect(provider.headReads).toBe(headReadsAfterPause);
      expect(store.getState().syncStatus).toBe("needs-review");

      // A fresh store over the same storage — the reload case — reads the pause
      // back rather than re-opening the dialog.
      const reloaded = createAppStore(makeDeps({ cloudBackupProvider: provider }));
      await reloaded.getState().boot();
      await reloaded.getState().refreshProjectSyncState();
      expect(reloaded.getState().syncStatus).toBe("needs-review");
      expect(reloaded.getState().syncConflict).toBeNull();

      // Only the explicit review gesture resumes it.
      await store.getState().checkProjectSync({ manual: true });
      expect((await syncMetaRepository.get(project.id))?.paused).toBe(false);
      expect(store.getState().syncStatus).toBe("conflict");
    });

    it("re-creates a vanished head for “keep this device's version”", async () => {
      const provider = makeSyncProvider();
      const store = await bootStore(provider);
      await store.getState().enableProjectSync();
      const project = store.getState().project!;
      provider.heads.delete(project.id);
      await store.getState().checkProjectSync();
      expect(store.getState().syncConflict?.remoteMissing).toBe(true);

      await store.getState().resolveSyncConflict("keep-mine");

      expect(provider.heads.get(project.id)?.rev).toBe("rev-uploaded-2");
      expect((await syncMetaRepository.get(project.id))?.lastAcceptedRev).toBe("rev-uploaded-2");
      expect(store.getState().syncStatus).toBe("synced");
    });
  });

  // A failed enable leaves the one state where the popover's retry can't be the
  // manual check: there is no metadata for a check to read, so it would no-op
  // and quietly replace the error with "Off for this project".
  describe("a failed enable", () => {
    it("leaves an error the popover row retries by enabling again", async () => {
      const provider = makeSyncProvider();
      provider.uploadSyncHead = async () => {
        throw new CloudBackupError("transient", "Dropbox could not be reached.");
      };
      const store = await bootStore(provider);

      await store.getState().enableProjectSync();

      expect(store.getState().syncStatus).toBe("error");
      expect(store.getState().syncMeta).toBeNull();
      const row = getProjectSyncRowState({
        connected: true,
        linked: store.getState().syncMeta !== null,
        status: store.getState().syncStatus,
        error: store.getState().syncError
      });
      expect(row?.action).toBe("enable");
      expect(row?.actionLabel).toBe("Try again");
      expect(row?.text).toBe("Dropbox could not be reached.");
    });

    it("mirrors a mid-write reauth into provider status so the UI can offer Reconnect", async () => {
      // A 401 mid-upload flips the provider's sticky reauth flag. Until that
      // lands in observable state, the row keeps offering a retry whose
      // getStatus() guard silently no-ops — the exact inert-"Try again" bug.
      // Mirrored, the sync row (gated on connected) yields to the Dropbox
      // row's Reconnect affordance.
      const provider = makeSyncProvider();
      let revoked = false;
      provider.uploadSyncHead = async () => {
        revoked = true;
        throw new CloudBackupError("reauth", "Dropbox access has expired.");
      };
      const baseGetStatus = provider.getStatus.bind(provider);
      provider.getStatus = () =>
        revoked ? "reauthorization-required" : baseGetStatus();
      const store = await bootStore(provider);

      await store.getState().enableProjectSync();

      expect(store.getState().syncStatus).toBe("error");
      expect(store.getState().cloudBackupProviderStatus).toBe(
        "reauthorization-required"
      );
      const row = getProjectSyncRowState({
        connected:
          store.getState().cloudBackupProviderStatus === "connected",
        linked: store.getState().syncMeta !== null,
        status: store.getState().syncStatus,
        error: store.getState().syncError
      });
      expect(row).toBeNull();
    });
  });

  describe("turning sync off", () => {
    it("unlinks this device and leaves the canonical copy alone", async () => {
      const provider = makeSyncProvider();
      const store = await bootStore(provider);
      await store.getState().enableProjectSync();
      const project = store.getState().project!;

      await store.getState().disableProjectSync();

      expect(await syncMetaRepository.get(project.id)).toBeUndefined();
      expect(store.getState().syncMeta).toBeNull();
      expect(store.getState().syncStatus).toBe("idle");
      // Other devices are still syncing against it.
      expect(provider.heads.get(project.id)?.rev).toBe("rev-uploaded-1");
    });
  });
});
