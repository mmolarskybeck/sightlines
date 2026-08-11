import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExportableSvgMarkup } from "./captureSnapshot";

const SVG_NS = "http://www.w3.org/2000/svg";

function appendStyleTag(cssText: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = cssText;
  document.head.appendChild(style);
  return style;
}

describe("buildExportableSvgMarkup", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("inlines the document's stylesheet as the serialized SVG's first child", async () => {
    appendStyleTag(`
      :root { --bg: #ff00aa; }
      .room-fill { fill: var(--bg); }
    `);

    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 100 50");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "room-fill");
    svg.appendChild(rect);
    document.body.appendChild(svg);

    const { markup } = await buildExportableSvgMarkup(svg);

    // The inlined <style> must be present, carry the actual rule text (not
    // just an empty tag), and precede the room-fill rect in document order —
    // a foreign data:image/svg+xml document only honors <style> embedded
    // inside itself, so this is the whole fix.
    expect(markup).toContain("<style");
    expect(markup).toContain(".room-fill");
    expect(markup).toContain("--bg");
    const styleIndex = markup.indexOf("<style");
    const rectIndex = markup.indexOf('class="room-fill"');
    expect(styleIndex).toBeGreaterThanOrEqual(0);
    expect(rectIndex).toBeGreaterThan(styleIndex);

    document.body.removeChild(svg);
  });

  it("skips a stylesheet whose cssRules access throws (cross-origin) without failing the capture", async () => {
    appendStyleTag(`.wall-fill { fill: #123456; }`);

    // Simulate a cross-origin stylesheet: cssRules access throws a
    // SecurityError in real browsers. getDocumentStyleText must defensively
    // skip it rather than propagate.
    const throwingSheet: Partial<CSSStyleSheet> = {
      get cssRules(): CSSRuleList {
        throw new DOMException("cross-origin", "SecurityError");
      }
    };
    Object.defineProperty(document.styleSheets, "length", {
      configurable: true,
      value: document.styleSheets.length + 1
    });
    const originalItem = document.styleSheets.item.bind(document.styleSheets);
    document.styleSheets.item = ((index: number) =>
      index === document.styleSheets.length - 1
        ? (throwingSheet as CSSStyleSheet)
        : originalItem(index)) as typeof document.styleSheets.item;

    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 10 10");
    document.body.appendChild(svg);

    await expect(buildExportableSvgMarkup(svg)).resolves.toBeDefined();
    const { markup } = await buildExportableSvgMarkup(svg);
    expect(markup).toContain(".wall-fill");

    document.body.removeChild(svg);
    document.styleSheets.item = originalItem;
  });

  it("sets explicit pixel width/height derived from the rendered box", async () => {
    appendStyleTag(`.plan-svg { fill: none; }`);
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 200 80");
    document.body.appendChild(svg);

    // jsdom has no real layout engine (getBoundingClientRect always reports
    // 0x0) and doesn't implement SVGSVGElement.viewBox at all, so this stubs
    // the primary (real-browser) path directly rather than exercising the
    // fallback, which jsdom can't represent either.
    svg.getBoundingClientRect = () =>
      ({ width: 200, height: 80, top: 0, left: 0, right: 200, bottom: 80, x: 0, y: 0, toJSON() {} }) as DOMRect;

    const { markup, widthPx, heightPx } = await buildExportableSvgMarkup(svg);

    expect(widthPx).toBe(200);
    expect(heightPx).toBe(80);
    expect(markup).toContain(`width="${widthPx}"`);
    expect(markup).toContain(`height="${heightPx}"`);

    document.body.removeChild(svg);
  });

  it("inlines a blob: artwork image href as a data: URI (SVG-as-image can't fetch blob: itself)", async () => {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 100 100");
    const image = document.createElementNS(SVG_NS, "image");
    image.setAttribute("href", "blob:http://localhost/fake-artwork-blob");
    image.setAttribute("width", "50");
    image.setAttribute("height", "50");
    svg.appendChild(image);
    document.body.appendChild(svg);

    const fakeBlob = new Blob(["fake-image-bytes"], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("blob:http://localhost/fake-artwork-blob");
        return { blob: async () => fakeBlob } as Response;
      })
    );

    const { markup } = await buildExportableSvgMarkup(svg);

    expect(markup).not.toContain("blob:http://localhost/fake-artwork-blob");
    expect(markup).toMatch(/href="data:image\/png;base64,/);

    document.body.removeChild(svg);
  });

  it("falls back to an <img>+canvas re-encode when the blob fetch is refused (CSP connect-src without blob:)", async () => {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 100 100");
    const image = document.createElementNS(SVG_NS, "image");
    image.setAttribute("href", "blob:http://localhost/csp-blocked");
    svg.appendChild(image);
    document.body.appendChild(svg);

    // A connect-src without blob: refuses the fetch even though the URL is
    // this document's own live data...
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Refused to connect because it violates the document's CSP.");
      })
    );

    // ...but the same URL still loads as an image resource (img-src allows
    // blob:), so the capture must recover through the canvas re-encode.
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/png;base64,ZmFrZQ==");
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 40;
      naturalHeight = 60;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);

    try {
      const { markup } = await buildExportableSvgMarkup(svg);
      expect(markup).not.toContain("blob:http://localhost/csp-blocked");
      expect(markup).toContain("data:image/png;base64,ZmFrZQ==");
    } finally {
      getContext.mockRestore();
      toDataURL.mockRestore();
      document.body.removeChild(svg);
    }
  });

  it("strips a blob href whose fetch rejects (rather than failing the capture or shipping a dead reference)", async () => {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 100 100");
    const image = document.createElementNS(SVG_NS, "image");
    image.setAttribute("href", "blob:http://localhost/gone-missing");
    svg.appendChild(image);
    document.body.appendChild(svg);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("blob URL revoked");
      })
    );

    // A dead blob: href serialized into the standalone SVG is guaranteed to
    // rasterize as the browser's broken-image glyph (secure static mode
    // refuses to fetch it), so the capture must drop the reference entirely.
    await expect(buildExportableSvgMarkup(svg)).resolves.toBeDefined();
    const { markup } = await buildExportableSvgMarkup(svg);
    expect(markup).not.toContain("blob:http://localhost/gone-missing");

    document.body.removeChild(svg);
  });
});
