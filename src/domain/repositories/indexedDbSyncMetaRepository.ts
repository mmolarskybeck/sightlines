import {
  SYNC_META_STORE,
  openDatabase,
  requestToPromise,
  transactionDone
} from "./database";
import {
  parseProjectSyncMeta,
  type ProjectSyncMeta,
  type SyncMetaRepository
} from "./syncMetaRepository";

export class IndexedDbSyncMetaRepository implements SyncMetaRepository {
  async get(projectId: string): Promise<ProjectSyncMeta | undefined> {
    const db = await openDatabase();
    const stored = await requestToPromise<unknown>(
      db.transaction(SYNC_META_STORE, "readonly").objectStore(SYNC_META_STORE).get(projectId)
    );
    return parseProjectSyncMeta(stored);
  }

  async put(record: ProjectSyncMeta): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(SYNC_META_STORE, "readwrite");
    // In-line keys: the store's keyPath is "projectId", so the record IS the
    // key — one row per project, and a re-link overwrites rather than accretes.
    tx.objectStore(SYNC_META_STORE).put(record);
    await transactionDone(tx);
  }

  async delete(projectId: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(SYNC_META_STORE, "readwrite");
    tx.objectStore(SYNC_META_STORE).delete(projectId);
    await transactionDone(tx);
  }

  async list(): Promise<ProjectSyncMeta[]> {
    const db = await openDatabase();
    const stored = await requestToPromise<unknown[]>(
      db.transaction(SYNC_META_STORE, "readonly").objectStore(SYNC_META_STORE).getAll()
    );
    // A single malformed row must not blind the caller to every other linked
    // project, so unreadable rows drop out of the listing rather than throwing.
    return stored
      .map((value) => parseProjectSyncMeta(value))
      .filter((record): record is ProjectSyncMeta => record !== undefined);
  }
}
