export type SnapshotImageFormat = "png" | "jpeg";

// Fixed export-resolution multiplier for raster snapshots (docs/export-spec.md
// §10.4): "a fixed export scale factor chosen for crisp output well above
// screen resolution — an editorial constant, not a user option." The live 3D
// canvas caps its device-pixel ratio at 2 (ThreeDView's `dpr={[1, 2]}`); 3x
// keeps every snapshot comfortably above that ceiling regardless of the
// viewer's actual screen DPR.
export const EXPORT_SCALE_FACTOR = 3;

const JPEG_QUALITY = 0.92;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

// btoa() only accepts Latin1; a project title or artist name can carry
// arbitrary Unicode (accented names, non-Latin scripts), so encode through
// UTF-8 bytes rather than the classic (and deprecated) escape/unescape hack.
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Every visual rule in this app (.room-fill, .wall-fill, .dimension-line,
// .plan-object.is-selected, the var(--token) custom properties, all of it)
// lives in src/styles/global.css, applied to the live SVG only because it's
// mounted in the same document as that stylesheet. A standalone
// `data:image/svg+xml` document loaded through `new Image()` is foreign and
// sandboxed — it never sees the host page's stylesheets, so every
// class-styled element would fall back to bare SVG defaults (black fill, no
// stroke) and every var(--token) would resolve to nothing. The fix is the
// standard one for canvas/SVG rasterization: read the page's own parsed
// CSSOM (document.styleSheets) and inline it as a literal <style> INSIDE the
// cloned SVG before serializing — a `<style>` embedded in the SVG document
// itself is honored; only *external* stylesheet links are not. :root custom
// properties resolve too, since :root matches an SVG document's own root
// element.
//
// Cached and only recomputed when the stylesheet count changes — this is a
// page-wide snapshot, not a per-node computation, so re-walking every
// cssRules list on every capture would be wasted work.
let cachedStyleSheetCount = -1;
let cachedStyleText = "";

function getDocumentStyleText(): string {
  if (typeof document === "undefined") return "";
  if (document.styleSheets.length === cachedStyleSheetCount) return cachedStyleText;

  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheet: cssRules throws a SecurityError. Skip it —
      // this app's own CSS is always same-origin (bundled by Vite).
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) chunks.push(rule.cssText);
  }

  cachedStyleText = chunks.join("\n");
  cachedStyleSheetCount = document.styleSheets.length;
  return cachedStyleText;
}

function blobUrlToDataUri(blobUrl: string): Promise<string> {
  return fetch(blobUrl)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error ?? new Error("blobUrlToDataUri: FileReader failed"));
          reader.readAsDataURL(blob);
        })
    );
}

// ElevationArtwork sets its <image>'s `href` to a `blob:` URL from the app's
// asset pipeline (useAssetImageUrls / imageUrlsByAssetId) — valid and
// resolvable in the live document. But `captureSvgSnapshot` renders the
// serialized clone through an `<img src="data:image/svg+xml...">` pipeline,
// and the SVG spec's "secure static mode" for image contexts refuses to fetch
// ANY external resource reference from inside that document — not even a
// same-origin blob: URL. Left alone, every artwork would rasterize as the
// browser's broken-image glyph regardless of whether the blob is still valid.
// Fetching each blob (fine from the main document — same blob registry the
// live canvas already resolved against) and inlining it as a data: URI before
// serializing sidesteps the restriction entirely. Run in parallel — a busy
// wall can hold many artworks, and inlining them one at a time would serialize
// slowly for no reason.
async function inlineBlobImages(svg: SVGSVGElement): Promise<void> {
  const images = Array.from(svg.querySelectorAll("image"));
  await Promise.all(
    images.map(async (image) => {
      const href = image.getAttribute("href") ?? image.getAttributeNS(XLINK_NS, "href");
      if (!href || !href.startsWith("blob:")) return;
      try {
        const dataUri = await blobUrlToDataUri(href);
        image.setAttribute("href", dataUri);
        if (image.getAttributeNS(XLINK_NS, "href")) {
          image.setAttributeNS(XLINK_NS, "href", dataUri);
        }
      } catch {
        // A blob gone missing/corrupt by capture time: leave the element as
        // the live app already rendered it rather than aborting the whole
        // capture. The §10.3 vector-placeholder behavior for genuinely
        // missing images is a separate, later piece of work.
      }
    })
  );
}

function computeRenderedSizePx(svgElement: SVGSVGElement): { widthPx: number; heightPx: number } {
  // Optional chaining: jsdom (the vitest DOM) doesn't implement
  // SVGSVGElement.viewBox at all, unlike every real browser target.
  const viewBox = svgElement.viewBox?.baseVal;
  const rendered = svgElement.getBoundingClientRect();
  // Fall back to the viewBox's own extent (mm, but only ever used for aspect
  // ratio here) if the element is unattached or hidden at capture time.
  return {
    widthPx: rendered.width || viewBox?.width || 1,
    heightPx: rendered.height || viewBox?.height || 1
  };
}

// Clones `svgElement`, gives the clone explicit pixel width/height, inlines
// every blob: artwork image and the app's actual stylesheet so the serialized
// markup renders identically to the live canvas, and serializes it. Split out
// from captureSvgSnapshot's canvas/Image half so the parts that can actually
// be checked in jsdom, without a real canvas, are independently testable.
export async function buildExportableSvgMarkup(svgElement: SVGSVGElement): Promise<{
  markup: string;
  widthPx: number;
  heightPx: number;
}> {
  const { widthPx, heightPx } = computeRenderedSizePx(svgElement);

  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(widthPx));
  clone.setAttribute("height", String(heightPx));
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", SVG_NS);
  }

  await inlineBlobImages(clone);

  const style = clone.ownerDocument.createElementNS(SVG_NS, "style");
  style.textContent = getDocumentStyleText();
  clone.insertBefore(style, clone.firstChild);

  return { markup: new XMLSerializer().serializeToString(clone), widthPx, heightPx };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("captureSvgSnapshot: failed to decode serialized SVG"));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("captureSvgSnapshot: canvas.toBlob returned null"))),
      mimeType,
      quality
    );
  });
}

// Renders a clean-rendered (exportMode) Plan or Elevation `<svg>` to a raster
// Blob at export resolution. The live element's viewBox (the content's mm
// coordinate box) is left untouched; only the rendered on-screen box —
// `getBoundingClientRect()` — decides the pixel size the SVG is serialized
// at and, scaled by `scaleFactor`, the canvas it's drawn into. Draws from a
// cloned, stylesheet-inlined node so the caller's live SVG is never mutated.
export async function captureSvgSnapshot(
  svgElement: SVGSVGElement,
  options?: { format?: SnapshotImageFormat; scaleFactor?: number }
): Promise<Blob> {
  const format = options?.format ?? "png";
  const scaleFactor = options?.scaleFactor ?? EXPORT_SCALE_FACTOR;

  const { markup, widthPx, heightPx } = await buildExportableSvgMarkup(svgElement);
  const dataUri = `data:image/svg+xml;base64,${toBase64(markup)}`;
  const image = await loadImage(dataUri);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(widthPx * scaleFactor));
  canvas.height = Math.max(1, Math.round(heightPx * scaleFactor));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("captureSvgSnapshot: 2D canvas context unavailable");

  if (format === "jpeg") {
    // JPEG carries no alpha channel; without an opaque backdrop, transparent
    // drawing regions would composite to black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  return canvasToBlob(canvas, mimeType, format === "jpeg" ? JPEG_QUALITY : undefined);
}
