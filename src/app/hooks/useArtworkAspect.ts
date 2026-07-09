import { useEffect, useState } from "react";
import type { PixelAspect } from "../../domain/units/aspectFill";
import { IndexedDbAssetRepository } from "../../domain/repositories/indexedDbAssetRepository";

// The dragged artwork's image aspect, for sizing the checklist drop-ghost at
// the work's true proportions when its dimensions are partial/unknown. Only the
// single currently-dragged asset is loaded — a targeted read, not an assets
// cache. Mirrors useArtworkAsset's rationale for a private stateless repository
// instance (see that file); a failed load just yields undefined (no ratio, the
// placeholder fallback). Unlike useArtworkAsset it skips the thumbnail blob,
// which the ghost never shows.
const assetRepository = new IndexedDbAssetRepository();

export function useArtworkAspect(assetId: string | undefined): PixelAspect | undefined {
  const [aspect, setAspect] = useState<PixelAspect | undefined>(undefined);

  useEffect(() => {
    if (!assetId) {
      setAspect(undefined);
      return;
    }

    // Guards a late resolution after the drag moved to another artwork (or
    // ended) so a stale ratio never sizes the next ghost.
    let cancelled = false;
    assetRepository
      .getAsset(assetId)
      .then((asset) => {
        if (!cancelled) setAspect({ widthPx: asset.widthPx, heightPx: asset.heightPx });
      })
      .catch(() => {
        if (!cancelled) setAspect(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return aspect;
}
