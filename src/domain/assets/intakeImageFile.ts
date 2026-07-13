// Shared validation, processing, and key assignment for uploaded image files.
// Persistence remains caller-owned so duplicate checks can run before saving.

import { newId } from "../id";
import { CURRENT_ASSET_SCHEMA_VERSION, type Asset } from "../project";
import { assetBlobKey } from "../repositories/assetRepository";
import { validateImageFile, type ImageProcessor, type ProcessedImage } from "./imageIntake";

export type ProcessImageFileResult =
  | { ok: true; processed: ProcessedImage }
  | { ok: false; reason: string };

// Returns per-file failures instead of aborting a batch.
export async function processImageFile(
  file: File,
  imageProcessor: ImageProcessor
): Promise<ProcessImageFileResult> {
  const validation = validateImageFile(file);
  if (!validation.ok) return { ok: false, reason: validation.reason };

  try {
    return { ok: true, processed: await imageProcessor.process(file) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : `${file.name} could not be processed.`
    };
  }
}

// Builds an unsaved asset with the repository's fixed blob-key convention.
export function buildImageAsset(file: File, processed: ProcessedImage): Asset {
  const assetId = newId();
  return {
    id: assetId,
    schemaVersion: CURRENT_ASSET_SCHEMA_VERSION,
    mimeType: file.type,
    originalFilename: file.name,
    originalKey: assetBlobKey(assetId, "original"),
    displayKey: assetBlobKey(assetId, "display"),
    thumbnailKey: assetBlobKey(assetId, "thumbnail"),
    widthPx: processed.widthPx,
    heightPx: processed.heightPx,
    byteSize: processed.byteSize,
    sha256: processed.sha256
  };
}
