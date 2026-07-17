import {
  SAVED_VIEW_THUMBNAIL_STORE,
  openDatabase,
  requestToPromise,
  transactionDone
} from "./database";
import {
  savedViewThumbnailKey,
  type SavedViewThumbnailRecord,
  type SavedViewThumbnailRepository
} from "./savedViewThumbnailRepository";

export class IndexedDbSavedViewThumbnailRepository
  implements SavedViewThumbnailRepository
{
  async get(
    projectId: string,
    viewId: string
  ): Promise<SavedViewThumbnailRecord | undefined> {
    const db = await openDatabase();
    return requestToPromise<SavedViewThumbnailRecord | undefined>(
      db
        .transaction(SAVED_VIEW_THUMBNAIL_STORE, "readonly")
        .objectStore(SAVED_VIEW_THUMBNAIL_STORE)
        .get(savedViewThumbnailKey(projectId, viewId))
    );
  }

  async put(
    projectId: string,
    viewId: string,
    record: SavedViewThumbnailRecord
  ): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(SAVED_VIEW_THUMBNAIL_STORE, "readwrite");
    tx
      .objectStore(SAVED_VIEW_THUMBNAIL_STORE)
      .put(record, savedViewThumbnailKey(projectId, viewId));
    await transactionDone(tx);
  }

  async deleteByView(projectId: string, viewId: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(SAVED_VIEW_THUMBNAIL_STORE, "readwrite");
    tx
      .objectStore(SAVED_VIEW_THUMBNAIL_STORE)
      .delete(savedViewThumbnailKey(projectId, viewId));
    await transactionDone(tx);
  }

  async deleteByProject(projectId: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(SAVED_VIEW_THUMBNAIL_STORE, "readwrite");
    // Delete every key beginning with `${projectId}:` in one ranged delete.
    // '￿' is the ceiling of the prefix; the ':' separator sorts below all
    // id characters and ids are fixed-length, so no other project's keys fall
    // inside this range.
    const prefix = `${projectId}:`;
    tx
      .objectStore(SAVED_VIEW_THUMBNAIL_STORE)
      .delete(IDBKeyRange.bound(prefix, `${prefix}￿`));
    await transactionDone(tx);
  }
}
