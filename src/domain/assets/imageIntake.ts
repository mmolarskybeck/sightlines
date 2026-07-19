// Pure image-intake decisions; browser decoding and encoding live separately.

export const ACCEPTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isAcceptedImageType(mimeType: string): boolean {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

// Protect batch processing and local-storage quotas from oversized files.
export const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;

export function validateImageFile(
  file: { name: string; type: string; size: number }
): { ok: true } | { ok: false; reason: string } {
  if (!isAcceptedImageType(file.type)) {
    return {
      ok: false,
      reason: `${file.name} is not a supported image type. Accepted formats are JPEG, PNG, and WebP.`
    };
  }

  if (file.size > MAX_IMAGE_FILE_BYTES) {
    return {
      ok: false,
      reason: `${file.name} is too large (${formatMegabytes(file.size)}). Images are limited to ${formatMegabytes(MAX_IMAGE_FILE_BYTES)}.`
    };
  }

  return { ok: true };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Display supports close 3D views; thumbnails serve lists.
export const THUMBNAIL_MAX_PX = 400;
export const DISPLAY_MAX_PX = 1800;
export const WEBP_QUALITY = 0.82;

// Fits the longer edge without upscaling.
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

  // Preserve at least one pixel for extreme aspect ratios.
  return {
    widthPx: Math.max(1, Math.round(widthPx * scale)),
    heightPx: Math.max(1, Math.round(heightPx * scale))
  };
}

// Strip the extension but preserve the user's filename conventions.
export function titleFromFilename(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf(".");

  // Dotfile-style names such as ".scan" have no extension.
  const stem = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const trimmedStem = stem.trim();

  return trimmedStem.length > 0 ? trimmedStem : trimmed;
}

export type ProcessedImage = {
  widthPx: number;
  heightPx: number;
  sha256: string;
  byteSize: number;
  original: Blob;
  display: Blob;
  thumbnail: Blob;
};

// Injectable boundary around browser Canvas and crypto APIs.
export type ImageProcessor = {
  process(file: File): Promise<ProcessedImage>;
};
