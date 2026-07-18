import { describe, expect, it } from "vitest";
import { passThroughFormat, prepareImageForPdf } from "./pdfImage";

// A minimal sniffable PNG header: signature + IHDR with the given dimensions.
function pngHeader(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, widthPx);
  new DataView(bytes.buffer).setUint32(20, heightPx);
  return bytes;
}

describe("prepareImageForPdf", () => {
  it("passes PNG bytes through without browser transcoding", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const result = await prepareImageForPdf(
      new Blob([bytes], { type: "image/png" })
    );

    expect(result.format).toBe("png");
    expect([...result.bytes]).toEqual([...bytes]);
  });

  it("passes JPEG bytes through without browser transcoding", async () => {
    const bytes = new Uint8Array([255, 216, 255, 217]);
    const result = await prepareImageForPdf(
      new Blob([bytes], { type: "image/jpeg" })
    );

    expect(result.format).toBe("jpeg");
    expect([...result.bytes]).toEqual([...bytes]);
  });

  it("passes a within-budget PNG through at its original encoding", () => {
    expect(passThroughFormat(pngHeader(1200, 900), "image/png", 1400)).toBe(
      "png"
    );
  });

  it("routes an oversized PNG to the downscale/re-encode path", () => {
    expect(passThroughFormat(pngHeader(4000, 3000), "image/png", 1400)).toBe(
      null
    );
  });

  it("always transcodes formats pdf-lib cannot embed", () => {
    expect(
      passThroughFormat(pngHeader(100, 100), "image/webp", 1400)
    ).toBe(null);
  });

  it("passes unsniffable bytes through, leaving malformation to pdf-lib", () => {
    const stub = new Uint8Array([137, 80, 78, 71]);
    expect(passThroughFormat(stub, "image/png", 1400)).toBe("png");
  });
});
