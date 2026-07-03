import type { Artwork } from "../project";

export interface ArtworkLibraryRepository {
  list(): Promise<Artwork[]>;
  get(id: string): Promise<Artwork>;
  save(artwork: Artwork): Promise<void>;
  delete(id: string): Promise<void>;
}
