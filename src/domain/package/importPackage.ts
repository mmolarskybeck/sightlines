import { readImageDimensions } from "../assets/imageDimensions";
import { newId } from "../id";
import {
  CURRENT_ASSET_SCHEMA_VERSION,
  type Artwork,
  type Asset,
  type Project
} from "../project";
import { assetBlobKey } from "../repositories/assetRepository";
import {
  readPackageManifest,
  type AssetTier,
  type PackageAssetEntry,
  type SightlinesPackage
} from "../schema/packageSchema";
import { hashBytes, MANIFEST_PATH } from "./buildPackage";
import { extractPackageEntries } from "./extractPackage";

// ---------------------------------------------------------------------------
// Open: zip safety + manifest pipeline composed (docs/plan.md §13 steps 1-2).
// ---------------------------------------------------------------------------

export type OpenedPackage = {
  manifest: SightlinesPackage;
  files: Map<string, Uint8Array>;
};

export async function openSightlinesPackage(bytes: Uint8Array): Promise<OpenedPackage> {
  const files = await extractPackageEntries(bytes);

  const manifestBytes = files.get(MANIFEST_PATH);
  if (!manifestBytes) {
    throw new Error("the package has no manifest.json — this is not a Sightlines package.");
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error("the package manifest is not valid JSON.");
  }

  return { manifest: readPackageManifest(json), files };
}

// ---------------------------------------------------------------------------
// Asset intake validation (docs/plan.md §13 step 3).
// ---------------------------------------------------------------------------

// Exactly what export can emit (buildPackage's extensionForMime table). A blob
// claiming any other type is rejected regardless of its path's extension.
export const IMPORT_MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  "image/webp",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/avif",
  "image/tiff"
]);

// Decode guard: 16384px is the common GPU texture ceiling; a dimension above
// it is either corrupt or hostile (a 65k×65k claim would decode to gigabytes
// of RGBA). The ENFORCEMENT reads the actual file headers (readImageDimensions,
// no decoding) — manifest-declared widthPx/heightPx are attacker-controlled and
// only serve as a cheap fast-reject.
export const MAX_ASSET_DIMENSION_PX = 16384;

