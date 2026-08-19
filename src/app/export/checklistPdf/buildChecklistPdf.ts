// The checklist PDF (docs/export-spec.md §3.5): the works in this show as a
// reading document — thumbnail, artist, title, date, medium, dimensions, credit
// — rather than the spreadsheet's grid. Same rows, same sort, same "placed
// only" filter as the .xlsx/.csv path; only the presentation differs, which is
// why both formats live behind one dialog.
//
// Pure over the repository seams (getAsset/getBlob) and over the font bytes, so
// it unit-tests without a browser. Nothing here throws for missing content: an
// evicted image or a deleted library record degrades to a warning and a band
// that still prints its caption.
import { PDFDocument, PDFImage, PDFPage } from "pdf-lib";
import {
  checklistExportSlug,
  type BuiltChecklistExport
} from "../../../domain/checklistExport/buildChecklistExport";
import { buildChecklistExportRows } from "../../../domain/checklistExport/rows";
import { sortChecklistExportRows } from "../../../domain/checklistExport/sort";
import type {
  ChecklistExportRow,
  ChecklistPdfExportOptions
} from "../../../domain/checklistExport/types";
import type { Artwork, Asset, Project } from "../../../domain/project";
import { loadPdfFonts, type PdfFontBytesInput } from "../pdf/embedFonts";
import {
  COLORS,
  drawText,
  textWidth,
  type PdfFonts
} from "../pdf/primitives";
import { prepareImageForPdf } from "../pdfImage";
import { buildChecklistCaptionLines } from "./caption";
import {
  CAPTION_BASELINE_RATIO,
  CHECKLIST_LAYOUT,
  CHECKLIST_PAGE_SIZE_PT,
  ellipsizeText,
  fitThumbnailRect,
  paginateChecklistBands,
  wrapCaptionLines,
  type MeasureText,
  type WrappedCaptionLine
} from "./layout";

export const CHECKLIST_PDF_MIME_TYPE = "application/pdf";

// Thumbnails print about two inches wide. 600px on the longest side is ~300dpi
// at that size with headroom, and keeps a 200-work checklist to a few megabytes
// — the reason this is a fixed layout decision and not a user-facing "images"
// control the way the spreadsheet's image folder is.
const THUMBNAIL_MAX_PX = 600;

// Forward lean of the synthetic italic used for the title line.
const TITLE_OBLIQUE_DEG = 11;

export type BuildChecklistPdfInput = {
  project: Project;
  libraryArtworks: readonly Artwork[];
  options: ChecklistPdfExportOptions;
  getAsset: (assetId: string) => Promise<Asset>;
  getBlob: (key: string) => Promise<Blob>;
  // Bundled Geist bytes (pdfFonts.ts). Absent falls back to standard Helvetica
  // plus the glyph-substitution warning, exactly like the document export.
  fontBytes?: PdfFontBytesInput;
  exportedAt?: Date;
};

function describeRow(row: ChecklistExportRow): string {
  const artwork = row.artwork;
  return (
    artwork?.title?.trim() ||
    artwork?.artist?.trim() ||
    artwork?.accessionNumber?.trim() ||
    row.artworkId
  );
}

type BandImage = { image: PDFImage } | null;

// One embedded thumbnail per ASSET, not per row: a diptych photographed once
// embeds its bytes once however many checklist entries point at it.
async function embedThumbnails(
  pdf: PDFDocument,
  rows: readonly ChecklistExportRow[],
  input: BuildChecklistPdfInput,
  warnings: string[]
): Promise<Map<string, BandImage>> {
  const byAssetId = new Map<string, BandImage>();

  for (const row of rows) {
    const assetId = row.artwork?.assetId;
    if (!assetId || byAssetId.has(assetId)) continue;
    try {
      const asset = await input.getAsset(assetId);
      const blob = await input.getBlob(asset.displayKey);
      const prepared = await prepareImageForPdf(blob, {
        maxDimensionPx: THUMBNAIL_MAX_PX
      });
      const image =
        prepared.format === "png"
          ? await pdf.embedPng(prepared.bytes)
          : await pdf.embedJpg(prepared.bytes);
      byAssetId.set(assetId, { image });
    } catch {
      byAssetId.set(assetId, null);
      warnings.push(
        `${describeRow(row)}: its image could not be read; printed without a thumbnail.`
      );
    }
  }

  return byAssetId;
}

function drawRunningHeader(
  page: PDFPage,
  fonts: PdfFonts,
  projectTitle: string,
  pageNumber: number,
  pageCount: number
): void {
  const size = CHECKLIST_LAYOUT.headerSizePt;
  const y = CHECKLIST_LAYOUT.headerBaselinePt;
  const label = `Page ${pageNumber} of ${pageCount}`;
  const labelWidth = textWidth(fonts, label, size);
  const labelX =
    CHECKLIST_PAGE_SIZE_PT.widthPt -
    CHECKLIST_LAYOUT.marginXPt -
    labelWidth;
  const title = ellipsizeText(
    projectTitle,
    labelX - CHECKLIST_LAYOUT.marginXPt - 18,
    (candidate) => textWidth(fonts, candidate, size)
  );
  drawText(page, fonts, title, {
    x: CHECKLIST_LAYOUT.marginXPt,
    y,
    size,
    color: COLORS.muted
  });
  drawText(page, fonts, label, {
    x: labelX,
    y,
    size,
    color: COLORS.muted
  });
}

