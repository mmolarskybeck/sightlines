import {
  PROJECT_SNAPSHOT_STORE,
  openDatabase,
  requestToPromise,
  transactionDone
} from "./database";
import {
  projectSnapshotKey,
  SNAPSHOTS_PER_PROJECT,
  type ProjectSnapshotRecord,
  type ProjectSnapshotRepository,
  type ProjectSnapshotSummary
} from "./projectSnapshotRepository";

// The prefix that bounds one project's snapshot keys. '￿' is the ceiling of the
// prefix; the ':' separator sorts below all id characters and ids are
// fixed-length, so no other project's keys fall inside this range (same trick as
// indexedDbSavedViewThumbnailRepository.deleteByProject).
function projectKeyRange(projectId: string): IDBKeyRange {
  const prefix = `${projectId}:`;
  return IDBKeyRange.bound(prefix, `${prefix}￿`);
}

export class IndexedDbProjectSnapshotRepository implements ProjectSnapshotRepository {
  async add(record: ProjectSnapshotRecord): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(PROJECT_SNAPSHOT_STORE, "readwrite");
    const store = tx.objectStore(PROJECT_SNAPSHOT_STORE);
    const range = projectKeyRange(record.projectId);

    // Keys are sorted ascending by createdAt within the project prefix, so the
    // last one is the newest snapshot.
    const existingKeys = await requestToPromise<IDBValidKey[]>(store.getAllKeys(range));

    if (existingKeys.length > 0) {
      const newestKey = existingKeys[existingKeys.length - 1];
      const newest = await requestToPromise<ProjectSnapshotRecord | undefined>(
        store.get(newestKey)
      );
      // Distinct-version retention: an identical copy would only flush older,
      // meaningful history, so skip it entirely.
      if (newest?.fingerprint === record.fingerprint) {
        await transactionDone(tx);
        return;
      }
    }

    const newKey = projectSnapshotKey(record.projectId, record.createdAt);
    store.put(record, newKey);

    // Prune oldest beyond the cap. The new key carries the current timestamp, so
    // it sorts at/after every existing key — appending it keeps the range sorted.
    const allKeys = [...existingKeys, newKey];
    const excess = allKeys.length - SNAPSHOTS_PER_PROJECT;
    for (let i = 0; i < excess; i += 1) {
      store.delete(allKeys[i]);
    }

    await transactionDone(tx);
  }

  async listByProject(projectId: string): Promise<ProjectSnapshotSummary[]> {
    const db = await openDatabase();
    const tx = db.transaction(PROJECT_SNAPSHOT_STORE, "readonly");
    const store = tx.objectStore(PROJECT_SNAPSHOT_STORE);
    const range = projectKeyRange(projectId);

    const [keys, records] = await Promise.all([
      requestToPromise<IDBValidKey[]>(store.getAllKeys(range)),
      requestToPromise<ProjectSnapshotRecord[]>(store.getAll(range))
    ]);

    // getAll returns records in the same ascending key order as getAllKeys, so
    // the two arrays line up. Reverse for newest-first.
    return records
      .map((record, index) => ({
        key: String(keys[index]),
        createdAt: record.createdAt,
        projectTitle: record.projectTitle,
        fingerprint: record.fingerprint
      }))
      .reverse();
  }

  async get(key: string): Promise<ProjectSnapshotRecord | undefined> {
    const db = await openDatabase();
    return requestToPromise<ProjectSnapshotRecord | undefined>(
      db
        .transaction(PROJECT_SNAPSHOT_STORE, "readonly")
        .objectStore(PROJECT_SNAPSHOT_STORE)
        .get(key)
    );
  }

  async deleteByProject(projectId: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(PROJECT_SNAPSHOT_STORE, "readwrite");
    tx.objectStore(PROJECT_SNAPSHOT_STORE).delete(projectKeyRange(projectId));
    await transactionDone(tx);
  }
}
