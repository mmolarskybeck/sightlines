// A stable content fingerprint over everything a backup would capture: the
// project document, the artwork records it references, and the asset ids those
// artworks point at. `project.updatedAt` alone is not enough — an artwork-only
// edit (mat/frame, title) changes the package without touching the project — so
// the fingerprint hashes the referenced artwork records too.
//
// Pure and dependency-free (no crypto.subtle) so it stays synchronous and
// trivially testable: a lightweight FNV-1a hash over a canonical JSON
// serialization with object keys sorted, so key order never changes the result.

import type { Artwork, Project } from "../project";

export type BackupFingerprintInput = {
  project: Project;
  // Only the referenced library records — collect via selectReferencedArtworks.
  artworks: Artwork[];
  // Asset ids referenced by those artworks — collect via collectReferencedAssetIds.
  assetIds: string[];
};

// Referenced asset ids, deduped and sorted so the same set always serializes
// identically. selectReferencedArtworkIds already lives in buildPackage.ts; this
// is the asset-side companion (buildPackage inlines its own copy for zip dedupe).
export function collectReferencedAssetIds(artworks: Artwork[]): string[] {
  const ids = new Set<string>();
  for (const artwork of artworks) {
    if (artwork.assetId) ids.add(artwork.assetId);
  }
  return [...ids].sort();
}

// Recursively emit JSON with object keys in sorted order. Arrays keep their
// order (position is meaningful in the project document); only object key order
// is normalized.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

// FNV-1a, 32-bit. Cheap, synchronous, and good enough to distinguish document
// versions for dedupe/dirty checks (this is not a security primitive).
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // `Math.imul` keeps the multiply in 32-bit space.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function computeBackupFingerprint(input: BackupFingerprintInput): string {
  // Sort artworks by id so library ordering never shifts the fingerprint, and
  // pass the pre-deduped/sorted asset ids alongside.
  const artworks = [...input.artworks].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = canonicalize({
    project: input.project,
    artworks,
    assetIds: [...input.assetIds].sort()
  });
  return fnv1a(JSON.stringify(canonical)).toString(36);
}
