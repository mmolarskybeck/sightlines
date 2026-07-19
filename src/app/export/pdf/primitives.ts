import { PDFFont, PDFPage, degrees, rgb } from "pdf-lib";
import type { DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import {
  chooseScaleBarLengthMm,
  type PageRectPt
} from "../../../domain/export/pageComposition";

export type PdfFonts = {
  regular: PDFFont;
  strong: PDFFont;
  supportedCodePoints: ReadonlySet<number>;
  substitutedUnsupportedText: boolean;
};

export const COLORS = {
  ink: rgb(0.1, 0.11, 0.12),
  muted: rgb(0.38, 0.4, 0.42),
  dimension: rgb(0.48, 0.5, 0.52),
  subtle: rgb(0.58, 0.6, 0.62),
  surface: rgb(0.96, 0.965, 0.97),
  surfaceStrong: rgb(0.91, 0.92, 0.93),
  gridMinor: rgb(0.88, 0.89, 0.9),
  gridMajor: rgb(0.73, 0.75, 0.77),
  // Light grey skeleton bars on the white wall-text panel (~#d4d4d4).
  skeletonBar: rgb(0.83, 0.835, 0.84),
  white: rgb(1, 1, 1)
};

const BODY_SIZE_PT = 8;
const SMALL_SIZE_PT = 7;
export const DIMENSION_SIZE_PT = 7;
export const GRID_TARGET_PT = 8;

export function colorFromHex(hex: string) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return rgb(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  );
}

export function fontText(fonts: PdfFonts, text: string): string {
  return [...text]
    .map((character) => {
      if (fonts.supportedCodePoints.has(character.codePointAt(0)!)) {
        return character;
      }
      fonts.substitutedUnsupportedText = true;
      return "?";
    })
    .join("");
}

export function textWidth(fonts: PdfFonts, text: string, size: number, strong = false): number {
  const font = strong ? fonts.strong : fonts.regular;
  return font.widthOfTextAtSize(fontText(fonts, text), size);
}

export function drawText(
  page: PDFPage,
  fonts: PdfFonts,
  text: string,
  options: {
    x: number;
    y: number;
    size: number;
    strong?: boolean;
    color?: ReturnType<typeof rgb>;
    rotate?: number;
  }
) {
  page.drawText(fontText(fonts, text), {
    x: options.x,
    y: options.y,
    size: options.size,
    font: options.strong ? fonts.strong : fonts.regular,
    color: options.color ?? COLORS.ink,
    ...(options.rotate !== undefined ? { rotate: degrees(options.rotate) } : {})
  });
}

export function drawCenteredLabel(
  page: PDFPage,
  fonts: PdfFonts,
  text: string,
  x: number,
  y: number,
  size = DIMENSION_SIZE_PT,
  rotate?: number
) {
  const width = textWidth(fonts, text, size, true);
  if (rotate === 90) {
    page.drawRectangle({
      x: x - size * 0.25,
      y: y - width / 2 - 2,
      width: size + 3,
      height: width + 4,
      color: COLORS.white
    });
    drawText(page, fonts, text, {
      x: x + size * 0.65,
      y: y - width / 2,
      size,
      strong: true,
      color: COLORS.muted,
      rotate: 90
    });
    return;
  }
  page.drawRectangle({
    x: x - width / 2 - 2,
    y: y - 1,
    width: width + 4,
    height: size + 3,
    color: COLORS.white
  });
  drawText(page, fonts, text, {
    x: x - width / 2,
    y: y + 1,
    size,
    strong: true,
    color: COLORS.muted
  });
}

export function insetRect(rect: PageRectPt, amountPt: number): PageRectPt {
  return {
    xPt: rect.xPt + amountPt,
    yPt: rect.yPt + amountPt,
    widthPt: Math.max(1, rect.widthPt - amountPt * 2),
    heightPt: Math.max(1, rect.heightPt - amountPt * 2)
  };
}

export function insetRectByEdges(
  rect: PageRectPt,
  insets: { left: number; right: number; bottom: number; top: number }
): PageRectPt {
  return {
    xPt: rect.xPt + insets.left,
    yPt: rect.yPt + insets.bottom,
    widthPt: Math.max(1, rect.widthPt - insets.left - insets.right),
    heightPt: Math.max(1, rect.heightPt - insets.bottom - insets.top)
  };
}

export function formatDocumentDimension(
  mm: number,
  unit: DisplayUnit
): string {
  return formatLength(mm, {
    unit,
    ...(unit === "ft" || unit === "in"
      ? { fractionDenominator: 8 as const }
      : {})
  });
}

export function drawLine(
  page: PDFPage,
  from: { x: number; y: number },
  to: { x: number; y: number },
  thickness: number,
  color = COLORS.ink,
  dashArray?: number[]
) {
  page.drawLine({
    start: from,
    end: to,
    thickness,
    color,
    ...(dashArray ? { dashArray } : {})
  });
}

export function drawScaleBar(
  page: PDFPage,
  fonts: PdfFonts,
  unit: DisplayUnit,
  scalePtPerMm: number
) {
  const lengthMm = chooseScaleBarLengthMm(scalePtPerMm, unit);
  const widthPt = lengthMm * scalePtPerMm;
  const x = 36;
  const y = 47;
  drawLine(page, { x, y }, { x: x + widthPt, y }, 1, COLORS.ink);
  drawLine(page, { x, y: y - 3 }, { x, y: y + 3 }, 1, COLORS.ink);
  drawLine(
    page,
    { x: x + widthPt, y: y - 3 },
    { x: x + widthPt, y: y + 3 },
    1,
    COLORS.ink
  );
  drawText(page, fonts, formatLength(lengthMm, { unit }), {
    x,
    y: y + 6,
    size: SMALL_SIZE_PT,
    strong: true,
    color: COLORS.muted
  });
}

export function gridStart(min: number, spacing: number): number {
  return Math.ceil(min / spacing) * spacing;
}

export function drawWrappedCenteredText(
  page: PDFPage,
  fonts: PdfFonts,
  lines: string[],
  rect: { x: number; y: number; width: number; height: number }
) {
  if (rect.width < 28 || rect.height < 18) return;
  const size = Math.min(BODY_SIZE_PT, Math.max(5, rect.height / (lines.length + 2)));
  const lineHeight = size + 2;
  const totalHeight = lines.length * lineHeight;
  let y = rect.y + (rect.height + totalHeight) / 2 - lineHeight;
  for (const line of lines) {
    const width = textWidth(fonts, line, size, line === lines.at(-1));
    const clipped =
      width <= rect.width - 8
        ? line
        : `${line.slice(0, Math.max(1, Math.floor((line.length * (rect.width - 14)) / width)))}…`;
    const clippedWidth = textWidth(fonts, clipped, size, line === lines.at(-1));
    drawText(page, fonts, clipped, {
      x: rect.x + (rect.width - clippedWidth) / 2,
      y,
      size,
      strong: line === lines.at(-1),
      color: COLORS.muted
    });
    y -= lineHeight;
  }
}
