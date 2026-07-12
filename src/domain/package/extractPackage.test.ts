import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  MAX_PACKAGE_ENTRY_BYTES,
  MAX_PACKAGE_ENTRY_COUNT,
  MAX_PACKAGE_MANIFEST_BYTES,
  MAX_PACKAGE_TOTAL_BYTES,
  extractPackageEntries,
  isSafeEntryPath,
  validatePackageInventory
} from "./extractPackage";

const enc = new TextEncoder();

describe("isSafeEntryPath", () => {
  it("accepts the package's own layout", () => {
    expect(isSafeEntryPath("manifest.json")).toBe(true);
    expect(isSafeEntryPath("assets/abc123.webp")).toBe(true);
  });

  it("rejects traversal, absolute, drive-letter, backslash, and empty-segment paths", () => {
    expect(isSafeEntryPath("../evil.json")).toBe(false);
    expect(isSafeEntryPath("assets/../../evil")).toBe(false);
    expect(isSafeEntryPath("/etc/passwd")).toBe(false);
    expect(isSafeEntryPath("C:evil")).toBe(false);
    expect(isSafeEntryPath("assets\\evil.webp")).toBe(false);
    expect(isSafeEntryPath("assets//evil")).toBe(false);
    expect(isSafeEntryPath("")).toBe(false);
  });
});

describe("validatePackageInventory (caps run on declared sizes, pre-inflation)", () => {
  it("rejects too many entries", () => {
    const entries = Array.from({ length: MAX_PACKAGE_ENTRY_COUNT + 1 }, (_, i) => ({
      name: `assets/${i}.webp`,
      originalSize: 1
    }));
    expect(() => validatePackageInventory(entries)).toThrow(/too many files/);
  });

  it("rejects a single oversized entry", () => {
    expect(() =>
      validatePackageInventory([
        { name: "assets/huge.webp", originalSize: MAX_PACKAGE_ENTRY_BYTES + 1 }
      ])
    ).toThrow(/too large/);
  });

  it("caps manifest.json tighter than blobs", () => {
    expect(() =>
      validatePackageInventory([
        { name: "manifest.json", originalSize: MAX_PACKAGE_MANIFEST_BYTES + 1 }
      ])
    ).toThrow(/too large/);
    // The same size is fine for a blob entry.
    expect(() =>
      validatePackageInventory([
        { name: "assets/big.webp", originalSize: MAX_PACKAGE_MANIFEST_BYTES + 1 }
      ])
    ).not.toThrow();
  });

  it("rejects when the declared total exceeds the cap", () => {
    // Each entry individually passes the per-entry cap; the sum does not.
    const count = Math.ceil(MAX_PACKAGE_TOTAL_BYTES / MAX_PACKAGE_ENTRY_BYTES) + 1;
    const entries = Array.from({ length: count }, (_, i) => ({
      name: `assets/${i}.webp`,
      originalSize: MAX_PACKAGE_ENTRY_BYTES
    }));
    expect(() => validatePackageInventory(entries)).toThrow(/too large to import/);
  });

  it("rejects any unsafe path", () => {
    expect(() =>
      validatePackageInventory([{ name: "../outside.json", originalSize: 4 }])
    ).toThrow(/unsafe file path/);
  });

  it("ignores directory entries", () => {
    expect(() =>
      validatePackageInventory([
        { name: "assets/", originalSize: 0 },
        { name: "assets/a.webp", originalSize: 4 }
      ])
    ).not.toThrow();
  });
});

describe("extractPackageEntries", () => {
  it("extracts manifest and asset entries from a well-formed zip", async () => {
    const zip = zipSync({
      "manifest.json": enc.encode("{}"),
      "assets/a.webp": new Uint8Array([1, 2, 3])
    });

    const files = await extractPackageEntries(zip);

    expect([...files.keys()].sort()).toEqual(["assets/a.webp", "manifest.json"]);
    expect(files.get("assets/a.webp")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects the whole package when any entry path traverses", async () => {
    const zip = zipSync({
      "manifest.json": enc.encode("{}"),
      "../evil.sh": enc.encode("#!")
    });

    await expect(extractPackageEntries(zip)).rejects.toThrow(/unsafe file path/);
  });

  it("ignores unknown-but-safe extra entries (forward compatibility)", async () => {
    const zip = zipSync({
      "manifest.json": enc.encode("{}"),
      "views/preview.json": enc.encode("{}")
    });

    const files = await extractPackageEntries(zip);

    expect(files.has("manifest.json")).toBe(true);
    expect(files.has("views/preview.json")).toBe(false);
  });

  it("rejects bytes that are not a zip archive", async () => {
    await expect(extractPackageEntries(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
      /not a readable zip archive/
    );
  });

  it("rejects an empty archive as not a package", async () => {
    await expect(extractPackageEntries(zipSync({}))).rejects.toThrow(/not a Sightlines package/);
  });
});
