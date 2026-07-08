import { useEffect, useState } from "react";

// Sibling of useAssetImageUrls, for raw Files rather than persisted asset
// ids: the import wizard's Map sample and Review thumbnails need a preview
// URL for images the user just dropped in, before any of them are ever
// written to the asset repository. Object URLs are a scarce browser
// resource — each one pins its Blob in memory until revoked — so this hook
// owns the whole lifecycle itself: effect-owned creation (not useMemo, which
// has no cleanup slot and would double-fire under StrictMode and leak)
// rebuilds the whole Map<fileName, objectURL> whenever `imageFiles` changes
// identity, and revokes every URL it made in that same effect's cleanup —
// covering replacement, an external reset() clearing imageFiles to [], and
// unmount alike with one code path.
export function useFileImageUrls(imageFiles: File[]): Map<string, string> {
  const [urlsByFileName, setUrlsByFileName] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    // Keyed by File.name — the same identity imageChoiceByDraftId and
    // resolvedImageFile already match against — so a duplicate filename
    // across two files is last-wins, consistent with how the domain
    // matcher treats duplicate names.
    const next = new Map<string, string>();
    for (const file of imageFiles) {
      next.set(file.name, URL.createObjectURL(file));
    }
    setUrlsByFileName(next);

    return () => {
      for (const url of next.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [imageFiles]);

  return urlsByFileName;
}
