import type { Artwork, Asset, Project } from "../project";
import { sha256Hex } from "../assets/sha256";
import {
  PACKAGE_SCHEMA_VERSION,
  parseSightlinesPackage,
  type AssetTier,
  type PackageAssetEntry,
  type PackageAssetTierEntry,
  type PackageExportMode,
  type SightlinesPackage
} from "../schema/packageSchema";
import { writeSightlinesZip } from "./zipPackage";

// Fixed zip entry point; image blobs live under assets/.
export const MANIFEST_PATH = "manifest.json";

// Store compressed images as-is; deflate the JSON manifest.
export type ZipCompression = "store" | "deflate";

export type PackageZipFile = {
  path: string;
  bytes: Uint8Array;
  compression: ZipCompression;
};

export type BuiltPackage = {
  manifest: SightlinesPackage;
  files: PackageZipFile[];
  warnings: string[];
};

export type BuildPackageInput = {
  project: Project;
  // Only referenced library records are included.
  libraryArtworks: Artwork[];
  mode: PackageExportMode;
  // Repository seams keep package derivation browser-independent.
  getAsset: (assetId: string) => Promise<Asset>;
  getBlob: (key: string) => Promise<Blob>;
  // Injectable for deterministic output.
  exportedAt?: string;
};

// Which blob tiers ship in the zip for each mode (docs/plan.md §4.5).
export function tiersForMode(mode: PackageExportMode): AssetTier[] {
  switch (mode) {
    case "originals":
      // Archival mode includes every tier.
      return ["original", "display", "thumbnail"];
    case "display":
      // Default mode includes rendered tiers.
      return ["display", "thumbnail"];
    case "metadata-only":
      return [];
  }
}

// Export the deduplicated union of checklist and placed artworks.
export function selectReferencedArtworkIds(project: Project): Set<string> {
  const ids = new Set<string>(project.checklistArtworkIds);
  for (const object of project.wallObjects) {
    if (object.kind === "artwork") ids.add(object.artworkId);
  }
  for (const object of project.floorObjects) {
    if (object.kind === "artwork") ids.add(object.artworkId);
  }
  return ids;
}

export function selectReferencedArtworks(
  project: Project,
  libraryArtworks: Artwork[]
): Artwork[] {
  const ids = selectReferencedArtworkIds(project);
  return libraryArtworks.filter((artwork) => ids.has(artwork.id));
}

function tierBlobKey(asset: Asset, tier: AssetTier): string {
  switch (tier) {
    case "original":
      return asset.originalKey;
    case "display":
      return asset.displayKey;
    case "thumbnail":
      return asset.thumbnailKey;
  }
}

// Originals retain their type; derivative fallback is WebP.
function fallbackMimeForTier(asset: Asset, tier: AssetTier): string {
  return tier === "original" ? asset.mimeType : "image/webp";
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/webp":
      return "webp";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

async function toBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// Copy views into a contiguous buffer before hashing; import reuses this integrity check.
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return sha256Hex(copy.buffer);
}

// Missing asset data degrades per tier; artwork metadata still exports.
export async function buildSightlinesPackage(input: BuildPackageInput): Promise<BuiltPackage> {
  const { project, libraryArtworks, mode, getAsset, getBlob } = input;
  const exportedAt = input.exportedAt ?? new Date().toISOString();

  const artworks = selectReferencedArtworks(project, libraryArtworks);
  const missingArtworkIds = [...selectReferencedArtworkIds(project)].filter(
    (id) => !artworks.some((artwork) => artwork.id === id)
  );
  if (missingArtworkIds.length > 0) {
    throw new Error(
      `the project references artwork records that are missing from the library (${missingArtworkIds.join(", ")}).`
    );
  }
  const tiers = tiersForMode(mode);
  const warnings: string[] = [];

  // Unique asset ids referenced by the exported artworks.
  const assetIds: string[] = [];
  const seenAssetIds = new Set<string>();
  for (const artwork of artworks) {
    if (artwork.assetId && !seenAssetIds.has(artwork.assetId)) {
      seenAssetIds.add(artwork.assetId);
      assetIds.push(artwork.assetId);
    }
  }

  // Content-addressed dedupe: identical bytes across tiers/assets share one file.
  const filesByHash = new Map<string, PackageZipFile>();
  const assetEntries: PackageAssetEntry[] = [];

  for (const assetId of assetIds) {
    let asset: Asset;
    try {
      asset = await getAsset(assetId);
    } catch {
      // Preserve artwork metadata when its asset record is missing.
      warnings.push(`${assetId}: its asset record is missing; exported without an image.`);
      continue;
    }

    const tierEntries: PackageAssetTierEntry[] = [];
    for (const tier of tiers) {
      let bytes: Uint8Array;
      let blobType = "";
      try {
        const blob = await getBlob(tierBlobKey(asset, tier));
        blobType = blob.type;
        bytes = await toBytes(blob);
      } catch {
        // Missing tier blob — skip just this tier.
        warnings.push(`${asset.originalFilename ?? asset.id}: its ${tier} image is missing.`);
        continue;
      }
      const sha256 = await hashBytes(bytes);
      const mimeType = blobType || fallbackMimeForTier(asset, tier);
      const path = `assets/${sha256}.${extensionForMime(mimeType)}`;
      if (!filesByHash.has(sha256)) {
        filesByHash.set(sha256, { path, bytes, compression: "store" });
      }
      tierEntries.push({
        tier,
        path: filesByHash.get(sha256)!.path,
        sha256,
        byteSize: bytes.byteLength,
        mimeType
      });
    }

    const originalTierHash = tierEntries.find((entry) => entry.tier === "original")?.sha256;
    const originalContentHash = originalTierHash ?? asset.sha256;
    assetEntries.push({
      assetId: asset.id,
      mimeType: asset.mimeType,
      ...(asset.originalFilename ? { originalFilename: asset.originalFilename } : {}),
      ...(asset.widthPx !== undefined ? { widthPx: asset.widthPx } : {}),
      ...(asset.heightPx !== undefined ? { heightPx: asset.heightPx } : {}),
      ...(asset.byteSize !== undefined ? { byteSize: asset.byteSize } : {}),
      // Original content hash — the re-link anchor that survives metadata-only.
      ...(originalContentHash ? { sha256: originalContentHash } : {}),
      tiers: tierEntries
    });
  }

  const manifest: SightlinesPackage = {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    exportedAt,
    mode,
    project,
    artworks,
    assets: assetEntries
  };

  // Validate and normalize the manifest before writing it.
  parseSightlinesPackage(manifest);

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const files: PackageZipFile[] = [
    { path: MANIFEST_PATH, bytes: manifestBytes, compression: "deflate" },
    ...filesByHash.values()
  ];

  return { manifest, files, warnings };
}

export type CreatedPackage = {
  manifest: SightlinesPackage;
  zip: Uint8Array;
  warnings: string[];
};

// Build the manifest and file list, then zip them.
export async function createSightlinesPackage(
  input: BuildPackageInput
): Promise<CreatedPackage> {
  const built = await buildSightlinesPackage(input);
  const zip = await writeSightlinesZip(built.files);
  return { manifest: built.manifest, zip, warnings: built.warnings };
}

// `<project-name>.sightlines`, ascii-slugged like the existing JSON export.
export function packageFilename(project: Project): string {
  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "project"}.sightlines`;
}
