// Page geometry and flow for the checklist PDF (docs/export-spec.md §3.5).
// Pure arithmetic over measured text widths — the writer injects a `measure`
// closure so this module never touches pdf-lib, and the whole flow (how many
// pages, where each band lands) can be asserted without producing a document.
//
// The band is the unit, not the row of a grid: four works per US Letter page is
// the nominal rhythm, but a caption that wraps past its band simply makes THAT
// band taller and pushes the rest down. Nothing shrinks, nothing clips — a press
// checklist that silently drops the second half of a credit line is worse than
// one with three works on a page.
import type { ChecklistCaptionLine, ChecklistCaptionStyle } from "./caption";

export const CHECKLIST_PAGE_SIZE_PT = { widthPt: 612, heightPt: 792 } as const;

// Inches, expressed once. The reference document is a museum press checklist:
// a 1.9 × 2.1in image well on the left, captions starting 3.7in in, four
// 2.3in bands to a page.
const IN = 72;

export const CHECKLIST_LAYOUT = {
  marginXPt: 0.75 * IN,
  // Bands stop here; the last one on a page may end above it.
  bottomLimitPt: 0.6 * IN,
  // Page 1 gives up height to the centred exhibition title, later pages only
  // to the small running header — and still fit four bands either way.
  firstPageTopPt: CHECKLIST_PAGE_SIZE_PT.heightPt - 1.2 * IN,
  pageTopPt: CHECKLIST_PAGE_SIZE_PT.heightPt - 1 * IN,
  thumbWidthPt: 1.9 * IN,
  thumbHeightPt: 2.1 * IN,
  captionXPt: 3.7 * IN,
  captionWidthPt: CHECKLIST_PAGE_SIZE_PT.widthPt - 3.7 * IN - 0.75 * IN,
  bandMinHeightPt: 2.3 * IN,
  // Breathing room under whichever column is taller, when a band grows past
  // its nominal height.
  bandGutterPt: 0.2 * IN,
  titleSizePt: 14,
  titleBaselinePt: CHECKLIST_PAGE_SIZE_PT.heightPt - 0.85 * IN,
  headerSizePt: 8,
  headerBaselinePt: CHECKLIST_PAGE_SIZE_PT.heightPt - 0.62 * IN
} as const;

export type CaptionStyleMetrics = {
  sizePt: number;
  leadingPt: number;
  strong: boolean;
  oblique: boolean;
};

// Per-role type. The ordinal is small and tight to the artist line it labels;
// the location line is a step smaller because it describes the installation,
// not the work.
export const CAPTION_STYLE_METRICS: Record<
  ChecklistCaptionStyle,
  CaptionStyleMetrics
> = {
  number: { sizePt: 8, leadingPt: 12, strong: true, oblique: false },
  artist: { sizePt: 10, leadingPt: 13, strong: true, oblique: false },
  title: { sizePt: 10, leadingPt: 13, strong: false, oblique: true },
  body: { sizePt: 10, leadingPt: 13, strong: false, oblique: false },
  muted: { sizePt: 9, leadingPt: 12, strong: false, oblique: false }
};

// Where a line's baseline sits below the top of its slot. Roughly the cap
// height of the faces in play; exactness is not load-bearing, consistency is.
export const CAPTION_BASELINE_RATIO = 0.82;

export type MeasureText = (
  text: string,
  metrics: CaptionStyleMetrics
) => number;

// Greedy word wrap. A single word wider than the column is broken by character
// rather than allowed to run into the page margin — long accession numbers and
// URLs in a credit line are the realistic cause, and both are readable broken.
export function wrapCaptionText(
  text: string,
  maxWidthPt: number,
  metrics: CaptionStyleMetrics,
  measure: MeasureText
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  const pushBroken = (word: string) => {
    let chunk = "";
    for (const character of word) {
      const candidate = chunk + character;
      if (chunk && measure(candidate, metrics) > maxWidthPt) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk = candidate;
      }
    }
    current = chunk;
  };

  const startLineWith = (word: string) => {
    if (measure(word, metrics) <= maxWidthPt) current = word;
    else pushBroken(word);
  };

  for (const word of words) {
    if (!current) {
      startLineWith(word);
      continue;
    }
    const candidate = `${current} ${word}`;
    if (measure(candidate, metrics) <= maxWidthPt) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = "";
    startLineWith(word);
  }

  if (current) lines.push(current);
  return lines;
}

export type WrappedCaptionLine = {
  text: string;
  metrics: CaptionStyleMetrics;
};

export function wrapCaptionLines(
  lines: readonly ChecklistCaptionLine[],
  maxWidthPt: number,
  measure: MeasureText
): WrappedCaptionLine[] {
  return lines.flatMap((line) => {
    const metrics = CAPTION_STYLE_METRICS[line.style];
    return wrapCaptionText(line.text, maxWidthPt, metrics, measure).map(
      (text) => ({ text, metrics })
    );
  });
}

export function captionHeightPt(lines: readonly WrappedCaptionLine[]): number {
  return lines.reduce((total, line) => total + line.metrics.leadingPt, 0);
}

// A band is at least its nominal height, and otherwise as tall as whichever
// column overflows plus a gutter.
export function bandHeightPt(captionPt: number): number {
  const content = Math.max(CHECKLIST_LAYOUT.thumbHeightPt, captionPt);
  return Math.max(
    CHECKLIST_LAYOUT.bandMinHeightPt,
    content + CHECKLIST_LAYOUT.bandGutterPt
  );
}

export type ChecklistBandPlacement = {
  pageIndex: number;
  // Top edge of the band, in PDF user space (y up from the page's bottom).
  topPt: number;
  heightPt: number;
};

// Flow the bands down the pages. A band that will not fit below the current
// cursor starts a new page — unless it is the first on its page, in which case
// it stays and overflows rather than looping forever on an unbreakable band.
export function paginateChecklistBands(
  heightsPt: readonly number[]
): ChecklistBandPlacement[] {
  const placements: ChecklistBandPlacement[] = [];
  let pageIndex = 0;
  let cursor = CHECKLIST_LAYOUT.firstPageTopPt;
  let firstOnPage = true;

  for (const heightPt of heightsPt) {
    if (!firstOnPage && cursor - heightPt < CHECKLIST_LAYOUT.bottomLimitPt) {
      pageIndex += 1;
      cursor = CHECKLIST_LAYOUT.pageTopPt;
      firstOnPage = true;
    }
    placements.push({ pageIndex, topPt: cursor, heightPt });
    cursor -= heightPt;
    firstOnPage = false;
  }

  return placements;
}

// Aspect-true fit into the image well, anchored top-left and never enlarged
// past the well. No crop: a checklist thumbnail that trims a work's edges is a
// misrepresentation of the work.
export function fitThumbnailRect(
  imagePx: { widthPx: number; heightPx: number },
  topPt: number
): { xPt: number; yPt: number; widthPt: number; heightPt: number } {
  const scale = Math.min(
    CHECKLIST_LAYOUT.thumbWidthPt / Math.max(1, imagePx.widthPx),
    CHECKLIST_LAYOUT.thumbHeightPt / Math.max(1, imagePx.heightPx)
  );
  const widthPt = Math.max(1, imagePx.widthPx * scale);
  const heightPt = Math.max(1, imagePx.heightPx * scale);
  return {
    xPt: CHECKLIST_LAYOUT.marginXPt,
    yPt: topPt - heightPt,
    widthPt,
    heightPt
  };
}
