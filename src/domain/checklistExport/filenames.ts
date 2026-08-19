// Image filenames for the checklist export's images/ folder.
//
// These names are read by humans in a file browser AND fed back through the
// import wizard's filename matcher (domain/spreadsheetImport/imageMatching.ts),
// so they carry the accession number, artist, and title rather than a content
// hash the way .sightlines package assets do. The matcher basenames the cell
// value before comparing, so the "images/" prefix in the sheet is harmless.

// Extension per MIME type. Mirrors buildPackage's table — kept separate rather
// than exported from there because that one is about zip entry naming for
// content-addressed blobs, and the two are free to diverge.
export function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase().split(";")[0].trim()) {
    case "image/webp":
      return "webp";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

// Longest stem (before the extension) we will emit. Well under every real
// filesystem limit, and short enough that a long title plus a long artist name
// still leaves the accession number — the leading, most identifying segment —
// intact.
const MAX_STEM_LENGTH = 80;

// ASCII-safe, slash-free, shell-friendly. Accents fold to their base letters
// (NFKD + diacritic strip) rather than being dropped, so "Brâncuși" stays
// "Brancusi" instead of "Brncu".
export function sanitizeFilenameSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    // Whitespace runs collapse to a single hyphen before the character filter,
    // so "The  Large   Glass" is "The-Large-Glass", not "TheLargeGlass".
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

export type ChecklistImageStemInput = {
  accessionNumber?: string;
  artist?: string;
  title?: string;
  // Zero-based position in the exported order.
  index: number;
  // Total exported rows — sets the zero-padding width so the folder sorts
  // numerically in a plain file browser.
  total: number;
};

// `<accession or zero-padded index>_<artist>_<title>`, each segment sanitized
// and empty segments dropped. Never returns "" — a work with no accession, no
// artist and no title still gets its padded index.
export function buildChecklistImageStem(input: ChecklistImageStemInput): string {
  const width = Math.max(3, String(Math.max(input.total, 1)).length);
  const paddedIndex = String(input.index + 1).padStart(width, "0");
  const lead = sanitizeFilenameSegment(input.accessionNumber?.trim() ?? "") || paddedIndex;
  const segments = [
    lead,
    sanitizeFilenameSegment(input.artist?.trim() ?? ""),
    sanitizeFilenameSegment(input.title?.trim() ?? "")
  ].filter((segment) => segment.length > 0);

  const stem = segments.join("_").slice(0, MAX_STEM_LENGTH);
  // Truncation can land on a separator; trailing punctuation reads as a typo.
  return stem.replace(/[-._]+$/g, "") || paddedIndex;
}

export type FilenameAllocator = (stem: string, extension: string) => string;

// Hands out unique names, suffixing collisions "-2", "-3", … Comparison is
// case-insensitive because macOS and Windows filesystems are: two works whose
// only difference is capitalization must still unzip to two files.
export function createFilenameAllocator(): FilenameAllocator {
  const taken = new Set<string>();
  return (stem, extension) => {
    let candidate = `${stem}.${extension}`;
    let suffix = 2;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${stem}-${suffix}.${extension}`;
      suffix += 1;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}
