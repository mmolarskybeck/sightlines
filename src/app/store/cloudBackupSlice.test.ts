import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository
} from "../../test/inMemoryRepositories";
import type { CloudBackupProvider } from "../cloud/provider";
import { createAppStore, type AppStoreDeps } from "../store";
import { readCloudBackupMeta } from "./cloudBackupMeta";
import { selectBackupFingerprint } from "./cloudBackupSlice";
import { telemetry } from "../telemetry/telemetry";

// runCloudBackupNow owns its own sonner toasts; capture them without rendering.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

// A controllable stand-in for the Dropbox provider. onUpload lets a test mutate
// the store mid-upload to exercise the "edited during upload" path.
function makeFakeProvider(options: {
  onUpload?: () => void;
  fail?: Error;
  completeHandled?: boolean;
} = {}): CloudBackupProvider & { uploads: number } {
  return {
    id: "fake",
    label: "Fake",
    uploads: 0,
    async startConnect() {},
    async completeConnect() {
      return options.completeHandled ?? false;
    },
    disconnect() {},
    getStatus() {
      return "connected";
    },
    accountLabel() {
      return "Tester";
    },
    async uploadBackup() {
      this.uploads += 1;
      options.onUpload?.();
      if (options.fail) throw options.fail;
    }
  };
}

describe("cloudBackupSlice.runCloudBackup", () => {
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
      ...overrides
    };
  }

  async function bootStore(provider?: CloudBackupProvider) {
    const store = createAppStore(makeDeps({ cloudBackupProvider: provider }));
    await store.getState().boot();
    // Strip artwork references so the package build never needs a stored asset.
    const project = store.getState().project!;
    store.setState({
      project: {
        ...project,
        checklistArtworkIds: [],
        wallObjects: [],
        floorObjects: []
      },
      libraryArtworks: []
    });
    return store;
  }

  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    window.localStorage.clear();
    repository = new InMemoryProjectRepository();
    artworkLibraryRepository = new InMemoryArtworkLibraryRepository();
    assetRepository = new InMemoryAssetRepository();
    imageProcessor = new FakeImageProcessor();
    projectSnapshotRepository = new InMemoryProjectSnapshotRepository();
  });

  it("records a successful Dropbox connection", async () => {
    const track = vi.spyOn(telemetry, "track");
    const store = await bootStore(makeFakeProvider({ completeHandled: true }));
    await store.getState().completeCloudBackupConnect();
    expect(track).toHaveBeenCalledWith("cloud_backup_connected", { provider: "dropbox" });
    track.mockRestore();
  });

  it("marks backed-up when the project is unchanged during upload", async () => {
    const provider = makeFakeProvider();
    const store = await bootStore(provider);
    const project = store.getState().project!;
    const expected = selectBackupFingerprint(project, []);

    await store.getState().runCloudBackup();

    expect(provider.uploads).toBe(1);
    const meta = readCloudBackupMeta(project.id);
    expect(meta.backedUpFingerprint).toBe(expected);
    expect(meta.lastCloudBackupAt).not.toBeNull();
    expect(store.getState().cloudBackupStatus).toBe("idle");
    expect(store.getState().cloudBackupPending).toBe(false);
  });

  it("records the time but NOT the fingerprint when edited during upload", async () => {
    let store!: ReturnType<typeof createAppStore>;
    const provider = makeFakeProvider({
      onUpload: () => {
        // Simulate an edit landing while the upload is in flight.
        const current = store.getState().project!;
        store.setState({ project: { ...current, title: `${current.title} (edited)` } });
      }
    });
    store = await bootStore(provider);
    const project = store.getState().project!;
    const captured = selectBackupFingerprint(project, []);

    await store.getState().runCloudBackup();

    const meta = readCloudBackupMeta(project.id);
    // The captured snapshot is now stale, so it must not be recorded as backed up.
    expect(meta.backedUpFingerprint).not.toBe(captured);
    expect(meta.backedUpFingerprint).toBeNull();
    // The upload still happened, so the time is recorded and it's still dirty.
    expect(meta.lastCloudBackupAt).not.toBeNull();
    expect(store.getState().cloudBackupPending).toBe(true);
  });

  it("goes to error state and does not record meta on upload failure", async () => {
    const provider = makeFakeProvider({ fail: new Error("upload boom") });
    const store = await bootStore(provider);
    const project = store.getState().project!;

    await store.getState().runCloudBackup();

    expect(store.getState().cloudBackupStatus).toBe("error");
    expect(store.getState().cloudBackupError).toContain("upload boom");
    expect(readCloudBackupMeta(project.id).backedUpFingerprint).toBeNull();
  });

  it("is a no-op when the provider is not connected", async () => {
    const provider = makeFakeProvider();
    vi.spyOn(provider, "getStatus").mockReturnValue("disconnected");
    const store = await bootStore(provider);

    await store.getState().runCloudBackup();

    expect(provider.uploads).toBe(0);
  });

  it("does nothing without a provider", async () => {
    const store = await bootStore(undefined);
    await store.getState().runCloudBackup();
    expect(store.getState().cloudBackupStatus).toBe("idle");
  });
});

