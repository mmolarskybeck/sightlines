// crypto.randomUUID exists only in "secure contexts" — HTTPS or localhost,
// same restriction as crypto.subtle (see assets/sha256.ts). A curator testing
// image intake on an iPad over plain http against a LAN dev box gets a
// `crypto.randomUUID` that's `undefined`, so every id-assigning call site
// (asset ids, artwork ids, project ids, ...) would throw. crypto.getRandomValues
// has no such restriction, though, so fall back to building a spec-correct
// UUID v4 from it when randomUUID isn't there.

export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return uuidV4FromBytes(bytes);
}

// Exported so tests can exercise it directly: the test environment always
// has crypto.randomUUID, so newId() above would never actually take this path.
export function uuidV4FromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}