// image/jpg is a legacy alias some encoders emit; treat it as image/jpeg when
// comparing a manifest claim against what the header magic identifies.
function normalizeMime(mimeType: string): string {
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

export type ValidatedTierBlob = {
  bytes: Uint8Array;
  mimeType: string;
};

export type ValidatedPackageAsset = {
  entry: PackageAssetEntry;
  tiers: Partial<Record<AssetTier, ValidatedTierBlob>>;
};

export type ValidatedPackageAssets = {
  // Only assets with at least one intact tier blob appear here.
  byAssetId: Map<string, ValidatedPackageAsset>;
  warnings: string[];
};

// Integrity + safety pass over every blob the manifest inventories. Per-asset
// failures degrade (drop the tier / the asset, record a warning) — one bad
// image never fails the whole import (docs/plan.md §6/§13).
export async function validatePackageAssets(
  manifest: SightlinesPackage,
  files: Map<string, Uint8Array>
): Promise<ValidatedPackageAssets> {
  const byAssetId = new Map<string, ValidatedPackageAsset>();
  const warnings: string[] = [];

  for (const entry of manifest.assets) {
    const label = entry.originalFilename ?? entry.assetId;

    if (
      (entry.widthPx !== undefined && entry.widthPx > MAX_ASSET_DIMENSION_PX) ||
      (entry.heightPx !== undefined && entry.heightPx > MAX_ASSET_DIMENSION_PX)
    ) {
      warnings.push(`${label}: image dimensions exceed the ${MAX_ASSET_DIMENSION_PX}px limit.`);
      continue;
    }

    const tiers: Partial<Record<AssetTier, ValidatedTierBlob>> = {};
    for (const tier of entry.tiers) {
      if (!IMPORT_MIME_ALLOWLIST.has(tier.mimeType)) {
        warnings.push(`${label}: unsupported image type (${tier.mimeType}).`);
        continue;
      }

      const bytes = files.get(tier.path);
      if (!bytes) {
        warnings.push(`${label}: image file missing from the package (${tier.path}).`);
        continue;
      }
      if (bytes.byteLength !== tier.byteSize) {
        warnings.push(`${label}: image file size does not match the manifest (${tier.path}).`);
        continue;
      }
      if ((await hashBytes(bytes)) !== tier.sha256) {
        warnings.push(`${label}: image file is corrupt (checksum mismatch, ${tier.path}).`);
        continue;
      }

      // The real dimension enforcement: sniff the ACTUAL file header (no
      // decode). Fail closed — an "image" whose header can't be read is
      // never persisted, and a pixel bomb is caught here regardless of what
      // the manifest declared (or omitted).
      const sniffed = readImageDimensions(bytes);
      if (!sniffed) {
        warnings.push(`${label}: unreadable image data (${tier.path}).`);
        continue;
      }
      if (sniffed.widthPx > MAX_ASSET_DIMENSION_PX || sniffed.heightPx > MAX_ASSET_DIMENSION_PX) {
        warnings.push(`${label}: image dimensions exceed the ${MAX_ASSET_DIMENSION_PX}px limit.`);
        continue;
      }
      // The header magic must agree with the allowlisted MIME claim — a
      // mislabelled blob (PNG bytes claiming image/webp) degrades rather
      // than being persisted under a false type.
      if (sniffed.format !== normalizeMime(tier.mimeType)) {
        warnings.push(
          `${label}: image data (${sniffed.format}) does not match its declared type (${tier.mimeType}).`
        );
        continue;
      }

      tiers[tier.tier] = { bytes, mimeType: tier.mimeType };
    }

    if (Object.keys(tiers).length > 0) {
      byAssetId.set(entry.assetId, { entry, tiers });
    } else if (entry.tiers.length > 0) {
      // Every shipped tier failed — the asset degrades to metadata-only.
      warnings.push(`${label}: no usable image data; importing without an image.`);
    }
    // entry.tiers.length === 0 (metadata-only mode) is not a warning by
    // itself — the mode promises no blobs. Whether the artwork ends up
    // imageless or re-linked is decided by planPackageImport.
  }

  return { byAssetId, warnings };
}

// ---------------------------------------------------------------------------
// Merge planning (docs/plan.md §6 rules) — pure, no repositories.
// ---------------------------------------------------------------------------

export type ExistingLibraryState = {
  artworks: Artwork[];
  // assetId → the Asset record's original content sha256 (absent for legacy
  // assets without a hash).
  assetShaById: Map<string, string>;
  projectIds: string[];
};

export type ArtworkConflict = {
  incoming: Artwork; // already rebound to its resolved local assetId
  existing: Artwork;
};

export type ConflictResolution = "mine" | "theirs" | "both";

export type PreparedAssetSave = {
  asset: Asset;
  blobs: Record<AssetTier, ValidatedTierBlob>;
};

export type ImportPlan = {
  project: Project;
  projectRenamed: boolean;
  mode: SightlinesPackage["mode"];
  artworksToAdd: Artwork[];
  reusedArtworkIds: string[];
  conflicts: ArtworkConflict[];
  assetsToSave: PreparedAssetSave[];
  warnings: string[];
};

// Order-insensitive structural equality for the §6 "identical content" test.
// assetId and schemaVersion are excluded: the incoming record's assetId may
// have been legitimately rebound to a local asset id carrying the same image
// bytes, and image identity is compared by content hash separately.
export function artworkContentEquals(a: Artwork, b: Artwork): boolean {
  const strip = ({ assetId: _a, schemaVersion: _v, ...rest }: Artwork) => rest;
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

// Best-available fallback chain for the fixed three-slot local blob store: a
// display-mode package has no original bytes, so the display tier stands in
// as the stored "original" (the best fidelity this machine has ever seen).
// The Asset record's sha256 stays the MANIFEST's original hash, so dedupe
// against a future upload of the true original still matches. Documented in
// docs/package-format.md.
function fillTierSlots(
  tiers: Partial<Record<AssetTier, ValidatedTierBlob>>
): Record<AssetTier, ValidatedTierBlob> | null {
  const original = tiers.original ?? tiers.display ?? tiers.thumbnail;
  if (!original) return null;
  const display = tiers.display ?? original;
  const thumbnail = tiers.thumbnail ?? display;
  return { original, display, thumbnail };
}

function resolvedOriginalContentHash(
  entry: PackageAssetEntry,
  validatedAsset: ValidatedPackageAsset | undefined
): string | undefined {
  if (validatedAsset?.tiers.original) {
    return entry.tiers.find((tier) => tier.tier === "original")?.sha256 ?? entry.sha256;
  }
  return entry.sha256;
}

export function planPackageImport(
  manifest: SightlinesPackage,
  validated: ValidatedPackageAssets,
  existing: ExistingLibraryState
): ImportPlan {
  const warnings = [...validated.warnings];

  // --- Project identity: never silently overwrite local work. An id
  // collision imports as a NEW project with a fresh id and a marked title.
  const projectIds = new Set(existing.projectIds);
  const projectRenamed = projectIds.has(manifest.project.id);
  const importedAt = new Date().toISOString();
  const project: Project = projectRenamed
    ? {
        ...manifest.project,
        id: newId(),
        title: `${manifest.project.title} (imported)`,
        updatedAt: importedAt
      }
    : { ...manifest.project, updatedAt: importedAt };

  // --- Asset resolution. For each manifest asset entry, decide what the
  // importing machine's artwork records should point at:
  //   1. identical content already in the library (any id) → reuse that
  //      asset id; the incoming record and blobs are discarded (dedupe, §6).
  //      This also covers metadata-only packages landing on a machine that
  //      already has the images: the sha anchor re-links them automatically.
  //   2. blobs shipped and intact → save as a (possibly re-identified) new
  //      asset record.
  //   3. nothing shipped, nothing local → the artwork imports imageless.
  const localAssetIdBySha = new Map<string, string>();
  for (const [assetId, sha] of existing.assetShaById) {
    if (!localAssetIdBySha.has(sha)) localAssetIdBySha.set(sha, assetId);
  }

  // manifest assetId → local assetId (or null = import without an image).
  const assetRebinds = new Map<string, string | null>();
  const assetsToSave: PreparedAssetSave[] = [];

  for (const entry of manifest.assets) {
    const label = entry.originalFilename ?? entry.assetId;

    const validatedAsset = validated.byAssetId.get(entry.assetId);
    const contentHash = resolvedOriginalContentHash(entry, validatedAsset);
    const localMatch = contentHash ? localAssetIdBySha.get(contentHash) : undefined;
    if (localMatch !== undefined) {
      assetRebinds.set(entry.assetId, localMatch);
      continue;
    }

    const slots = validatedAsset ? fillTierSlots(validatedAsset.tiers) : null;
    if (!slots) {
      assetRebinds.set(entry.assetId, null);
      if (entry.tiers.length === 0) {
        warnings.push(`${label}: no image in the package (metadata-only export).`);
      }
      continue;
    }

    // Keep the incoming id unless it is already taken locally by DIFFERENT
    // content — ids are never reused for different bytes.
    const idTaken =
      existing.assetShaById.has(entry.assetId) &&
      existing.assetShaById.get(entry.assetId) !== contentHash;
    const assetId = idTaken ? newId() : entry.assetId;

    const asset: Asset = {
      id: assetId,
      schemaVersion: CURRENT_ASSET_SCHEMA_VERSION,
      // Describes the stored original slot: the true original's type when it
      // shipped, otherwise the stand-in tier's type.
      mimeType: slots.original.mimeType,
      ...(entry.originalFilename ? { originalFilename: entry.originalFilename } : {}),
      originalKey: assetBlobKey(assetId, "original"),
      displayKey: assetBlobKey(assetId, "display"),
      thumbnailKey: assetBlobKey(assetId, "thumbnail"),
      ...(entry.widthPx !== undefined ? { widthPx: entry.widthPx } : {}),
      ...(entry.heightPx !== undefined ? { heightPx: entry.heightPx } : {}),
      ...(entry.byteSize !== undefined ? { byteSize: entry.byteSize } : {}),
      ...(contentHash ? { sha256: contentHash } : {})
    };

    assetsToSave.push({ asset, blobs: slots });
    assetRebinds.set(entry.assetId, assetId);
  }

  // --- Artwork merge (§6). Placed-but-unchecklisted works were already folded
  // into manifest.artworks by export; everything here references that subset.
  const existingById = new Map(existing.artworks.map((artwork) => [artwork.id, artwork]));
  const entryShaByAssetId = new Map(
    manifest.assets
      .map((entry) => [
        entry.assetId,
        resolvedOriginalContentHash(entry, validated.byAssetId.get(entry.assetId))
      ] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
  );

  const artworksToAdd: Artwork[] = [];
  const reusedArtworkIds: string[] = [];
  const conflicts: ArtworkConflict[] = [];

  for (const artwork of manifest.artworks) {
    let rebound: Artwork = artwork;
    if (artwork.assetId !== undefined) {
      // Map.get returning undefined = the manifest has no inventory entry for
      // this asset at all; a stored null = inventoried but unusable/absent.
      const known = assetRebinds.get(artwork.assetId);
      const target = known === undefined ? null : known;
      if (known === undefined) {
        warnings.push(
          `${artwork.title ?? "Untitled"}: its image is not in the package; importing without an image.`
        );
      }
      rebound =
        target === null
          ? (({ assetId: _dropped, ...rest }) => rest)(artwork)
          : { ...artwork, assetId: target };
    }

    const existingArtwork = existingById.get(artwork.id);
    if (!existingArtwork) {
      artworksToAdd.push(rebound);
      continue;
    }

    // Same id: identical content → reuse; differing → user decides.
    const incomingSha = artwork.assetId ? entryShaByAssetId.get(artwork.assetId) : undefined;
    const existingSha = existingArtwork.assetId
      ? existing.assetShaById.get(existingArtwork.assetId)
      : undefined;
    const sameImage = incomingSha === existingSha; // both undefined counts as same
    if (sameImage && artworkContentEquals(artwork, existingArtwork)) {
      reusedArtworkIds.push(artwork.id);
    } else {
      conflicts.push({ incoming: rebound, existing: existingArtwork });
    }
  }

  return {
    project,
    projectRenamed,
    mode: manifest.mode,
    artworksToAdd,
    reusedArtworkIds,
    conflicts,
    assetsToSave,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Finalize: apply conflict resolutions, remap ids, drop unreferenced assets.
// ---------------------------------------------------------------------------

export type ImportCommit = {
  project: Project;
  artworksToSave: Artwork[];
  assetsToSave: PreparedAssetSave[];
  warnings: string[];
};

function remapArtworkReferences(project: Project, fromId: string, toId: string): Project {
  return {
    ...project,
    checklistArtworkIds: project.checklistArtworkIds.map((id) => (id === fromId ? toId : id)),
    wallObjects: project.wallObjects.map((object) =>
      object.kind === "artwork" && object.artworkId === fromId
        ? { ...object, artworkId: toId }
        : object
    ),
    floorObjects: project.floorObjects.map((object) =>
      object.kind === "artwork" && object.artworkId === fromId
        ? { ...object, artworkId: toId }
        : object
    )
  };
}

// Resolutions default to "mine" — the safe choice when a conflict somehow
// arrives unresolved is to leave the local library untouched.
export function finalizePackageImport(
  plan: ImportPlan,
  resolutions: Record<string, ConflictResolution>
): ImportCommit {
  let project = plan.project;
  const artworksToSave: Artwork[] = [...plan.artworksToAdd];

  for (const conflict of plan.conflicts) {
    const resolution = resolutions[conflict.incoming.id] ?? "mine";
    switch (resolution) {
      case "mine":
        // Keep the local record; the imported project's references resolve to
        // it (same id), so placements render with the local metadata.
        break;
      case "theirs":
        artworksToSave.push(conflict.incoming);
        break;
      case "both": {
        const duplicateId = newId();
        artworksToSave.push({ ...conflict.incoming, id: duplicateId });
        project = remapArtworkReferences(project, conflict.incoming.id, duplicateId);
        break;
      }
    }
  }

  // Drop prepared assets nothing ended up referencing (e.g. a keep-mine
  // resolution rejected the only artwork that pointed at one).
  const referencedAssetIds = new Set(
    artworksToSave.map((artwork) => artwork.assetId).filter((id): id is string => id !== undefined)
  );
  const assetsToSave = plan.assetsToSave.filter((prepared) =>
    referencedAssetIds.has(prepared.asset.id)
  );

  return { project, artworksToSave, assetsToSave, warnings: plan.warnings };
}
