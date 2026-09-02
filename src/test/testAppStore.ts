import type { CrossTabMessage, CrossTabSync } from "../app/crossTabSync";
import { createAppStore, type AppStoreDeps } from "../app/store";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository,
  InMemorySyncMetaRepository
} from "./inMemoryRepositories";

// A CrossTabSync stand-in: it records what this store told the other tabs, and
// `deliver` plays another tab's announcement back into it.
//
// Every store built for a test gets its own, never the real BroadcastChannel:
// a vitest process is one browsing context, so stores sharing it would hear
// each other's saves — and since every test opens the same sample project id,
// that cross-talk would be about the same project.
export type FakeCrossTabSync = {
  sync: CrossTabSync;
  announced: CrossTabMessage[];
  deliver: (message: CrossTabMessage) => Promise<void>;
};

export function makeFakeCrossTabSync(): FakeCrossTabSync {
  const handlers = new Set<(message: CrossTabMessage) => void>();
  const announced: CrossTabMessage[] = [];
  return {
    announced,
    async deliver(message) {
      for (const handler of [...handlers]) handler(message);
      // The store's handler is async and started with `void`; a macrotask turn
      // lets its storage read and setDocument finish before the test asserts.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    sync: {
      announceProjectSaved(projectId, updatedAt) {
        announced.push({ kind: "project-saved", projectId, updatedAt });
      },
      announceArtworksSaved() {
        announced.push({ kind: "artworks-saved" });
      },
      subscribe(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      close() {
        handlers.clear();
      }
    }
  };
}

export type TestAppStoreRepositories = {
  projectRepository: InMemoryProjectRepository;
  artworkLibraryRepository: InMemoryArtworkLibraryRepository;
  assetRepository: InMemoryAssetRepository;
  imageProcessor: FakeImageProcessor;
  projectSnapshotRepository: InMemoryProjectSnapshotRepository;
  syncMetaRepository: InMemorySyncMetaRepository;
  crossTab: FakeCrossTabSync;
};

export type TestAppStore = TestAppStoreRepositories & {
  store: ReturnType<typeof createAppStore>;
};

// A fresh set of in-memory repositories plus a store built on them, for tests
// that need exactly one store. `overrides` fills the same AppStoreDeps seam
// (a custom cloudBackupProvider, onProjectDeleted, a stand-in repository for
// one test) the same way createAppStore's own deps object would.
//
// The repositories are returned alongside the store, not just consumed by it,
// so a test that needs MORE than one store — a second store simulating
// another tab, or a store re-instantiated to check what got persisted — can
// build one against the very same backing data instead of fresh ones.
export function createTestAppStore(overrides: Partial<AppStoreDeps> = {}): TestAppStore {
  const repositories: TestAppStoreRepositories = {
    projectRepository: new InMemoryProjectRepository(),
    artworkLibraryRepository: new InMemoryArtworkLibraryRepository(),
    assetRepository: new InMemoryAssetRepository(),
    imageProcessor: new FakeImageProcessor(),
    projectSnapshotRepository: new InMemoryProjectSnapshotRepository(),
    syncMetaRepository: new InMemorySyncMetaRepository(),
    crossTab: makeFakeCrossTabSync()
  };

  const store = createAppStore({
    projectRepository: repositories.projectRepository,
    artworkLibraryRepository: repositories.artworkLibraryRepository,
    assetRepository: repositories.assetRepository,
    imageProcessor: repositories.imageProcessor,
    projectSnapshotRepository: repositories.projectSnapshotRepository,
    syncMetaRepository: repositories.syncMetaRepository,
    crossTabSync: repositories.crossTab.sync,
    ...overrides
  });

  return { store, ...repositories };
}
