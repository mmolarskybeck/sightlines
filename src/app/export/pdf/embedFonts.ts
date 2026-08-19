// Font embedding for every PDF this app writes (spec §16 font strategy).
// Extracted from createDocumentPdf so the checklist PDF gets the same
// Geist-with-Helvetica-fallback behaviour rather than a second, drifting copy:
// bundled Geist Regular/SemiBold subsets when the caller managed to fetch them,
// the standard-14 Helvetica pair when it did not. Either way the returned
// `supportedCodePoints` is what `fontText` uses to substitute — and warn about —
// glyphs the embedded face cannot draw.
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PdfFonts } from "./primitives";

export type PdfFontBytesInput =
  | Uint8Array
  | { regular: Uint8Array; strong?: Uint8Array };

export async function loadPdfFonts(
  pdf: PDFDocument,
  fontBytes?: PdfFontBytesInput
): Promise<PdfFonts> {
  if (fontBytes) {
    pdf.registerFontkit(fontkit);
    const regularBytes =
      fontBytes instanceof Uint8Array ? fontBytes : fontBytes.regular;
    const strongBytes =
      fontBytes instanceof Uint8Array ? undefined : fontBytes.strong;
    const regular = await pdf.embedFont(regularBytes, { subset: true });
    const strong = strongBytes
      ? await pdf.embedFont(strongBytes, { subset: true })
      : regular;
    return {
      regular,
      strong,
      supportedCodePoints: new Set(regular.getCharacterSet()),
      substitutedUnsupportedText: false
    };
  }
  const [regular, strong] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold)
  ]);
  return {
    regular,
    strong,
    supportedCodePoints: new Set(regular.getCharacterSet()),
    substitutedUnsupportedText: false
  };
}