// Page 1 carries the exhibition title alone — big, bold, centred. The running
// header would be redundant beside it and is deliberately omitted.
function drawExhibitionTitle(
  page: PDFPage,
  fonts: PdfFonts,
  title: string
): void {
  const size = CHECKLIST_LAYOUT.titleSizePt;
  const fittedTitle = ellipsizeText(
    title,
    CHECKLIST_PAGE_SIZE_PT.widthPt - CHECKLIST_LAYOUT.marginXPt * 2,
    (candidate) => textWidth(fonts, candidate, size, true)
  );
  const width = textWidth(fonts, fittedTitle, size, true);
  drawText(page, fonts, fittedTitle, {
    x: (CHECKLIST_PAGE_SIZE_PT.widthPt - width) / 2,
    y: CHECKLIST_LAYOUT.titleBaselinePt,
    size,
    strong: true
  });
}

function drawCaption(
  page: PDFPage,
  fonts: PdfFonts,
  lines: readonly WrappedCaptionLine[],
  topPt: number
): void {
  let cursor = topPt;
  for (const line of lines) {
    const { metrics } = line;
    drawText(page, fonts, line.text, {
      x: CHECKLIST_LAYOUT.captionXPt,
      y: cursor - metrics.sizePt * CAPTION_BASELINE_RATIO,
      size: metrics.sizePt,
      strong: metrics.strong,
      color: metrics.muted ? COLORS.muted : COLORS.ink,
      ...(metrics.oblique ? { obliqueDeg: TITLE_OBLIQUE_DEG } : {})
    });
    cursor -= metrics.leadingPt;
  }
}

export async function buildChecklistPdf(
  input: BuildChecklistPdfInput
): Promise<BuiltChecklistExport> {
  const { project, libraryArtworks, options } = input;
  const exportedAt = input.exportedAt ?? new Date();

  const allRows = buildChecklistExportRows(project, libraryArtworks);
  const filtered = options.placedOnly
    ? allRows.filter((row) => row.placement !== null)
    : allRows;
  const rows = sortChecklistExportRows(filtered, options.sort);

  const warnings: string[] = [];
  for (const row of rows) {
    if (!row.artwork) {
      warnings.push(
        `${row.artworkId}: its artwork record is missing from the library; printed as a blank entry.`
      );
    }
  }

  const pdf = await PDFDocument.create();
  const fonts = await loadPdfFonts(pdf, input.fontBytes);
  pdf.setTitle(`${project.title} — Checklist`);
  pdf.setCreator("Sightlines");
  pdf.setCreationDate(exportedAt);
  pdf.setModificationDate(exportedAt);

  const thumbnails = await embedThumbnails(pdf, rows, input, warnings);

  const measure: MeasureText = (text, metrics) =>
    textWidth(fonts, text, metrics.sizePt, metrics.strong);

  // Measure every caption first: the page count is only knowable once the tall
  // captions have been split, and "Page N of M" needs it before drawing begins.
  const bands = rows.map((row, index) => {
    const captionLines = wrapCaptionLines(
      buildChecklistCaptionLines(row, project.unit, {
        ...(options.numbering ? { number: index + 1 } : {}),
        accession: options.accession,
        location: options.location
      }),
      CHECKLIST_LAYOUT.captionWidthPt,
      measure
    );
    const assetId = row.artwork?.assetId;
    return {
      captionLines,
      image: (assetId ? thumbnails.get(assetId) : null) ?? null
    };
  });

  const placements = paginateChecklistBands(
    bands.map((band) => ({
      captionLineHeightsPt: band.captionLines.map((line) => line.metrics.leadingPt)
    }))
  );
  // An empty checklist still produces a title page rather than a zero-page file
  // (which no reader will open).
  const pageCount = Math.max(
    1,
    placements.reduce((max, placement) => Math.max(max, placement.pageIndex + 1), 0)
  );

  const pages: PDFPage[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([
      CHECKLIST_PAGE_SIZE_PT.widthPt,
      CHECKLIST_PAGE_SIZE_PT.heightPt
    ]);
    if (index === 0) drawExhibitionTitle(page, fonts, project.title);
    else drawRunningHeader(page, fonts, project.title, index + 1, pageCount);
    pages.push(page);
  }

  placements.forEach((placement) => {
    const band = bands[placement.bandIndex];
    const page = pages[placement.pageIndex];
    if (placement.showImage && band.image) {
      const rect = fitThumbnailRect(
        { widthPx: band.image.image.width, heightPx: band.image.image.height },
        placement.topPt
      );
      page.drawImage(band.image.image, {
        x: rect.xPt,
        y: rect.yPt,
        width: rect.widthPt,
        height: rect.heightPt
      });
    }
    drawCaption(
      page,
      fonts,
      band.captionLines.slice(
        placement.captionLineStart,
        placement.captionLineEnd
      ),
      placement.topPt
    );
  });

  if (fonts.substitutedUnsupportedText) {
    warnings.push(
      "Some characters are not available in the export font and were replaced with “?”."
    );
  }

  return {
    filename: `${checklistExportSlug(project)}-checklist.pdf`,
    bytes: await pdf.save(),
    mimeType: CHECKLIST_PDF_MIME_TYPE,
    warnings
  };
}
