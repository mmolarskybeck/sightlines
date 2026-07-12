// Shared seam for the first half of image intake — validate, decode/re-encode,
// and key-assign one uploaded File into a ready-to-save Asset record
// (docs/plan.md §13 will hang the future safety pipeline off this exact
// spot). Two app-layer call sites — the direct file-upload path
// (store.addArtworksFromFiles) and the spreadsheet-import path
// (store.importArtworkDrafts) — used to each hand-roll this validate →
// process → build-Asset sequence with the id/key wiring duplicated between
// them. Factoring it here means a future limit/check is written once, not
// reconciled across two copies that had already started to drift.
//
// Deliberately stops short of the actual assetRepository.saveAsset() call:
// the two call sites persist at different moments for real reasons —
// addArtworksFromFiles gates the save behind a content-hash duplicate check
// (a duplicate is never saved as an orphan asset), while importArtworkDrafts
// folds the asset save into the same try/catch as processing. Forcing a
// single save-inclusive function on both would either leak duplicate assets
// into storage or reshuffle error-message wording neither caller asked for.
//
// Deliberately NOT extended to the .sightlines package import path
// (domain/package/importPackage.ts): that path never decodes/re-encodes —
// it validates already-tiered blobs pulled out of a zip — so it has no File
// and no ImageProcessor to share. Forcing it through this seam would mean
// inventing parameters nothing there needs.

import { newId } from "../id";
import { CURRENT_ASSET_SCHEMA_VERSION, type Asset } from "../project";
import { assetBlobKey } from "../repositories/assetRepository";
import { validateImageFile, type ImageProcessor, type ProcessedImage } from "./imageIntake";

export type ProcessImageFileResult =
  | { ok: true; processed: ProcessedImage }
  | { ok: false; reason: string };

// Validates the file, then decodes/re-encodes it via the injected
// ImageProcessor. Never throws — both failure modes (rejected by
// validateImageFile, or the processor throwing on a corrupt/unreadable
// file) come back as `{ ok: false, reason }` so a caller iterating a batch
// can skip one bad file without sinking the rest.
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

// Assigns a fresh asset id and the three fixed blob-store keys derived from
// it (assetBlobKey) — the naming convention the local blob store depends on.
// Pure: does not touch the repository, so a caller can still decide, inspect,
// or discard before ever persisting anything.
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
