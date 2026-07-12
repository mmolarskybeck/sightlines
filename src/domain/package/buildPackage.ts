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

// manifest.json (not project.sightlines.json): a single, fixed, well-known entry
// point at the zip root is the simplest thing for import to locate — it never
// has to guess a name derived from the project title. Image blobs live under
// assets/. Documented in docs/package-format.md.
export const MANIFEST_PATH = "manifest.json";

// store = no additional compression (already-compressed WebP/JPEG bytes;
// recompressing wastes CPU for no size benefit — docs/plan.md §4.5).
// deflate = real compression, reserved for the JSON manifest.
export type ZipCompression = "store" | "deflate";

export type PackageZipFile = {
  path: string;
  bytes: Uint8Array;
  compression: ZipCompression;
};

export type BuiltPackage = {
  manifest: SightlinesPackage;
  files: PackageZipFile[];
};

export type BuildPackageInput = {
  project: Project;
  // The whole library; only the referenced subset is included (§4.1/§6).
  libraryArtworks: Artwork[];
  mode: PackageExportMode;
  // Async repository seams (docs/plan.md §2) — no browser/canvas access here, so
  // the whole derivation is testable in Node.
  getAsset: (assetId: string) => Promise<Asset>;
  getBlob: (key: string) => Promise<Blob>;
  // Injectable clock keeps the output deterministic under test.
  exportedAt?: string;
};

// Which blob tiers ship in the zip for each mode (docs/plan.md §4.5).
export function tiersForMode(mode: PackageExportMode): AssetTier[] {
  switch (mode) {
    case "originals":
      // Archival: everything, so a re-import never has to regenerate derivatives.
      return ["original", "display", "thumbnail"];
    case "display":
      // Default: what the canvas/3D and most exports actually render.
      return ["display", "thumbnail"];
    case "metadata-only":
      return [];
  }
}

// The artworks a package must carry: checklist membership (§4.1) unioned with
// anything actually placed on a wall or floor, deduped. Never the whole library.
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

// Derivatives are WebP (docs/plan.md §4.5); originals stay as-uploaded. The blob's
// own type is authoritative when present, with these as the fallback.
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

// Hash over a fresh, contiguous ArrayBuffer copy — a Uint8Array read off a Blob
// can be a view into a larger/shared buffer, which sha256Hex's ArrayBuffer
// parameter won't accept directly.
async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return sha256Hex(copy.buffer);
}

// Pure (no DOM/canvas) async derivation: project + library + blob getters in,
// manifest + zip file list out. Graceful degradation on missing local data
// (docs/plan.md §6/§13): a missing asset record drops its inventory entry, a
// missing tier blob drops just that tier — the artwork still exports.
export async function buildSightlinesPackage(input: BuildPackageInput): Promise<BuiltPackage> {
  const { project, libraryArtworks, mode, getAsset, getBlob } = input;
  const exportedAt = input.exportedAt ?? new Date().toISOString();

  const artworks = selectReferencedArtworks(project, libraryArtworks);
  const tiers = tiersForMode(mode);

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
      // Asset record gone locally — the artwork still ships; import degrades to
      // a missing-image warning (docs/plan.md §6).
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

    assetEntries.push({
      assetId: asset.id,
      mimeType: asset.mimeType,
      ...(asset.originalFilename ? { originalFilename: asset.originalFilename } : {}),
      ...(asset.widthPx !== undefined ? { widthPx: asset.widthPx } : {}),
      ...(asset.heightPx !== undefined ? { heightPx: asset.heightPx } : {}),
      ...(asset.byteSize !== undefined ? { byteSize: asset.byteSize } : {}),
      // Original content hash — the re-link anchor that survives metadata-only.
      ...(asset.sha256 ? { sha256: asset.sha256 } : {}),
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

  // Never emit an invalid manifest (docs/plan.md §8). This also normalizes the
  // embedded project/artworks through the same validators the app persists with.
  parseSightlinesPackage(manifest);

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const files: PackageZipFile[] = [
    { path: MANIFEST_PATH, bytes: manifestBytes, compression: "deflate" },
    ...filesByHash.values()
  ];

  return { manifest, files };
}

export type CreatedPackage = {
  manifest: SightlinesPackage;
  zip: Uint8Array;
};

// Facade: build the manifest + file list, then zip it. The UI action calls this
// and triggers the download; everything above stays independently testable.
export async function createSightlinesPackage(
  input: BuildPackageInput
): Promise<CreatedPackage> {
  const built = await buildSightlinesPackage(input);
  const zip = await writeSightlinesZip(built.files);
  return { manifest: built.manifest, zip };
}

// `<project-name>.sightlines`, ascii-slugged like the existing JSON export.
export function packageFilename(project: Project): string {
  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "project"}.sightlines`;
}
