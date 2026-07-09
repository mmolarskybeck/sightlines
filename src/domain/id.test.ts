import { describe, expect, it } from "vitest";
import { newId, uuidV4FromBytes } from "./id";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  // vitest's environment always has crypto.randomUUID, so this exercises the
  // fast path — the pure getRandomValues fallback below is what actually runs
  // on an iPad over plain http, and is covered directly by uuidV4FromBytes.
  it("returns a spec-shaped UUID v4", () => {
    expect(newId()).toMatch(UUID_V4_PATTERN);
  });

  it("produces distinct values across repeated calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });
});

describe("uuidV4FromBytes", () => {
  it("matches the UUID v4 pattern and stamps version/variant for all-zero bytes", () => {
    const bytes = new Uint8Array(16).fill(0x00);
    expect(uuidV4FromBytes(bytes)).toMatch(UUID_V4_PATTERN);
  });

  it("matches the UUID v4 pattern and stamps version/variant for all-0xff bytes", () => {
    const bytes = new Uint8Array(16).fill(0xff);
    expect(uuidV4FromBytes(bytes)).toMatch(UUID_V4_PATTERN);
  });

  it("formats bytes as lowercase 8-4-4-4-12 hex", () => {
    const bytes = Uint8Array.from([
      0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x00, 0xde, 0x00, 0xf0, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x66
    ]);
    // byte 6 (0x00) gets its top nibble forced to 4 → 0x40; byte 8 (0x00) gets
    // its top two bits forced to 10 → 0x80.
    expect(uuidV4FromBytes(bytes)).toBe("12345678-9abc-40de-80f0-112233445566");
  });
});
