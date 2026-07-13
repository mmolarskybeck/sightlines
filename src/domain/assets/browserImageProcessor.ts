// Browser-backed image decode, hash, and tier encoding.

import { DISPLAY_MAX_PX, THUMBNAIL_MAX_PX, WEBP_QUALITY, fitWithin } from "./imageIntake";
import type { ImageProcessor, ProcessedImage } from "./imageIntake";
import { sha256Hex } from "./sha256";

type EncodableCanvas = OffscreenCanvas | HTMLCanvasElement;

export function createBrowserImageProcessor(): ImageProcessor {
  return {
    async process(file: File): Promise<ProcessedImage> {
      // Originals remain untouched; bytes are also used for the content hash.
      const bytes = await file.arrayBuffer();
      const sha256 = await sha256Hex(bytes);

      const bitmap = await decodeBitmap(file);

      try {
        const display = await renderTier(bitmap, DISPLAY_MAX_PX, file.name);
        const thumbnail = await renderTier(bitmap, THUMBNAIL_MAX_PX, file.name);

        return {
          widthPx: bitmap.width,
          heightPx: bitmap.height,
          sha256,
          byteSize: bytes.byteLength,
          original: file,
          display,
          thumbnail
        };
      } finally {
        bitmap.close();
      }
    }
  };
}

async function decodeBitmap(file: File): Promise<ImageBitmap> {
  try {
    // Apply EXIF orientation before producing derivative tiers.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name} could not be read as an image.`);
  }
}

async function renderTier(bitmap: ImageBitmap, maxPx: number, filename: string): Promise<Blob> {
  const { widthPx, heightPx } = fitWithin(bitmap.width, bitmap.height, maxPx);
  const canvas = createCanvas(widthPx, heightPx);

  drawBitmap(canvas, bitmap, widthPx, heightPx, filename);

  return encodeWebp(canvas, filename);
}

function createCanvas(widthPx: number, heightPx: number): EncodableCanvas {
  // Fall back for browsers without OffscreenCanvas.
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(widthPx, heightPx);
  }

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  return canvas;
}

function drawBitmap(
  canvas: EncodableCanvas,
  bitmap: ImageBitmap,
  widthPx: number,
  heightPx: number,
  filename: string
): void {
  // Narrow the canvas type so each drawImage overload remains unambiguous.
  if (canvas instanceof HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(`${filename} could not be read as an image.`);
    }
    context.drawImage(bitmap, 0, 0, widthPx, heightPx);
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(`${filename} could not be read as an image.`);
  }
  context.drawImage(bitmap, 0, 0, widthPx, heightPx);
}

async function encodeWebp(canvas: EncodableCanvas, filename: string): Promise<Blob> {
  try {
    if (canvas instanceof HTMLCanvasElement) {
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
          "image/webp",
          WEBP_QUALITY
        );
      });
    }

    return await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
  } catch {
    throw new Error(`${filename} could not be read as an image.`);
  }
}
