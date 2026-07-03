// Shared IndexedDB plumbing for every local repository. One database, one
// version number, one upgrade path — repositories import from here instead
// of each opening their own connection, so a schema bump only has to happen
// in one place.

export const DB_NAME = "sightlines";
export const DB_VERSION = 2;

export const PROJECT_STORE = "projects";
export const ARTWORK_STORE = "artworks";
export const ASSET_STORE = "assets";
// Out-of-line keys: blobs are stored under string keys like
// `${assetId}:thumbnail` (see assetRepository.ts's assetBlobKey), not under
// a keyPath on the blob itself.
export const ASSET_BLOB_STORE = "assetBlobs";

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Contains-checks let a v1 database (projects store only) upgrade
      // cleanly to v2 without touching existing data.
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(ARTWORK_STORE)) {
        db.createObjectStore(ARTWORK_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(ASSET_BLOB_STORE)) {
        db.createObjectStore(ASSET_BLOB_STORE);
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}
