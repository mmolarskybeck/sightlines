import { migrateArtwork, parseArtwork } from "../schema/artworkSchema";
import type { Artwork } from "../project";
import type { ArtworkLibraryRepository } from "./artworkLibraryRepository";
import { ARTWORK_STORE, openDatabase, requestToPromise, transactionDone } from "./database";

export class IndexedDbArtworkLibraryRepository implements ArtworkLibraryRepository {
  async list(): Promise<Artwork[]> {
    const db = await openDatabase();
    const values = await requestToPromise<unknown[]>(
      db.transaction(ARTWORK_STORE, "readonly").objectStore(ARTWORK_STORE).getAll()
    );

    // One corrupt record can't take down the whole library list (docs/plan.md
    // §8) — skip it and warn rather than throwing wholesale.
    return values.flatMap((value) => {
      try {
        return [migrateArtwork(value)];
      } catch (error) {
        console.warn("Skipping unreadable artwork record in list()", value, error);
        return [];
      }
    });
  }

  async get(id: string): Promise<Artwork> {
    const db = await openDatabase();
    const value = await requestToPromise<unknown>(
      db.transaction(ARTWORK_STORE, "readonly").objectStore(ARTWORK_STORE).get(id)
    );

    if (!value) {
      throw new Error(`Artwork not found: ${id}`);
    }

    return migrateArtwork(value);
  }

  async save(artwork: Artwork): Promise<void> {
    // Never persist a document that fails the current schema — invalid state
    // written here would poison every future load.
    parseArtwork(artwork);

    const db = await openDatabase();
    const tx = db.transaction(ARTWORK_STORE, "readwrite");
    tx.objectStore(ARTWORK_STORE).put(artwork);
    await transactionDone(tx);
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(ARTWORK_STORE, "readwrite");
    tx.objectStore(ARTWORK_STORE).delete(id);
    await transactionDone(tx);
  }
}
