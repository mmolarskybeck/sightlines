import { useEffect, useRef, useState } from "react";
import { assetBlobKey, type AssetBlobTier } from "../../domain/repositories/assetRepository";

// Owns object-URL creation and revocation for a batch of asset blobs. Failed
// fetches remain unresolved so callers can render placeholders.
export function useAssetImageUrls(
  assetIds: (string | undefined)[],
  getBlob: (key: string) => Promise<Blob>,
  tier: AssetBlobTier = "thumbnail"
): Map<string, string> {
  const [urlsByAssetId, setUrlsByAssetId] = useState<Map<string, string>>(
    () => new Map()
  );

  // Read the latest cache without making each resolution rerun the effect.
  const urlsRef = useRef(urlsByAssetId);
  urlsRef.current = urlsByAssetId;

  // A tier change invalidates the entire cache.
  const tierRef = useRef(tier);

  const assetIdsKey = JSON.stringify(assetIds);

  useEffect(() => {
    // Superseded fetches must neither create unowned URLs nor update state.
    let cancelled = false;
    const wanted = new Set(assetIds.filter((id): id is string => Boolean(id)));
    const tierChanged = tierRef.current !== tier;
    tierRef.current = tier;

    // Revoke removed ids and stale tiers immediately.
    setUrlsByAssetId((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [assetId, url] of current) {
        if (tierChanged || !wanted.has(assetId)) {
          URL.revokeObjectURL(url);
          next.delete(assetId);
          changed = true;
        }
      }
      return changed ? next : current;
    });

    for (const assetId of wanted) {
      if (!tierChanged && urlsRef.current.has(assetId)) continue;

      getBlob(assetBlobKey(assetId, tier))
        .then((blob) => {
          if (cancelled) return;

          const url = URL.createObjectURL(blob);
          setUrlsByAssetId((current) => {
            if (current.has(assetId)) {
              // Keep the first resolution and revoke the duplicate URL.
              URL.revokeObjectURL(url);
              return current;
            }

            const next = new Map(current);
            next.set(assetId, url);
            return next;
          });
        })
        .catch(() => {
          // Missing blobs render as placeholders.
        });
    }

    return () => {
      cancelled = true;
    };
    // Compare ids by value so fresh equivalent arrays do not refetch.
  }, [assetIdsKey, getBlob, tier]);

  // Revoke all remaining URLs on unmount.
  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return urlsByAssetId;
}
