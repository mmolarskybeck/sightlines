import { z } from "zod";
import type { Artwork, Project } from "../project";
import { artworkSchema, migrateArtwork } from "./artworkSchema";
import { migrateProject, projectSchema } from "./projectSchema";

// A `.sightlines` package is a self-contained, denormalized snapshot of one
// project plus the artworks it actually references (docs/plan.md §6) — meant to
// travel to another machine with a different (or empty) library. It carries its
// own schemaVersion so a file sitting on disk indefinitely can be migrated by
// whatever app version later opens it (docs/plan.md §2), independent of the
// embedded Project/Artwork/Asset versions.
export const PACKAGE_SCHEMA_VERSION = 1;

// Three modes, not a binary toggle (docs/plan.md §4.5):
// - originals: archival fidelity — every tier, including the as-uploaded original
// - display:   the default — display + thumbnail tiers, no originals
// - metadata-only: no image blobs at all; the manifest still records asset
//                  metadata + the original content hash so a later re-link works
export const PACKAGE_EXPORT_MODES = ["originals", "display", "metadata-only"] as const;
export type PackageExportMode = (typeof PACKAGE_EXPORT_MODES)[number];

export const ASSET_TIERS = ["original", "display", "thumbnail"] as const;
export type AssetTier = (typeof ASSET_TIERS)[number];

// One image blob that landed in the zip. Recorded per tier so import never has
// to infer which tier a file is or re-derive its hash — every fact it needs is
// explicit, nothing lives only in file naming or ordering.
export const packageAssetTierEntrySchema = z.object({
  tier: z.enum(ASSET_TIERS),
  // Path inside the zip. Content-addressed (`assets/<sha256>.<ext>`) so identical
  // bytes dedupe to one entry within a package; the mapping back to asset+tier
  // lives here in the manifest, never implied by the filename alone.
  path: z.string().min(1),
  // sha256 of THIS tier's bytes — lets import verify integrity on extract and
  // dedupe against the recipient's library by content (docs/plan.md §4.5/§6).
  sha256: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  mimeType: z.string().min(1)
});

export type PackageAssetTierEntry = z.infer<typeof packageAssetTierEntrySchema>;

// One Asset record's inventory. `sha256` here is the ORIGINAL content hash from
// the Asset record (docs/plan.md §4.5) — the stable re-link anchor that survives
// even in metadata-only mode, where `tiers` is empty because no blobs shipped.
export const packageAssetEntrySchema = z.object({
  assetId: z.string().min(1),
  mimeType: z.string().min(1),
  originalFilename: z.string().min(1).optional(),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  byteSize: z.number().nonnegative().optional(),
  sha256: z.string().min(1).optional(),
  tiers: z.array(packageAssetTierEntrySchema)
});

export type PackageAssetEntry = z.infer<typeof packageAssetEntrySchema>;

// The manifest.json contract. This is what import validates against before it
// trusts anything in the zip (docs/plan.md §13). `project` and `artworks` reuse
// the exact same validators the app persists with, so a package round-trips
// through the identical schema the rest of the app already trusts.
export const sightlinesPackageSchema = z.object({
  schemaVersion: z.literal(PACKAGE_SCHEMA_VERSION),
  exportedAt: z.string().datetime(),
  mode: z.enum(PACKAGE_EXPORT_MODES),
  project: projectSchema,
  // The denormalized subset actually referenced by this project (§6), not the
  // whole library.
  artworks: z.array(artworkSchema),
  // Blob inventory + hashes for every referenced asset, present in all modes
  // (empty `tiers` in metadata-only mode).
  assets: z.array(packageAssetEntrySchema)
});

export type SightlinesPackage = {
  schemaVersion: number;
  exportedAt: string;
  mode: PackageExportMode;
  project: Project;
  artworks: Artwork[];
  assets: PackageAssetEntry[];
};

// Validate a fully-built manifest against the current contract. Used before a
// package is emitted (never emit an invalid manifest, docs/plan.md §8) and by
// import to reject a manifest that doesn't match the shape.
export function parseSightlinesPackage(input: unknown): SightlinesPackage {
  return sightlinesPackageSchema.parse(input) as SightlinesPackage;
}

const versionedDocumentSchema = z.object({
  schemaVersion: z.number().int().positive()
});

// Stage 1 of the staged import parse: the ENVELOPE only. The embedded project
// and artworks stay `unknown` here on purpose — a package written by an older
// app legitimately embeds older-schemaVersion documents, and the strict
// sightlinesPackageSchema above would reject them before their migration
// chains ever ran. Import order is therefore (docs/plan.md §2):
//   version guard → lenient envelope → migrate embedded docs → strict validate.
// Export still uses the strict schema directly (it only ever writes
// current-version documents).
const packageEnvelopeSchema = z.object({
  schemaVersion: z.literal(PACKAGE_SCHEMA_VERSION),
  exportedAt: z.string(),
  mode: z.enum(PACKAGE_EXPORT_MODES),
  project: z.unknown(),
  artworks: z.array(z.unknown()),
  assets: z.array(z.unknown())
});

function toFormatError(error: unknown): Error {
  if (error instanceof z.ZodError) {
    const [issue] = error.issues;
    const path = issue?.path.join(".");
    return new Error(
      `this package's data doesn't match the Sightlines format${path ? ` (${path}: ${issue.message})` : ""}.`
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

// The manifest half of the import pipeline (docs/plan.md §2/§13): version
// guard, then the staged parse described on packageEnvelopeSchema. The
// embedded documents run the SAME migration chains the app uses when loading
// from IndexedDB (migrateProject v1→v3, migrateArtwork), so a v1-era package
// opens exactly like a v1-era local file would. A package-level migration
// chain (package v1→v2→...) slots in between the version guard and the
// envelope parse once a second package version ever ships.
export function readPackageManifest(input: unknown): SightlinesPackage {
  const versioned = versionedDocumentSchema.safeParse(input);

  if (!versioned.success) {
    throw new Error("this file is not a Sightlines package.");
  }

  const { schemaVersion } = versioned.data;

  if (schemaVersion > PACKAGE_SCHEMA_VERSION) {
    throw new Error(
      `this package was made with a newer version of Sightlines (schema version ${schemaVersion}) than this app supports (version ${PACKAGE_SCHEMA_VERSION}). Open it with a newer version of the app.`
    );
  }

  let envelope: z.infer<typeof packageEnvelopeSchema>;
  try {
    envelope = packageEnvelopeSchema.parse(input);
  } catch (error) {
    throw toFormatError(error);
  }

  // migrateProject / migrateArtwork throw their own human-readable errors
  // (wrong shape, newer-than-app embedded documents, failed validation) —
  // pass those through untouched.
  const project = migrateProject(envelope.project);
  const artworks = envelope.artworks.map((artwork) => migrateArtwork(artwork));

  try {
    const assets = envelope.assets.map((asset) => packageAssetEntrySchema.parse(asset));
    // Final strict validation of the assembled, fully-migrated manifest —
    // the same contract export writes (datetime format, mode, cross-checks).
    return parseSightlinesPackage({
      schemaVersion: envelope.schemaVersion,
      exportedAt: envelope.exportedAt,
      mode: envelope.mode,
      project,
      artworks,
      assets
    });
  } catch (error) {
    throw toFormatError(error);
  }
}
