import type { Asset } from "../project";

export type AssetBlobTier = "original" | "display" | "thumbnail";

// The Asset record's originalKey/displayKey/thumbnailKey fields (docs/plan.md
// §4.5) hold exactly the keys this produces — one place defines the naming
// convention rather than each caller string-templating it independently.
export function assetBlobKey(assetId: string, tier: AssetBlobTier): string {
  return `${assetId}:${tier}`;
}

// A missing asset RECORD is a distinct, deterministic condition (a dangling
// assetId left by an old deletion bug or a metadata-only import), unlike an
// operational read failure. Callers that must fail closed on storage errors
// can still tolerate this one.
export class AssetNotFoundError extends Error {
  constructor(id: string) {
    super(`Asset not found: ${id}`);
    this.name = "AssetNotFoundError";
  }
}

export interface AssetRepository {
  saveAsset(
    asset: Asset,
    blobs: { original: Blob; display: Blob; thumbnail: Blob }
  ): Promise<void>;
  getAsset(id: string): Promise<Asset>;
  getBlob(key: string): Promise<Blob>;
  delete(id: string): Promise<void>;
}
