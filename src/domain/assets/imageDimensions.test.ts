import { describe, expect, it } from "vitest";
import { readImageDimensions } from "./imageDimensions";

// --- crafted-header builders -------------------------------------------------

function bytesOf(...parts: (number[] | Uint8Array | string)[]): Uint8Array {
  const chunks = parts.map((part) => {
    if (typeof part === "string") {
      return Uint8Array.from(part, (character) => character.charCodeAt(0));
    }
    return part instanceof Uint8Array ? part : Uint8Array.from(part);
  });
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const be16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const be32 = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const le24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];

function png(width: number, height: number): Uint8Array {
  return bytesOf(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    "IHDR",
    be32(width),
    be32(height),
    [8, 6, 0, 0, 0] // bit depth, color type, etc. — irrelevant to the sniffer
  );
}

function jpeg(width: number, height: number, sofMarker = 0xc0): Uint8Array {
  return bytesOf(
    [0xff, 0xd8],
    // An APP0 segment first, so the scanner has to skip a segment.
    [0xff, 0xe0],
    be16(6),
    "JFIF",
    // SOFn: len(2) precision(1) height(2) width(2) components(1)
    [0xff, sofMarker],
    be16(8),
    [8],
    be16(height),
    be16(width),
    [3]
  );
}

function gif(width: number, height: number): Uint8Array {
  return bytesOf("GIF89a", le16(width), le16(height), [0, 0, 0]);
}

function webpVp8(width: number, height: number): Uint8Array {
  const data = bytesOf([0, 0, 0], [0x9d, 0x01, 0x2a], le16(width), le16(height), [0, 0]);
  return bytesOf("RIFF", le32(4 + 8 + data.length), "WEBP", "VP8 ", le32(data.length), data);
}

function webpVp8l(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const data = bytesOf([0x2f], le32(bits), [0, 0, 0, 0, 0]);
  return bytesOf("RIFF", le32(4 + 8 + data.length), "WEBP", "VP8L", le32(data.length), data);
}

function webpVp8x(width: number, height: number): Uint8Array {
  const data = bytesOf([0, 0, 0, 0], le24(width - 1), le24(height - 1));
  return bytesOf("RIFF", le32(4 + 8 + data.length), "WEBP", "VP8X", le32(data.length), data);
}

function avif(width: number, height: number): Uint8Array {
  const ispe = bytesOf(be32(20), "ispe", [0, 0, 0, 0], be32(width), be32(height));
  const ipco = bytesOf(be32(8 + ispe.length), "ipco", ispe);
  const iprp = bytesOf(be32(8 + ipco.length), "iprp", ipco);
  const meta = bytesOf(be32(12 + iprp.length), "meta", [0, 0, 0, 0], iprp);
  const ftyp = bytesOf(be32(16), "ftyp", "avif", be32(0));
  return bytesOf(ftyp, meta);
}

function tiff(width: number, height: number, littleEndian: boolean): Uint8Array {
  const u16 = littleEndian ? le16 : be16;
  const u32 = littleEndian ? le32 : be32;
  // SHORT values sit in the first two bytes of the 4-byte value field.
  const shortValue = (v: number) => (littleEndian ? [...le16(v), 0, 0] : [...be16(v), 0, 0]);
  return bytesOf(
    littleEndian ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a],
    u32(8), // first IFD offset
    u16(2), // entry count
    u16(256), u16(3), u32(1), shortValue(width),
    u16(257), u16(3), u32(1), shortValue(height)
  );
}

// --- tests --------------------------------------------------------------------

describe("readImageDimensions", () => {
  it("parses PNG IHDR, including over-limit dimensions", () => {
    expect(readImageDimensions(png(8, 6))).toEqual({
      format: "image/png",
      widthPx: 8,
      heightPx: 6
    });
    expect(readImageDimensions(png(60000, 60000))).toMatchObject({
      widthPx: 60000,
      heightPx: 60000
    });
  });

  it("parses JPEG SOF0 and SOF2 past preceding segments", () => {
    expect(readImageDimensions(jpeg(640, 480))).toEqual({
      format: "image/jpeg",
      widthPx: 640,
      heightPx: 480
    });
    expect(readImageDimensions(jpeg(65000, 65000, 0xc2))).toMatchObject({
      widthPx: 65000,
      heightPx: 65000
    });
  });

  it("returns null for a JPEG whose scan starts before any SOF", () => {
    const noSof = bytesOf([0xff, 0xd8], [0xff, 0xda], be16(4), [0, 0]);
    expect(readImageDimensions(noSof)).toBeNull();
  });

  it("parses the GIF logical screen descriptor", () => {
    expect(readImageDimensions(gif(320, 200))).toEqual({
      format: "image/gif",
      widthPx: 320,
      heightPx: 200
    });
    expect(readImageDimensions(gif(60000, 60000))).toMatchObject({ widthPx: 60000 });
  });

  it("parses all three WebP flavors", () => {
    expect(readImageDimensions(webpVp8(800, 600))).toEqual({
      format: "image/webp",
      widthPx: 800,
      heightPx: 600
    });
    expect(readImageDimensions(webpVp8l(1024, 768))).toEqual({
      format: "image/webp",
      widthPx: 1024,
      heightPx: 768
    });
    // VP8X carries 24-bit dims — the flavor that can exceed the app cap.
    expect(readImageDimensions(webpVp8x(20000, 20000))).toEqual({
      format: "image/webp",
      widthPx: 20000,
      heightPx: 20000
    });
  });

  it("walks ISOBMFF boxes to the AVIF ispe", () => {
    expect(readImageDimensions(avif(4032, 3024))).toEqual({
      format: "image/avif",
      widthPx: 4032,
      heightPx: 3024
    });
    expect(readImageDimensions(avif(70000, 70000))).toMatchObject({ widthPx: 70000 });
  });

  it("parses TIFF in both endiannesses", () => {
    expect(readImageDimensions(tiff(1200, 900, true))).toEqual({
      format: "image/tiff",
      widthPx: 1200,
      heightPx: 900
    });
    expect(readImageDimensions(tiff(1200, 900, false))).toEqual({
      format: "image/tiff",
      widthPx: 1200,
      heightPx: 900
    });
  });

  it("returns null for garbage, empty, and truncated inputs", () => {
    expect(readImageDimensions(new Uint8Array(0))).toBeNull();
    expect(readImageDimensions(new TextEncoder().encode("not an image at all"))).toBeNull();
    // Bare PNG signature with no IHDR.
    expect(
      readImageDimensions(
        bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0])
      )
    ).toBeNull();
    // Truncated versions of every builder.
    for (const full of [
      png(8, 6),
      jpeg(640, 480),
      gif(320, 200),
      webpVp8(800, 600),
      webpVp8l(1024, 768),
      avif(4032, 3024),
      tiff(1200, 900, true)
    ]) {
      expect(readImageDimensions(full.subarray(0, 10))).toBeNull();
    }
  });

  it("returns null for zero dimensions (malformed header)", () => {
    expect(readImageDimensions(png(0, 100))).toBeNull();
    expect(readImageDimensions(gif(0, 0))).toBeNull();
  });
});
