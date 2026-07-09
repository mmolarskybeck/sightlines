import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex, sha256HexSync } from "./sha256";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("sha256HexSync", () => {
  it("hashes the empty input", () => {
    expect(sha256HexSync(utf8(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("hashes a short single-block input ('abc')", () => {
    expect(sha256HexSync(utf8("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes an input spanning more than one 512-bit block", () => {
    const message = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(sha256HexSync(utf8(message))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  it("hashes a multi-block binary buffer, matching node:crypto", () => {
    const bytes = new Uint8Array(1000).fill(0x61); // 'a' repeated
    const expected = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    expect(sha256HexSync(bytes)).toBe(expected);
  });
});

describe("sha256Hex", () => {
  // vitest's node environment always has crypto.subtle, so this exercises
  // the WebCrypto path — the pure fallback below is what actually runs on
  // an iPad over plain http, and is covered directly by sha256HexSync above.
  const lengths = [0, 1, 55, 56, 64, 65, 1000];

  it.each(lengths)("agrees with the pure fallback for a %i-byte buffer", async (length) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = i % 251;

    const fromWebCrypto = await sha256Hex(bytes.buffer);
    const fromFallback = sha256HexSync(bytes);

    expect(fromWebCrypto).toBe(fromFallback);
  });
});
