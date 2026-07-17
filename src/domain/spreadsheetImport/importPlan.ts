import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  type Artwork,
  type DisplayUnit
} from "../project";
import { newId } from "../id";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../units/unitSystem";
import { guessColumnMapping } from "./columnMapping";
import {
  detectUnitFromLabel,
  dimensionsFromColumns,
  parseImportedDimensions,
  swapDimensionAxes
} from "./dimensions";
import type { ImportDimensionUnit } from "./dimensions";
import { flagImageConflicts, filterImportImageFiles, matchImageFile } from "./imageMatching";
import type {
  ArtworkImportDraft,
  ColumnMapping,
  DimensionOrder,
  ImportField,
  ImportPlan,
  ImportRow,
  ImportTable,
  ImportWarning,
  ParsedImportDimensions
} from "./types";

export function createArtworkImportPlan({
  table,
  imageFiles,
  projectUnit,
  mapping,
  dimensionOrder = "auto",
  imageAspectByName,
  unitOverride
}: {
  table: ImportTable;
  imageFiles: File[];
  projectUnit: DisplayUnit;
  mapping?: ColumnMapping;
  dimensionOrder?: DimensionOrder;
  // Filename → width/height ratio for uploaded images, computed asynchronously
  // by the caller (createImageBitmap). Absent until it arrives, which is why
  // "auto" order simply falls back to height-first when a row's aspect is
  // unknown — the plan recomputes once the map is populated.
  imageAspectByName?: ReadonlyMap<string, number>;
  // Manual unit for bare (unit-less) dimension values. Replaces the project
  // default ONLY where no inline unit or column-header hint is present — those
  // still win. Undefined leaves the project default in charge.
  unitOverride?: ImportDimensionUnit;
}): ImportPlan {
  const guessed = guessColumnMapping(table);
  const resolvedMapping = mapping ?? guessed.mapping;
  const defaultArtworkUnit = getScopeUnits(
    unitSystemFromDisplayUnit(projectUnit),
    "artwork"
  ).parseUnit;
  const importImageFiles = filterImportImageFiles(imageFiles);

  const draftsWithoutConflict = table.rows.map((row) =>
    createDraft({
      row,
      table,
      mapping: resolvedMapping,
      projectUnit,
      defaultArtworkUnit,
      imageFiles: importImageFiles,
      dimensionOrder,
      imageAspectByName,
      unitOverride
    })
  );
  const flaggedMatches = flagImageConflicts(draftsWithoutConflict.map((draft) => draft.imageMatch));
  const drafts = draftsWithoutConflict.map((draft, index) => {
    const imageMatch = flaggedMatches[index];
    return {
      ...draft,
      imageMatch,
      imageFile: imageMatch.status === "matched" ? imageMatch.file : undefined,
      warnings:
        imageMatch.status === "conflict"
          ? [...draft.warnings, { field: "image" as const, message: imageMatch.reason }]
          : draft.warnings
    };
  });

  return {
    sourceFilename: table.sourceFilename,
    sheetName: table.sheetName,
    table,
    mapping: resolvedMapping,
    guesses: guessed.guesses,
    drafts
  };
}

