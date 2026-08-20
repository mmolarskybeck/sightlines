import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNC_PROTOCOL_VERSION,
  type ProjectSyncMeta
} from "./syncMetaRepository";

// Each test gets a brand-new in-memory database and a fresh module cache, so the
// openDatabase() connection singleton doesn't leak across tests.
async function freshModules() {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const repoModule = await import("./indexedDbSyncMetaRepository");
  const dbModule = await import("./database");
  return { repoModule, dbModule };
}

function makeMeta(
  projectId: string,
  overrides: Partial<ProjectSyncMeta> = {}
): ProjectSyncMeta {
  return {
    projectId,
    provider: "dropbox",
    accountId: "dbid:AAA-account",
    remotePath: `/projects/${projectId}/current.sightlines`,
    lastAcceptedRev: "rev-1",
    fingerprintAtRev: "fp-1",
    lastPullAtIso: null,
    lastPushAtIso: "2026-08-19T10:00:00.000Z",
    protocolVersion: SYNC_PROTOCOL_VERSION,
    paused: false,
    ...overrides
  };
}

describe("IndexedDbSyncMetaRepository", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a record and answers undefined for an unlinked project", async () => {
    const { repoModule } = await freshModules();
    const repo = new repoModule.IndexedDbSyncMetaRepository();

    await repo.put(makeMeta("proj-1"));

    expect(await repo.get("proj-1")).toEqual(makeMeta("proj-1"));
    expect(await repo.get("proj-2")).toBeUndefined();
  });

  it("keeps one record per project, so a re-link replaces the old base", async () => {
    const { repoModule } = await freshModules();
    const repo = new repoModule.IndexedDbSyncMetaRepository();

    await repo.put(makeMeta("proj-1", { lastAcceptedRev: "rev-1" }));
    await repo.put(makeMeta("proj-1", { lastAcceptedRev: "rev-2", paused: true }));

    expect(await repo.list()).toHaveLength(1);
    expect(await repo.get("proj-1")).toMatchObject({
      lastAcceptedRev: "rev-2",
      paused: true
    });
  });

  it("lists every linked project and deletes only the named one", async () => {
    const { repoModule } = await freshModules();
    const repo = new repoModule.IndexedDbSyncMetaRepository();

    await repo.put(makeMeta("proj-1"));
    await repo.put(makeMeta("proj-2"));
    await repo.delete("proj-1");

    const linked = await repo.list();
    expect(linked.map((record) => record.projectId)).toEqual(["proj-2"]);
    expect(await repo.get("proj-1")).toBeUndefined();
    // Deleting an unlinked project is a no-op, not a failure.
    await expect(repo.delete("proj-3")).resolves.toBeUndefined();
  });

  // A record missing a field the state machine depends on cannot be repaired by
  // guessing: reading it as "linked at rev ???" would push blind over another
  // device's work, so it reads as not-linked instead.
  it("treats a malformed stored record as absent, in get and in list", async () => {
    const { repoModule, dbModule } = await freshModules();
    const repo = new repoModule.IndexedDbSyncMetaRepository();
    await repo.put(makeMeta("good"));

    const db = await dbModule.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(dbModule.SYNC_META_STORE, "readwrite");
      const store = tx.objectStore(dbModule.SYNC_META_STORE);
      store.put({ projectId: "no-rev", provider: "dropbox", accountId: "dbid:A" });
      store.put({ ...makeMeta("future"), protocolVersion: 99 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    expect(await repo.get("no-rev")).toBeUndefined();
    // A record written by a newer protocol is not reinterpreted either.
    expect(await repo.get("future")).toBeUndefined();
    // One bad row must not blind the caller to the good ones.
    expect((await repo.list()).map((record) => record.projectId)).toEqual(["good"]);
  });
});

describe("database v4 → v5 upgrade", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the syncMeta store idempotently, preserving existing data", async () => {
    const factory = new IDBFactory();
    vi.resetModules();
    vi.stubGlobal("indexedDB", factory);
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);

    const { PROJECT_STORE, PROJECT_SNAPSHOT_STORE, SYNC_META_STORE } = await import(
      "./database"
    );

    // Stand up a v4 database (no syncMeta store) with one project row.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("sightlines", 4);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        db.createObjectStore("artworks", { keyPath: "id" });
        db.createObjectStore("assets", { keyPath: "id" });
        db.createObjectStore("assetBlobs");
        db.createObjectStore("savedViewThumbnails");
        db.createObjectStore(PROJECT_SNAPSHOT_STORE);
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

    // openDatabase() opens at v5 and runs the incremental upgrade.
    const { openDatabase } = await import("./database");
    const db = await openDatabase();
    expect(db.objectStoreNames.contains(SYNC_META_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(PROJECT_SNAPSHOT_STORE)).toBe(true);

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
    expect(again.objectStoreNames.contains(SYNC_META_STORE)).toBe(true);
  });
});
