import { readImageDimensions } from "../../domain/assets/imageDimensions";

export type PdfEmbeddableImage = {
  bytes: Uint8Array;
  format: "png" | "jpeg";
};

export type PdfImageOptions = {
  // Longest side of an embedded raster. Elevation artworks print at a few
  // inches and 3D renders are generated near this size, so anything larger
  // only inflates the file (a full-res display image embedded untouched put
  // multi-megabyte PNGs behind inch-wide frames).
  maxDimensionPx?: number;
  // Route a within-budget PNG through the opaque->JPEG re-encode instead of
  // passing it through. For canvas-generated PNGs (3D renders) the PNG
  // encoding is an accident of toBlob, not a fidelity choice, and JPEG is an
  // order of magnitude smaller. JPEG inputs still pass through untouched.
  preferCompact?: boolean;
};

const DEFAULT_MAX_DIMENSION_PX = 1400;
const JPEG_QUALITY = 0.85;

// The passthrough decision, kept pure for testing: bytes already in a
// pdf-lib-embeddable format keep their original encoding when they are
// within the size budget. Unsniffable bytes also pass through — pdf-lib is
// the authority on true malformation, and re-encoding can only lose data.
export function passThroughFormat(
  bytes: Uint8Array,
  mimeType: string,
  maxDimensionPx: number
): "png" | "jpeg" | null {
  const normalizedType = mimeType.toLowerCase();
  const format =
    normalizedType === "image/png"
      ? ("png" as const)
      : normalizedType === "image/jpeg" || normalizedType === "image/jpg"
        ? ("jpeg" as const)
        : null;
  if (!format) return null;
  const sniffed = readImageDimensions(bytes);
  if (sniffed && Math.max(sniffed.widthPx, sniffed.heightPx) > maxDimensionPx) {
    return null;
  }
  return format;
}

function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read image bytes."));
    reader.readAsArrayBuffer(blob);
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Image transcoding produced no data."));
      },
      type,
      quality
    );
  });
}

async function decodeWithImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode the artwork image."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Sampled alpha scan on the drawn canvas: JPEG re-encoding is only safe for
// fully opaque images. Every 16th pixel is enough — transparency in real
// artwork/matting assets is never confined to isolated pixels.
function isFullyOpaque(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  const data = context.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 64) {
    if (data[i] < 255) return false;
  }
  return true;
}

// pdf-lib embeds PNG and JPEG directly. Display-tier assets are normally WebP,
// so those (and any oversized PNG/JPEG, including full-page 3D renders) are
// decoded, downscaled to the size budget, and re-encoded — JPEG for opaque
// images, PNG when transparency must survive. The vector page around the
// image stays vector (docs/export-spec.md §10.3–10.4).
export async function prepareImageForPdf(
  blob: Blob,
  options: PdfImageOptions = {}
): Promise<PdfEmbeddableImage> {
  const maxDimensionPx = options.maxDimensionPx ?? DEFAULT_MAX_DIMENSION_PX;
  const originalBytes = await blobBytes(blob);
  const direct = passThroughFormat(originalBytes, blob.type, maxDimensionPx);
  if (direct) {
    // preferCompact is an optimization, not a requirement: without a real
    // decode pipeline (createImageBitmap), embeddable bytes pass through
    // rather than fail — only genuinely unembeddable formats hard-require
    // transcoding below.
    const canRecompress =
      typeof document !== "undefined" &&
      typeof createImageBitmap === "function";
    if (!(options.preferCompact && direct === "png" && canRecompress)) {
      return { bytes: originalBytes, format: direct };
    }
  }
  if (typeof document === "undefined") {
    throw new Error(`Cannot transcode ${blob.type || "unknown image type"} outside a browser.`);
  }

  const canvas = document.createElement("canvas");
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let bitmap: ImageBitmap | null = null;

  if (typeof createImageBitmap === "function") {
    bitmap = await createImageBitmap(blob);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } else {
    const image = await decodeWithImageElement(blob);
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
  }

  const scale = Math.min(1, maxDimensionPx / Math.max(1, width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap?.close();
    throw new Error("2D canvas context unavailable for image transcoding.");
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  bitmap?.close();

  const opaque = isFullyOpaque(context, canvas.width, canvas.height);
  const encoded = await canvasToBlob(
    canvas,
    opaque ? "image/jpeg" : "image/png",
    opaque ? JPEG_QUALITY : undefined
  );
  return {
    bytes: await blobBytes(encoded),
    format: opaque ? "jpeg" : "png"
  };
}
