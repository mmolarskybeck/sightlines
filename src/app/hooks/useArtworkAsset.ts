import { useEffect, useMemo, useState } from "react";
import type { Asset } from "../../domain/project";
import { IndexedDbAssetRepository } from "../../domain/repositories/indexedDbAssetRepository";
import { useAssetImageUrls } from "./useAssetImageUrls";

// Read-only asset access for the inspector, which needs the selected artwork's
// Asset record (its widthPx/heightPx drive aspect-ratio auto-fill) and a
// thumbnail to sit beside the metadata. Mirrors App.tsx's own rationale for a
// dedicated read-side IndexedDbAssetRepository: the repository is a stateless
// wrapper around IndexedDB, not something that needs a single shared instance,
// so a second instance here avoids threading getBlob/asset props through App
// for one panel. A failed load just leaves the asset undefined (no ratio, no
// thumbnail) rather than throwing.
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

    // Guards a late resolution after the selection changed out from under us
    // (a different artwork, or none) so we never show a stale record.
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

  // Stable array identity so useAssetImageUrls' effect doesn't refetch on
  // every render (it keys off a JSON snapshot, but a fresh [] each render still
  // churns state updates).
  const assetIds = useMemo(() => (assetId ? [assetId] : []), [assetId]);
  const urls = useAssetImageUrls(assetIds, getBlob, "thumbnail");

  return {
    asset,
    thumbnailUrl: assetId ? urls.get(assetId) : undefined
  };
}
