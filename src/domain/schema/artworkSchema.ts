import { z } from "zod";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  CURRENT_ASSET_SCHEMA_VERSION,
  type Artwork,
  type Asset
} from "../project";
import { dimensionsSchema } from "./projectSchema";

export const artworkSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(CURRENT_ARTWORK_SCHEMA_VERSION),
  artist: z.string().optional(),
  title: z.string().optional(),
  date: z.string().optional(),
  accessionNumber: z.string().optional(),
  locationOrLender: z.string().optional(),
  dimensions: dimensionsSchema,
  // Optional, additive (no schema-version bump) — absent on legacy records.
  matWidthMm: z.number().positive().optional(),
  frame: z
    .object({
      widthMm: z.number().positive(),
      finish: z.enum(["gold", "white", "black", "silver", "wood"])
    })
    .optional(),
  assetId: z.string().min(1).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()]))
});

export const assetSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(CURRENT_ASSET_SCHEMA_VERSION),
  mimeType: z.string().min(1),
  originalFilename: z.string().min(1).optional(),
  originalKey: z.string().min(1),
  displayKey: z.string().min(1),
  thumbnailKey: z.string().min(1),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  byteSize: z.number().nonnegative().optional(),
  sha256: z.string().min(1).optional()
});

export function parseArtwork(input: unknown): Artwork {
  return artworkSchema.parse(input);
}

export function parseAsset(input: unknown): Asset {
  return assetSchema.parse(input);
}

const versionedDocumentSchema = z.object({
  schemaVersion: z.number().int().positive()
});

// Mirrors migrateProject in projectSchema.ts — every persisted Artwork is
// self-describing and versioned (docs/plan.md §2), so loading one runs the
// same parse → validate minimal shape → migrate → validate current schema
// pipeline as a Project.
export function migrateArtwork(input: unknown): Artwork {
  const versioned = versionedDocumentSchema.safeParse(input);

  if (!versioned.success) {
    throw new Error("this file is not a Sightlines artwork.");
  }

  const { schemaVersion } = versioned.data;

  if (schemaVersion > CURRENT_ARTWORK_SCHEMA_VERSION) {
    throw new Error(
      `this artwork was made with a newer version of Sightlines (schema version ${schemaVersion}) than this app supports (version ${CURRENT_ARTWORK_SCHEMA_VERSION}). Open it with a newer version of the app.`
    );
  }

  if (schemaVersion < CURRENT_ARTWORK_SCHEMA_VERSION) {
    // No migration chain exists yet — CURRENT_ARTWORK_SCHEMA_VERSION has only
    // ever been 1, so `versionedDocumentSchema`'s `.positive()` makes this
    // branch unreachable today. Once an older version ships, run its
    // v1→v2→... migration chain here instead of throwing (docs/plan.md §2).
    throw new Error(
      `this artwork uses an old schema version (${schemaVersion}) that this app can no longer open.`
    );
  }

  try {
    return parseArtwork(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const [issue] = error.issues;
      const path = issue?.path.join(".");
      throw new Error(
        `this artwork's data doesn't match the Sightlines format${path ? ` (${path}: ${issue.message})` : ""}.`
      );
    }
    throw error;
  }
}
