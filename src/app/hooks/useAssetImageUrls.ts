import { useEffect, useRef, useState } from "react";
import { assetBlobKey, type AssetBlobTier } from "../../domain/repositories/assetRepository";

// Resolves a batch of asset ids to object URLs at a given tier (defaults to
// thumbnail, for list rows like the checklist that need a small preview
// without paying for the display/original tiers; elevation placement passes
// "display" — see docs/plan.md §4.5). Object URLs are a scarce browser
// resource — each one pins its Blob in memory until revoked — so this hook
// owns the whole lifecycle: fetch once per id, reuse the same URL across
// re-renders, and revoke the moment an id is no longer wanted (removed from
// the list, the tier changes, or the hook unmounts). A failed fetch just
// leaves that id unresolved rather than throwing, so a bad thumbnail never
// breaks the row around it — callers fall back to a placeholder for any id
// missing from the returned map.
export function useAssetImageUrls(
  assetIds: (string | undefined)[],
  getBlob: (key: string) => Promise<Blob>,
  tier: AssetBlobTier = "thumbnail"
): Map<string, string> {
  const [urlsByAssetId, setUrlsByAssetId] = useState<Map<string, string>>(
    () => new Map()
  );

  // Effects only see the map from their own render's closure; this ref lets
  // the fetch loop below check "already cached" against the latest map
  // without adding it as an effect dependency (which would refetch on every
  // resolution).
  const urlsRef = useRef(urlsByAssetId);
  urlsRef.current = urlsByAssetId;

  // Every cached URL was fetched at whatever tier was active when this ref
  // was last updated — if `tier` changes between renders, the whole cache is
  // stale even for ids that are still wanted, not just ids that dropped out.
  const tierRef = useRef(tier);

  const assetIdsKey = JSON.stringify(assetIds);

  useEffect(() => {
    // Guards both branches below: a `.then`/`.catch` that fires after this
    // effect has been superseded (id list changed, or the hook unmounted)
    // must not create an object URL that nothing will ever revoke, and must
    // not call setState on a stale render.
    let cancelled = false;
    const wanted = new Set(assetIds.filter((id): id is string => Boolean(id)));
    const tierChanged = tierRef.current !== tier;
    tierRef.current = tier;

    // Drop and revoke anything cached that's no longer in the list, or that
    // was fetched at a now-stale tier.
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
              // Resolved twice for the same id (e.g. an effect re-run while
              // the first fetch was still in flight) — keep the earlier URL
              // and don't leak this duplicate.
              URL.revokeObjectURL(url);
              return current;
            }

            const next = new Map(current);
            next.set(assetId, url);
            return next;
          });
        })
        .catch(() => {
          // Ignore fetch failures — the row just shows its placeholder.
        });
    }

    return () => {
      cancelled = true;
    };
    // assetIdsKey (a JSON-stringified snapshot of assetIds) is the intentional
    // dependency here rather than assetIds itself, so a caller passing a
    // fresh array of the same ids on every render doesn't retrigger this
    // effect. `tier` is a real dependency: a caller flipping tiers at
    // runtime must refetch, which is exactly what the tierChanged branch
    // above handles.
  }, [assetIdsKey, getBlob, tier]);

  // Final cleanup: revoke everything still cached when the hook itself goes
  // away, independent of the per-id revocation above.
  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return urlsByAssetId;
}