function createDraft({
  row,
  table,
  mapping,
  projectUnit,
  defaultArtworkUnit,
  imageFiles,
  dimensionOrder,
  imageAspectByName,
  unitOverride
}: {
  row: ImportRow;
  table: ImportTable;
  mapping: ColumnMapping;
  projectUnit: DisplayUnit;
  defaultArtworkUnit: DisplayUnit;
  imageFiles: File[];
  dimensionOrder: DimensionOrder;
  imageAspectByName?: ReadonlyMap<string, number>;
  unitOverride?: ImportDimensionUnit;
}): ArtworkImportDraft {
  const raw = rowToRecord(table, row);
  const value = (field: ImportField) => {
    const index = mapping[field];
    return index === undefined ? undefined : row.values[index]?.trim() || undefined;
  };
  // A mapped column's own header (e.g. "height_cm") tells us its unit more
  // reliably than the project's default artwork unit — a metric column
  // shouldn't be misread as imperial just because the project is imperial.
  const unitHint = (field: ImportField): ImportDimensionUnit | undefined => {
    const index = mapping[field];
    if (index === undefined) return undefined;
    const column = table.columns.find((candidate) => candidate.index === index);
    return column ? detectUnitFromLabel(column.label) : undefined;
  };
  const warnings: ImportWarning[] = [];
  const columnDimensions = dimensionsFromColumns({
    width: value("width"),
    height: value("height"),
    depth: value("depth"),
    widthUnitHint: unitHint("width"),
    heightUnitHint: unitHint("height"),
    depthUnitHint: unitHint("depth"),
    defaultUnit: defaultArtworkUnit,
    unitOverride
  });
  const combinedDimensions =
    !columnDimensions && value("dimensions")
      ? parseImportedDimensions(
          value("dimensions") ?? "",
          defaultArtworkUnit,
          dimensionOrder,
          unitOverride
        )
      : null;
  // Only a single combined cell's H/W order is ever inferred from the image —
  // per-axis columns carry their own unambiguous roles and must never swap.
  let dimensionResult = columnDimensions ?? combinedDimensions;
  const dimensionsFromCombinedColumn = combinedDimensions !== null;

  for (const message of dimensionResult?.warnings ?? []) {
    warnings.push({ field: "dimensions", message });
  }

  // A "framed" role means the framed size won the ROLE_PRIORITY sort (framed
  // ranks first — see dimensions.ts), so the OUTER size is what lands in
  // `dimensions`. That is the size we want on the wall; marking the draft
  // frameIncludedInImage makes it safe: effectiveFraming (domain/framing.ts)
  // then reads the stored size AS the frame-inclusive footprint, so nothing
  // widens it and no schematic band is drawn — the double-count is structurally
  // impossible, not merely warned about. This supersedes the Phase 6a "will
  // double-count" warning; the calm note below (still review-visible via
  // draft.warnings) states the interpretation. If the cell ALSO carried an
  // unframed size, that number stays as raw source text in metadata — the user
  // unchecks "Size includes the frame" to fall back to widening from it.
  const frameInclusive = dimensionResult?.role === "framed";
  if (frameInclusive) {
    warnings.push({
      field: "dimensions",
      message:
        "Size interpreted as frame-inclusive; mat and frame controls are off. Uncheck “Size includes the frame” if this photo shows the bare work."
    });
  }

  const extraMetadata: Artwork["metadata"] = {};
  for (const [key, rawValue] of Object.entries(raw)) {
    if (!rawValue) continue;
    extraMetadata[`source:${key}`] = rawValue;
  }
  if (value("medium")) extraMetadata.medium = value("medium") ?? "";
  if (dimensionResult?.sourceText) extraMetadata.dimensionSourceText = dimensionResult.sourceText;
  if (dimensionResult?.role) extraMetadata.dimensionRole = dimensionResult.role;

  const artwork: Artwork = {
    id: newId(),
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    artist: value("artist"),
    title: value("title") ?? "Untitled",
    date: value("date"),
    accessionNumber: value("accessionNumber"),
    locationOrLender: value("locationOrLender"),
    dimensions: dimensionResult?.dimensions ?? { status: "unknown", displayUnit: projectUnit },
    ...(frameInclusive ? { frameIncludedInImage: true } : {}),
    metadata: {
      ...extraMetadata,
      sourceFilename: table.sourceFilename,
      sourceSheet: table.sheetName,
      sourceRow: row.sourceRowIndex
    }
  };

  if (!value("title")) {
    warnings.push({ field: "title", message: "No title found; imported as Untitled." });
  }
  if (!dimensionResult) {
    warnings.push({ field: "dimensions", message: "No dimensions found." });
  }

  const imageMatch = matchImageFile(
    {
      title: artwork.title,
      artist: artwork.artist,
      date: artwork.date,
      accessionNumber: artwork.accessionNumber,
      imageFilename: value("imageFilename")
    },
    imageFiles
  );

  if (imageMatch.status === "none") {
    warnings.push({ field: "image", message: "No image matched this row." });
  } else if (imageMatch.status === "needs-review") {
    warnings.push({ field: "image", message: "Image match needs review." });
  }

  // "auto" order: a combined "12 x 13" cell defaults to H x W, but if the row's
  // matched image and the parsed dims are both convincingly non-square and
  // disagree on orientation (image landscape vs. dims portrait, or vice versa),
  // trust the image and swap. Runs here because the match is only known now.
  if (
    dimensionOrder === "auto" &&
    dimensionsFromCombinedColumn &&
    dimensionResult &&
    imageMatch.status === "matched"
  ) {
    const imageAspect = imageAspectByName?.get(imageMatch.file.name);
    if (imageAspect !== undefined && shouldSwapForImageOrientation(dimensionResult, imageAspect)) {
      dimensionResult = swapDimensionAxes(dimensionResult);
      artwork.dimensions = dimensionResult.dimensions;
      warnings.push({
        field: "dimensions",
        message: "Width/height order inferred from image orientation."
      });
    }
  }

  return {
    id: `${table.sourceFilename}:${table.sheetName}:${row.sourceRowIndex}`,
    row,
    artwork,
    imageFile: imageMatch.status === "matched" ? imageMatch.file : undefined,
    imageMatch,
    warnings,
    raw,
    selected: true
  };
}

// True when the parsed dims and the matched image are each clearly non-square
// (their w/h ratio differs from 1 by more than 5%) AND their orientations
// disagree. A 5% dead band keeps near-square works — where "landscape vs.
// portrait" is meaningless — from triggering a spurious swap.
const ORIENTATION_DEAD_BAND = 0.05;
function shouldSwapForImageOrientation(
  dimensionResult: ParsedImportDimensions,
  imageAspect: number
): boolean {
  const { widthMm, heightMm } = dimensionResult.dimensions;
  if (!widthMm || !heightMm) return false;
  const dimsAspect = widthMm / heightMm;
  if (Math.abs(dimsAspect - 1) <= ORIENTATION_DEAD_BAND) return false;
  if (Math.abs(imageAspect - 1) <= ORIENTATION_DEAD_BAND) return false;
  const dimsLandscape = dimsAspect > 1;
  const imageLandscape = imageAspect > 1;
  return dimsLandscape !== imageLandscape;
}

function rowToRecord(table: ImportTable, row: ImportRow): Record<string, string> {
  return Object.fromEntries(
    table.columns.map((column) => [column.label, row.values[column.index] ?? ""])
  );
}
