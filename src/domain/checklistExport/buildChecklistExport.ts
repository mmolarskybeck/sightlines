// Orchestrates the checklist spreadsheet export: rows → sort/filter → image
// collection → sheet bytes → a single downloadable file (docs/export-spec.md
// §3.4). Pure over repository seams (getAsset/getBlob), so it is unit-testable
// and browser-independent, exactly like buildProjectPackage.
//
// Nothing here throws for missing content. A checklist whose images have been
// evicted, or whose library records were deleted, still exports — degraded, with
// a warning per problem and a blank cell where the image would be. The only
// failures that reach the caller are structural (the spreadsheet writer or the
// zipper itself).
import { tiersForMode, type PackageZipFile } from "../package/buildPackage";
import { writeSightlinesZip } from "../package/zipPackage";
import type { Artwork, Asset, Project } from "../project";
import type { AssetTier } from "../schema/packageSchema";
import {
  buildChecklistImageStem,
  createFilenameAllocator,
  extensionForMimeType
} from "./filenames";
import { buildChecklistExportRows, buildChecklistExportTable } from "./rows";
import { sortChecklistExportRows } from "./sort";
import type { ChecklistExportOptions, ChecklistExportRow } from "./types";
import {
  CSV_MIME_TYPE,
  writeChecklistCsv,
  writeChecklistXlsx,
  XLSX_MIME_TYPE
} from "./workbook";

// Folder the images land in, and the prefix the "Image file" column carries.
// The import wizard's matcher basenames the cell before comparing, so the
// prefix costs nothing on the way back in.
export const CHECKLIST_IMAGE_FOLDER = "images";

// Entry names inside the zip. Fixed, not project-derived: the zip's own name
// carries the project identity, and a stable inner name is what lets a
// downstream script find the sheet.
export const CHECKLIST_SHEET_BASENAME = "checklist";

export const ZIP_MIME_TYPE = "application/zip";

export type BuildChecklistExportInput = {
  project: Project;
  libraryArtworks: readonly Artwork[];
  options: ChecklistExportOptions;
  // Repository seams, same shape buildPackage uses.
  getAsset: (assetId: string) => Promise<Asset>;
  getBlob: (key: string) => Promise<Blob>;
};

export type BuiltChecklistExport = {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
  warnings: string[];
};

// ascii-slugged project title, matching packageFilename's convention.
export function checklistExportSlug(project: Project): string {
  const slug = project.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
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

// Tier preference order, best first. Reusing tiersForMode keeps this honest
// about what "originals" and "display quality" mean elsewhere in the app, and
// gives graceful degradation for free: an asset missing its original still
// exports its display rendition rather than no image at all.
function tierPreference(images: ChecklistExportOptions["images"]): AssetTier[] {
  return images === "none" ? [] : tiersForMode(images === "originals" ? "originals" : "display");
}

function describeRow(row: ChecklistExportRow): string {
  const artwork = row.artwork;
  return artwork?.title?.trim() || artwork?.accessionNumber?.trim() || row.artworkId;
}

type CollectedImages = {
  files: PackageZipFile[];
  // artworkId → the "Image file" cell value.
  paths: Map<string, string>;
  warnings: string[];
};

async function collectChecklistImages(
  rows: readonly ChecklistExportRow[],
  input: BuildChecklistExportInput
): Promise<CollectedImages> {
  const tiers = tierPreference(input.options.images);
  const files: PackageZipFile[] = [];
  const paths = new Map<string, string>();
  const warnings: string[] = [];
  if (tiers.length === 0) return { files, paths, warnings };

  const allocate = createFilenameAllocator();
  // Two checklist works can legitimately share one asset (a diptych photographed
  // once, a duplicated record). They then share one file rather than unzipping
  // to two byte-identical copies under different names.
  const pathByAssetId = new Map<string, string>();

  for (const [index, row] of rows.entries()) {
    const assetId = row.artwork?.assetId;
    if (!assetId) continue;

    const cached = pathByAssetId.get(assetId);
    if (cached) {
      paths.set(row.artworkId, cached);
      continue;
    }

    let asset: Asset;
    try {
      asset = await input.getAsset(assetId);
    } catch {
      warnings.push(`${describeRow(row)}: its image record is missing; exported without an image.`);
      continue;
    }

    let bytes: Uint8Array | null = null;
    let mimeType = "";
    for (const tier of tiers) {
      try {
        const blob = await input.getBlob(tierBlobKey(asset, tier));
        bytes = new Uint8Array(await blob.arrayBuffer());
        // The stored blob's own type wins; originals fall back to the asset
        // record's MIME and derivatives to WebP, which is what the pipeline
        // renders them as.
        mimeType = blob.type || (tier === "original" ? asset.mimeType : "image/webp");
        break;
      } catch {
        // Try the next tier down before giving up on this work.
      }
    }

    if (!bytes) {
      warnings.push(`${describeRow(row)}: its image file is missing; exported without an image.`);
      continue;
    }

    const filename = allocate(
      buildChecklistImageStem({
        accessionNumber: row.artwork?.accessionNumber,
        artist: row.artwork?.artist,
        title: row.artwork?.title,
        index,
        total: rows.length
      }),
      extensionForMimeType(mimeType)
    );
    const path = `${CHECKLIST_IMAGE_FOLDER}/${filename}`;
    files.push({ path, bytes, compression: "store" });
    pathByAssetId.set(assetId, path);
    paths.set(row.artworkId, path);
  }

  return { files, paths, warnings };
}

export async function buildChecklistExport(
  input: BuildChecklistExportInput
): Promise<BuiltChecklistExport> {
  const { project, libraryArtworks, options } = input;

  const allRows = buildChecklistExportRows(project, libraryArtworks);
  const filtered = options.placedOnly
    ? allRows.filter((row) => row.placement !== null)
    : allRows;
  const rows = sortChecklistExportRows(filtered, options.sort);

  const warnings: string[] = [];
  for (const row of rows) {
    if (!row.artwork) {
      warnings.push(
        `${row.artworkId}: its artwork record is missing from the library; exported as a blank row.`
      );
    }
  }

  const images = await collectChecklistImages(rows, input);
  warnings.push(...images.warnings);

  const table = buildChecklistExportTable({ project, rows, imagePaths: images.paths });
  const sheetBytes =
    options.format === "csv"
      ? writeChecklistCsv(table)
      : await writeChecklistXlsx(table);
  const sheetExtension = options.format === "csv" ? "csv" : "xlsx";
  const slug = checklistExportSlug(project);

  // A bare spreadsheet only when there is nothing to bundle it with. As soon as
  // an images/ folder exists the two have to travel together, or the "Image
  // file" column points at nothing.
  if (options.images === "none") {
    return {
      filename: `${slug}-checklist.${sheetExtension}`,
      bytes: sheetBytes,
      mimeType: options.format === "csv" ? CSV_MIME_TYPE : XLSX_MIME_TYPE,
      warnings
    };
  }

  const zip = await writeSightlinesZip([
    // The sheet deflates (xlsx is already a zip, but its own entries compress
    // further at this level and a CSV compresses hard); images are stored,
    // since they are already-compressed image bytes.
    {
      path: `${CHECKLIST_SHEET_BASENAME}.${sheetExtension}`,
      bytes: sheetBytes,
      compression: "deflate"
    },
    ...images.files
  ]);

  return {
    filename: `${slug}-checklist.zip`,
    bytes: zip,
    mimeType: ZIP_MIME_TYPE,
    warnings
  };
}

export { CSV_MIME_TYPE, XLSX_MIME_TYPE };