describe("cloudBackupSlice.runCloudBackupNow", () => {
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
      ...overrides
    };
  }

  async function bootStore(provider?: CloudBackupProvider) {
    const store = createAppStore(makeDeps({ cloudBackupProvider: provider }));
    await store.getState().boot();
    const project = store.getState().project!;
    store.setState({
      project: {
        ...project,
        checklistArtworkIds: [],
        wallObjects: [],
        floorObjects: []
      },
      libraryArtworks: []
    });
    return store;
  }

  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    window.localStorage.clear();
    repository = new InMemoryProjectRepository();
    artworkLibraryRepository = new InMemoryArtworkLibraryRepository();
    assetRepository = new InMemoryAssetRepository();
    imageProcessor = new FakeImageProcessor();
    projectSnapshotRepository = new InMemoryProjectSnapshotRepository();
  });

  it("uploads and confirms when there are changes to back up", async () => {
    const provider = makeFakeProvider();
    const store = await bootStore(provider);

    await store.getState().runCloudBackupNow();

    expect(provider.uploads).toBe(1);
    expect(toast.success).toHaveBeenCalledWith("Backed up to Dropbox.");
  });

  it("short-circuits with a quiet toast when nothing has changed", async () => {
    const provider = makeFakeProvider();
    const store = await bootStore(provider);

    // First backup records the fingerprint as up to date.
    await store.getState().runCloudBackup();
    expect(provider.uploads).toBe(1);

    // A manual run with no intervening edit must NOT re-upload.
    await store.getState().runCloudBackupNow();
    expect(provider.uploads).toBe(1);
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Already backed up — no changes")
    );
  });

  it("is a no-op while an upload is already in flight", async () => {
    const provider = makeFakeProvider();
    const store = await bootStore(provider);
    store.setState({ cloudBackupStatus: "uploading" });

    await store.getState().runCloudBackupNow();

    expect(provider.uploads).toBe(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("gives feedback when a manual retry fails again with the same message", async () => {
    const provider = makeFakeProvider({ fail: new Error("upload boom") });
    const store = await bootStore(provider);

    // Seed a prior identical error so the reactive toast would dedupe it.
    store.setState({ cloudBackupError: "upload boom" });

    await store.getState().runCloudBackupNow();

    expect(store.getState().cloudBackupStatus).toBe("error");
    expect(toast.error).toHaveBeenCalledWith(
      "upload boom",
      expect.objectContaining({ action: expect.any(Object) })
    );
  });

  it("stays silent on the first failure so the reactive toast owns it", async () => {
    const provider = makeFakeProvider({ fail: new Error("first boom") });
    const store = await bootStore(provider);

    // No prior error: the message transitions null → "first boom", which the
    // reactive useCloudBackupErrorToast handles, so runCloudBackupNow must not
    // double up.
    await store.getState().runCloudBackupNow();

    expect(store.getState().cloudBackupStatus).toBe("error");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("routes a manual run to reconnect surfacing when not connected", async () => {
    const provider = makeFakeProvider();
    vi.spyOn(provider, "getStatus").mockReturnValue("reauthorization-required");
    const store = await bootStore(provider);

    await store.getState().runCloudBackupNow();

    expect(provider.uploads).toBe(0);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
