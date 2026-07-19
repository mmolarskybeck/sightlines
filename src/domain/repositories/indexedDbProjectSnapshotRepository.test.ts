import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import type { Project } from "../project";
import type { ProjectSnapshotRecord } from "./projectSnapshotRepository";

// Each test gets a brand-new in-memory database and a fresh module cache, so the
// openDatabase() connection singleton doesn't leak across tests.
async function freshModules() {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const repoModule = await import("./indexedDbProjectSnapshotRepository");
  const dbModule = await import("./database");
  return { repoModule, dbModule };
}

function makeRecord(
  projectId: string,
  overrides: Partial<ProjectSnapshotRecord> = {}
): ProjectSnapshotRecord {
  const project: Project = { ...createSampleProject(), id: projectId };
  return {
    projectId,
    createdAt: new Date().toISOString(),
    projectTitle: project.title,
    fingerprint: "fp-default",
    project,
    ...overrides
  };
}

describe("IndexedDbProjectSnapshotRepository", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps only the newest 5 distinct snapshots (prune)", async () => {
    const { repoModule } = await freshModules();
    const repo = new repoModule.IndexedDbProjectSnapshotRepository();

    for (let i = 0; i < 8; i += 1) {
      await repo.add(
        makeRecord("proj-1", {
          createdAt: `2026-07-19T00:0${i}:00.000Z`,
          fingerprint: `fp-${i}`
        })
      );
    }

    const summaries = await repo.listByProject("proj-1");
    expect(summaries).toHaveLength(5);
    // Newest-first; the three oldest (fp-0..fp-2) are pruned.
    expect(summaries.map((s) => s.fingerprint)).toEqual([
      "fp-7",
      "fp-6",
      "fp-5",
      "fp-4",
      "fp-3"
    ]);
  });

  it("skips an add whose fingerprint matches the newest snapshot", async () => {
    const { repoModule } = await freshModules();
    const repo = new repoModule.IndexedDbProjectSnapshotRepository();

    await repo.add(makeRecord("proj-1", { fingerprint: "same" }));
    await repo.add(makeRecord("proj-1", { fingerprint: "same" }));

    const summaries = await repo.listByProject("proj-1");
    expect(summaries).toHaveLength(1);
  });

  it("still records a snapshot when the fingerprint differs from the newest", async () => {
    const { repoModule } = await freshModules();
    const repo = new repoModule.IndexedDbProjectSnapshotRepository();

    await repo.add(makeRecord("proj-1", { createdAt: "2026-07-19T00:00:00.000Z", fingerprint: "a" }));
    await repo.add(makeRecord("proj-1", { createdAt: "2026-07-19T00:01:00.000Z", fingerprint: "b" }));
    await repo.add(makeRecord("proj-1", { createdAt: "2026-07-19T00:02:00.000Z", fingerprint: "a" }));

    const summaries = await repo.listByProject("proj-1");
    expect(summaries.map((s) => s.fingerprint)).toEqual(["a", "b", "a"]);
  });

  it("returns metadata newest-first", async () => {
    const { repoModule } = await freshModules();
    const repo = new repoModule.IndexedDbProjectSnapshotRepository();

    await repo.add(makeRecord("proj-1", { createdAt: "2026-07-19T00:00:00.000Z", fingerprint: "old" }));
    await repo.add(makeRecord("proj-1", { createdAt: "2026-07-19T00:05:00.000Z", fingerprint: "new" }));

    const summaries = await repo.listByProject("proj-1");
    expect(summaries[0].fingerprint).toBe("new");
    expect(summaries[1].fingerprint).toBe("old");

    const record = await repo.get(summaries[0].key);
    expect(record?.fingerprint).toBe("new");
  });

  it("deleteByProject removes only that project's snapshots (range bounds)", async () => {
    const { repoModule } = await freshModules();
    const repo = new repoModule.IndexedDbProjectSnapshotRepository();

    await repo.add(makeRecord("proj-1", { fingerprint: "one" }));
    await repo.add(makeRecord("proj-2", { fingerprint: "two" }));

    await repo.deleteByProject("proj-1");

    expect(await repo.listByProject("proj-1")).toHaveLength(0);
    expect(await repo.listByProject("proj-2")).toHaveLength(1);
  });
});

describe("database v3 → v4 upgrade", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the projectSnapshots store idempotently, preserving existing data", async () => {
    const factory = new IDBFactory();
    vi.resetModules();
    vi.stubGlobal("indexedDB", factory);
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);

    const { PROJECT_STORE, PROJECT_SNAPSHOT_STORE } = await import("./database");

    // Stand up a v3 database (no projectSnapshots store) with one project row.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("sightlines", 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        db.createObjectStore("artworks", { keyPath: "id" });
        db.createObjectStore("assets", { keyPath: "id" });
        db.createObjectStore("assetBlobs");
        db.createObjectStore("savedViewThumbnails");
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(PROJECT_STORE, "readwrite");
        tx.objectStore(PROJECT_STORE).put({ id: "keep-me" });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    // openDatabase() opens at v4 and runs the incremental upgrade.
    const { openDatabase } = await import("./database");
    const db = await openDatabase();
    expect(db.objectStoreNames.contains(PROJECT_SNAPSHOT_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(PROJECT_STORE)).toBe(true);

    // Existing project data survives the upgrade.
    const kept = await new Promise((resolve, reject) => {
      const req = db
        .transaction(PROJECT_STORE, "readonly")
        .objectStore(PROJECT_STORE)
        .get("keep-me");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(kept).toEqual({ id: "keep-me" });

    // Reopening at the same version is a no-op — the contains-check makes the
    // upgrade idempotent.
    const again = await openDatabase();
    expect(again.objectStoreNames.contains(PROJECT_SNAPSHOT_STORE)).toBe(true);
  });
});
