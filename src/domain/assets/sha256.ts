// crypto.subtle only exists in "secure contexts" — HTTPS or localhost. A
// curator testing photo import on an iPad over plain http against a LAN IP
// (the normal way to point a tablet at a dev box that has no cert) gets a
// `crypto.subtle` that's `undefined`, and the WebCrypto digest call blows up
// with "undefined is not an object". The hash isn't cosmetic, though — it's
// persisted as the asset's content address and used for cross-upload dedupe
// (see titleBySha in app/store.ts), so whatever fills in for WebCrypto has to
// produce byte-identical standard SHA-256 hex output. Hence: use
// crypto.subtle when it's there, and fall back to a plain-TypeScript
// FIPS 180-4 implementation when it isn't.

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;

  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return toHex(new Uint8Array(digest));
  }

  return sha256HexSync(new Uint8Array(bytes));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// --- Pure fallback (FIPS 180-4) -------------------------------------------
// Exported so tests can exercise it directly: the test environment always
// has crypto.subtle, so sha256Hex above would never actually take this path.

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const INITIAL_HASH = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19
]);

export function sha256HexSync(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}

function sha256(message: Uint8Array): Uint8Array {
  const h = INITIAL_HASH.slice();
  const w = new Uint32Array(64);

  for (const block of padMessage(message)) {
    for (let t = 0; t < 16; t++) {
      const offset = t * 4;
      w[t] =
        ((block[offset] << 24) |
          (block[offset + 1] << 16) |
          (block[offset + 2] << 8) |
          block[offset + 3]) >>>
        0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let t = 0; t < 64; t++) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + bigS1 + ch + ROUND_CONSTANTS[t] + w[t]) | 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigS0 + maj) | 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    digest[i * 4] = (h[i] >>> 24) & 0xff;
    digest[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    digest[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    digest[i * 4 + 3] = h[i] & 0xff;
  }
  return digest;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

// Pads to a whole number of 512-bit (64-byte) blocks: a single 0x80 byte,
// zeros, then the original length in bits as a big-endian 64-bit suffix.
// Images are never within reach of 2^32 bits (~512 MiB), but the high word
// is still filled in correctly (bit length = byte length × 8 can exceed
// 2^32 well before it exceeds Number.MAX_SAFE_INTEGER) rather than assumed
// zero, so this stays correct for any input the platform could hand it.
function padMessage(message: Uint8Array): Uint8Array[] {
  const bitLenLow = (message.length * 8) >>> 0;
  const bitLenHigh = Math.floor(message.length / 0x20000000);

  const paddedLength = Math.ceil((message.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  const lengthOffset = paddedLength - 8;
  padded[lengthOffset] = (bitLenHigh >>> 24) & 0xff;
  padded[lengthOffset + 1] = (bitLenHigh >>> 16) & 0xff;
  padded[lengthOffset + 2] = (bitLenHigh >>> 8) & 0xff;
  padded[lengthOffset + 3] = bitLenHigh & 0xff;
  padded[lengthOffset + 4] = (bitLenLow >>> 24) & 0xff;
  padded[lengthOffset + 5] = (bitLenLow >>> 16) & 0xff;
  padded[lengthOffset + 6] = (bitLenLow >>> 8) & 0xff;
  padded[lengthOffset + 7] = bitLenLow & 0xff;

  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < paddedLength; offset += 64) {
    blocks.push(padded.subarray(offset, offset + 64));
  }
  return blocks;
}
