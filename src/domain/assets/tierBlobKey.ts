import type { Asset } from "../project";
import type { AssetTier } from "../schema/packageSchema";

export function tierBlobKey(asset: Asset, tier: AssetTier): string {
  switch (tier) {
    case "original":
      return asset.originalKey;
    case "display":
      return asset.displayKey;
    case "thumbnail":
      return asset.thumbnailKey;
  }
}
