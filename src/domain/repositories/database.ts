// Shared IndexedDB plumbing for every local repository. One database, one
// version number, one upgrade path — repositories import from here instead
// of each opening their own connection, so a schema bump only has to happen
// in one place.

export const DB_NAME = "sightlines";
export const DB_VERSION = 3;

export const PROJECT_STORE = "projects";
export const ARTWORK_STORE = "artworks";
export const ASSET_STORE = "assets";
// Out-of-line keys: blobs are stored under string keys like
// `${assetId}:thumbnail` (see assetRepository.ts's assetBlobKey), not under
// a keyPath on the blob itself.
export const ASSET_BLOB_STORE = "assetBlobs";
// Derived cache of rendered Saved-view previews (saved-views spec §3.2). Keyed
// out-of-line by `${projectId}:${viewId}` (see savedViewThumbnailRepository.ts),
// value `{ blob, projectUpdatedAt }`. Lives outside project persistence — never
// in project JSON, undo history, or `.sightlines` packages.
export const SAVED_VIEW_THUMBNAIL_STORE = "savedViewThumbnails";

let databasePromise: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }

  const openingPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;

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

      // v2 → v3: the Saved-view thumbnail cache. Out-of-line string keys, same
      // as ASSET_BLOB_STORE.
      if (!db.objectStoreNames.contains(SAVED_VIEW_THUMBNAIL_STORE)) {
        db.createObjectStore(SAVED_VIEW_THUMBNAIL_STORE);
      }
    };

    request.onblocked = () => {
      blocked = true;
      reject(
        new Error(
          "Sightlines storage could not be upgraded because it is open in another tab. Close other Sightlines tabs, then reload this page.",
        ),
      );
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;

      // A blocked request can subsequently succeed after its promise has
      // already rejected. Do not retain that otherwise-unreachable connection.
      if (blocked) {
        db.close();
        return;
      }

      db.onversionchange = () => {
        db.close();
        if (databasePromise === openingPromise) {
          databasePromise = undefined;
        }
      };
      // The browser can also force-close the connection on its own (clearing
      // site data, storage eviction). Drop the cache so the next operation
      // reopens instead of transacting against a dead connection.
      db.onclose = () => {
        if (databasePromise === openingPromise) {
          databasePromise = undefined;
        }
      };
      resolve(db);
    };
  });

  databasePromise = openingPromise;
  openingPromise.catch(() => {
    if (databasePromise === openingPromise) {
      databasePromise = undefined;
    }
  });
  return openingPromise;
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
