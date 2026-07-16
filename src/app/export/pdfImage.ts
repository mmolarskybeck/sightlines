export type PdfEmbeddableImage = {
  bytes: Uint8Array;
  format: "png" | "jpeg";
};

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

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Image transcoding produced no data."));
    }, type);
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

// pdf-lib embeds PNG and JPEG directly. Display-tier assets are normally WebP,
// so convert only those unsupported inputs to PNG at assembly time; the vector
// page around the image stays vector (docs/export-spec.md §10.3–10.4).
export async function prepareImageForPdf(blob: Blob): Promise<PdfEmbeddableImage> {
  const normalizedType = blob.type.toLowerCase();
  if (normalizedType === "image/png") {
    return { bytes: await blobBytes(blob), format: "png" };
  }
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") {
    return { bytes: await blobBytes(blob), format: "jpeg" };
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

  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap?.close();
    throw new Error("2D canvas context unavailable for image transcoding.");
  }
  context.drawImage(source, 0, 0);
  bitmap?.close();

  const png = await canvasToBlob(canvas, "image/png");
  return { bytes: await blobBytes(png), format: "png" };
}
