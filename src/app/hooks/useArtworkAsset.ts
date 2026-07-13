import { useEffect, useMemo, useState } from "react";
import type { Asset } from "../../domain/project";
import { IndexedDbAssetRepository } from "../../domain/repositories/indexedDbAssetRepository";
import { useAssetImageUrls } from "./useAssetImageUrls";

// Read-only inspector access. Missing assets degrade to no ratio or thumbnail.
const assetRepository = new IndexedDbAssetRepository();
function getBlob(key: string): Promise<Blob> {
  return assetRepository.getBlob(key);
}

export function useArtworkAsset(assetId: string | undefined): {
  asset: Asset | undefined;
  thumbnailUrl: string | undefined;
} {
  const [asset, setAsset] = useState<Asset | undefined>(undefined);

  useEffect(() => {
    if (!assetId) {
      setAsset(undefined);
      return;
    }

    // Ignore loads completed after the selection changes.
    let cancelled = false;
    assetRepository
      .getAsset(assetId)
      .then((loaded) => {
        if (!cancelled) setAsset(loaded);
      })
      .catch(() => {
        if (!cancelled) setAsset(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  // Stable identity avoids unnecessary URL-state updates.
  const assetIds = useMemo(() => (assetId ? [assetId] : []), [assetId]);
  const urls = useAssetImageUrls(assetIds, getBlob, "thumbnail");

  return {
    asset,
    thumbnailUrl: assetId ? urls.get(assetId) : undefined
  };
}
