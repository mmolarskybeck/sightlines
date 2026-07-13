// Decode-free dimension sniffing for the import allowlist. Never trust
// manifest dimensions; malformed or unknown headers fail closed as null.

export type SniffedImage = {
  // MIME derived from file magic, normalized to image/jpeg.
  format: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif" | "image/tiff";
  widthPx: number;
  heightPx: number;
};

export function readImageDimensions(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null;

  if (hasPngSignature(bytes)) return readPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
  if (ascii(bytes, 0, 3) === "GIF") return readGif(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return readWebp(bytes);
  if (isTiffLittleEndian(bytes) || isTiffBigEndian(bytes)) return readTiff(bytes);
  if (ascii(bytes, 4, 4) === "ftyp") return readAvif(bytes);

  return null;
}

// --- shared readers ---------------------------------------------------------

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return "";
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
  );
}

function dims(format: SniffedImage["format"], widthPx: number, heightPx: number): SniffedImage | null {
  // Zero/negative dimensions mean a malformed header — fail closed.
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx)) return null;
  if (widthPx <= 0 || heightPx <= 0) return null;
  return { format, widthPx, heightPx };
}

// --- PNG ---------------------------------------------------------------------
// 8-byte signature, then the IHDR chunk MUST be first: length(4) "IHDR"
// width(4 BE) height(4 BE).

function hasPngSignature(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((byte, i) => bytes[i] === byte);
}

function readPng(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 24) return null;
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  return dims("image/png", u32be(bytes, 16), u32be(bytes, 20));
}

// --- JPEG --------------------------------------------------------------------
// Scan marker segments for the first SOF0/1/2 (any SOFn except DHT/JPG/DAC):
// [FF marker][len(2 BE)][precision(1)][height(2 BE)][width(2 BE)].

function readJpeg(bytes: Uint8Array): SniffedImage | null {
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null; // lost sync — malformed
    // Skip fill bytes (legal padding between segments).
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) return null;
    const marker = bytes[i];
    i++;

    // Standalone markers with no payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // EOI or SOS before any SOF: no dimensions are coming.
    if (marker === 0xd9 || marker === 0xda) return null;

    if (i + 2 > bytes.length) return null;
    const segmentLength = u16be(bytes, i);
    if (segmentLength < 2 || i + segmentLength > bytes.length) return null;

    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (segmentLength < 7) return null;
      const heightPx = u16be(bytes, i + 3);
      const widthPx = u16be(bytes, i + 5);
      return dims("image/jpeg", widthPx, heightPx);
    }

    i += segmentLength;
  }
  return null;
}

// --- GIF ---------------------------------------------------------------------
// "GIF87a"/"GIF89a", then the logical screen descriptor: width/height u16 LE.

function readGif(bytes: Uint8Array): SniffedImage | null {
  const version = ascii(bytes, 0, 6);
  if (version !== "GIF87a" && version !== "GIF89a") return null;
  if (bytes.length < 10) return null;
  return dims("image/gif", u16le(bytes, 6), u16le(bytes, 8));
}

// --- WebP --------------------------------------------------------------------
// RIFF container; first chunk after "WEBP" decides the flavor.

function readWebp(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  const data = 20; // chunk payload start

  if (chunk === "VP8 ") {
    // Lossy: 3-byte frame tag, then the 9D 01 2A start code, then 14-bit dims.
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
      return null;
    }
    return dims("image/webp", u16le(bytes, data + 6) & 0x3fff, u16le(bytes, data + 8) & 0x3fff);
  }

  if (chunk === "VP8L") {
    // Lossless: 0x2F signature byte, then 14+14 bits of (dimension - 1).
    if (bytes[data] !== 0x2f) return null;
    const bits = u32le(bytes, data + 1);
    return dims("image/webp", (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }

  if (chunk === "VP8X") {
    // Extended: flags(4), then 24-bit LE (canvas dimension - 1) pair.
    return dims("image/webp", u24le(bytes, data + 4) + 1, u24le(bytes, data + 7) + 1);
  }

  return null;
}

// --- AVIF (ISOBMFF) ----------------------------------------------------------
// Walk boxes to meta → iprp → ipco → ispe (fullbox: 4 bytes version/flags,
// then width/height u32 BE). Multiple ispe boxes (thumbnails, layers) can
// exist; the guard takes the component-wise MAX so a bomb hidden in any of
// them is still caught.

function readAvif(bytes: Uint8Array): SniffedImage | null {
  let maxWidth = 0;
  let maxHeight = 0;

  const walk = (start: number, end: number, depth: number): void => {
    if (depth > 8) return;
    let offset = start;
    while (offset + 8 <= end) {
      let size = u32be(bytes, offset);
      let header = 8;
      const type = ascii(bytes, offset + 4, 4);

      if (size === 1) {
        // 64-bit largesize: reject anything whose high word is non-zero.
        if (offset + 16 > end) return;
        if (u32be(bytes, offset + 8) !== 0) return;
        size = u32be(bytes, offset + 12);
        header = 16;
      } else if (size === 0) {
        size = end - offset; // box extends to end of file
      }
      if (size < header || offset + size > end) return;

      if (type === "ispe" && size >= header + 12) {
        const widthPx = u32be(bytes, offset + header + 4);
        const heightPx = u32be(bytes, offset + header + 8);
        if (widthPx > maxWidth) maxWidth = widthPx;
        if (heightPx > maxHeight) maxHeight = heightPx;
      } else if (type === "meta") {
        walk(offset + header + 4, offset + size, depth + 1); // fullbox: skip version/flags
      } else if (type === "iprp" || type === "ipco") {
        walk(offset + header, offset + size, depth + 1);
      }

      offset += size;
    }
  };

  walk(0, bytes.length, 0);
  if (maxWidth === 0 || maxHeight === 0) return null;
  return dims("image/avif", maxWidth, maxHeight);
}

// --- TIFF --------------------------------------------------------------------
// "II*\0" (little-endian) or "MM\0*" (big-endian); first IFD's tags
// 256 (ImageWidth) and 257 (ImageLength), types SHORT(3)/LONG(4) inline.

function isTiffLittleEndian(bytes: Uint8Array): boolean {
  return bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
}

function isTiffBigEndian(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
}

function readTiff(bytes: Uint8Array): SniffedImage | null {
  const little = isTiffLittleEndian(bytes);
  const u16 = little ? u16le : u16be;
  const u32 = little ? u32le : u32be;

  const ifdOffset = u32(bytes, 4);
  if (ifdOffset + 2 > bytes.length) return null;
  const entryCount = u16(bytes, ifdOffset);
  if (ifdOffset + 2 + entryCount * 12 > bytes.length) return null;

  let widthPx: number | undefined;
  let heightPx: number | undefined;

  for (let i = 0; i < entryCount; i++) {
    const entry = ifdOffset + 2 + i * 12;
    const tag = u16(bytes, entry);
    if (tag !== 256 && tag !== 257) continue;

    const type = u16(bytes, entry + 2);
    let value: number;
    if (type === 3) value = u16(bytes, entry + 8); // SHORT, inline
    else if (type === 4) value = u32(bytes, entry + 8); // LONG, inline
    else return null;

    if (tag === 256) widthPx = value;
    else heightPx = value;
  }

  if (widthPx === undefined || heightPx === undefined) return null;
  return dims("image/tiff", widthPx, heightPx);
}
