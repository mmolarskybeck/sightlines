// Pure decision logic for the image intake pipeline (docs/plan.md §4.5). No
// browser APIs here on purpose — decode/encode/hash live in
// browserImageProcessor.ts, which isn't unit-testable in jsdom. Anything that
// *can* be expressed as plain data-in/data-out belongs in this file instead,
// so it's covered by real tests.

export const ACCEPTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isAcceptedImageType(mimeType: string): boolean {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

// Local-first means this is a disk/memory budget, not a hosting-cost one —
// still worth a cap so one runaway file doesn't stall a batch upload or blow
// past IndexedDB/OPFS quota without warning.
export const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;

export function validateImageFile(
  file: { name: string; type: string; size: number }
): { ok: true } | { ok: false; reason: string } {
  if (!isAcceptedImageType(file.type)) {
    return {
      ok: false,
      reason: `${file.name} is not a supported image type — accepted formats are JPEG, PNG, and WebP.`
    };
  }

  if (file.size > MAX_IMAGE_FILE_BYTES) {
    return {
      ok: false,
      reason: `${file.name} is too large (${formatMegabytes(file.size)}) — images are limited to ${formatMegabytes(MAX_IMAGE_FILE_BYTES)}.`
    };
  }

  return { ok: true };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Tier sizes and encode quality, per docs/plan.md §4.5 — display is
// deliberately above "just a glance" resolution (a 3D camera moving close to
// a wall should still read as sharp); thumbnail is checklist/fast-list only.
export const THUMBNAIL_MAX_PX = 400;
export const DISPLAY_MAX_PX = 1800;
export const WEBP_QUALITY = 0.82;

// Scales the longer edge down to maxPx, preserving aspect ratio. Never
// upscales — a source image already smaller than the cap is returned as-is,
// since generating a display/thumbnail tier bigger than the original would
// waste space without adding real detail.
export function fitWithin(
  widthPx: number,
  heightPx: number,
  maxPx: number
): { widthPx: number; heightPx: number } {
  const longerEdge = Math.max(widthPx, heightPx);

  if (longerEdge <= maxPx) {
    return { widthPx: Math.round(widthPx), heightPx: Math.round(heightPx) };
  }

  const scale = maxPx / longerEdge;

  // Math.max(1, ...) guards extreme aspect ratios (e.g. a 10000x1 banner)
  // where the shorter edge would otherwise round down to 0.
  return {
    widthPx: Math.max(1, Math.round(widthPx * scale)),
    heightPx: Math.max(1, Math.round(heightPx * scale))
  };
}

// Derives a starting artwork title from an uploaded filename: strip the
// extension, trim whitespace, and leave everything else — including
// underscores/hyphens/case — untouched, since those are the artist's own
// naming convention, not ours to normalize.
export function titleFromFilename(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf(".");

  // lastDot > 0 (not >= 0) so a dotfile-style name like ".scan" is treated as
  // having no extension rather than stripping down to an empty stem.
  const stem = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const trimmedStem = stem.trim();

  return trimmedStem.length > 0 ? trimmedStem : trimmed;
}

export type ImageTier = "original" | "display" | "thumbnail";

export type ProcessedImage = {
  widthPx: number;
  heightPx: number;
  sha256: string;
  byteSize: number;
  original: Blob;
  display: Blob;
  thumbnail: Blob;
};

// The seam between this pure module and the effectful browser implementation
// (browserImageProcessor.ts). The app store depends on this interface, not
// the concrete implementation, so its tests can inject a fake processor
// instead of exercising real Canvas/crypto APIs.
export type ImageProcessor = {
  process(file: File): Promise<ProcessedImage>;
};
