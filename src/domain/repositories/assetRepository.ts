import type { Asset } from "../project";

export type AssetBlobTier = "original" | "display" | "thumbnail";

// The Asset record's originalKey/displayKey/thumbnailKey fields (docs/plan.md
// §4.5) hold exactly the keys this produces — one place defines the naming
// convention rather than each caller string-templating it independently.
export function assetBlobKey(assetId: string, tier: AssetBlobTier): string {
  return `${assetId}:${tier}`;
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
