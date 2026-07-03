import { z } from "zod";
import { parseAsset } from "../schema/artworkSchema";
import { CURRENT_ASSET_SCHEMA_VERSION, type Asset } from "../project";
import { assetBlobKey, type AssetRepository } from "./assetRepository";
import {
  ASSET_BLOB_STORE,
  ASSET_STORE,
  openDatabase,
  requestToPromise,
  transactionDone
} from "./database";

const versionedDocumentSchema = z.object({
  schemaVersion: z.number().int().positive()
});

// Asset records are internal, app-generated data (never hand-edited, never
// imported from outside the app the way a Project can be), so a plain parse
// after a versioned-shape check is enough — no migration chain, no need for
// migrateProject's human-readable-error ceremony.
function loadAsset(value: unknown): Asset {
  const versioned = versionedDocumentSchema.safeParse(value);

  if (versioned.success && versioned.data.schemaVersion > CURRENT_ASSET_SCHEMA_VERSION) {
    throw new Error(
      `this asset was made with a newer version of Sightlines (schema version ${versioned.data.schemaVersion}) than this app supports (version ${CURRENT_ASSET_SCHEMA_VERSION}).`
    );
  }

  return parseAsset(value);
}

export class IndexedDbAssetRepository implements AssetRepository {
  async saveAsset(
    asset: Asset,
    blobs: { original: Blob; display: Blob; thumbnail: Blob }
  ): Promise<void> {
    // Never persist a document that fails the current schema — invalid state
    // written here would poison every future load.
    parseAsset(asset);

    const db = await openDatabase();
    const tx = db.transaction([ASSET_STORE, ASSET_BLOB_STORE], "readwrite");
    tx.objectStore(ASSET_STORE).put(asset);
    tx.objectStore(ASSET_BLOB_STORE).put(blobs.original, asset.originalKey);
    tx.objectStore(ASSET_BLOB_STORE).put(blobs.display, asset.displayKey);
    tx.objectStore(ASSET_BLOB_STORE).put(blobs.thumbnail, asset.thumbnailKey);
    await transactionDone(tx);
  }

  async getAsset(id: string): Promise<Asset> {
    const db = await openDatabase();
    const value = await requestToPromise<unknown>(
      db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(id)
    );

    if (!value) {
      throw new Error(`Asset not found: ${id}`);
    }

    return loadAsset(value);
  }

  async getBlob(key: string): Promise<Blob> {
    const db = await openDatabase();
    const blob = await requestToPromise<Blob | undefined>(
      db.transaction(ASSET_BLOB_STORE, "readonly").objectStore(ASSET_BLOB_STORE).get(key)
    );

    if (!blob) {
      throw new Error(`Asset blob not found: ${key}`);
    }

    return blob;
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction([ASSET_STORE, ASSET_BLOB_STORE], "readwrite");
    tx.objectStore(ASSET_STORE).delete(id);
    tx.objectStore(ASSET_BLOB_STORE).delete(assetBlobKey(id, "original"));
    tx.objectStore(ASSET_BLOB_STORE).delete(assetBlobKey(id, "display"));
    tx.objectStore(ASSET_BLOB_STORE).delete(assetBlobKey(id, "thumbnail"));
    await transactionDone(tx);
  }
}
