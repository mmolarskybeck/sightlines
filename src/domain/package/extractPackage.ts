import { unzip, type UnzipFileInfo, type Unzipped } from "fflate";
import { MAX_IMPORT_JSON_LENGTH } from "../schema/projectSchema";
import { MANIFEST_PATH } from "./buildPackage";

// The zip safety layer (docs/plan.md §13): a .sightlines file is untrusted
// input, so every cap is enforced against the zip directory's declared sizes
// BEFORE any entry is inflated — a decompression bomb is rejected from its
// headers, not discovered after it has filled memory.
//
// Cap rationale (documented in docs/package-format.md):
// - ENTRY_COUNT 4096: a large show (10 rooms / 200 works, §4.2) at three tiers
//   per work is ~600 blobs; 4096 leaves generous headroom without letting a
//   million-entry zip stall the directory walk.
// - ENTRY_BYTES 256 MB: above any plausible single museum scan, far below
//   anything that could exhaust a tab on its own.
// - TOTAL_BYTES 2 GB: the whole package inflates into memory today, so the
//   total cap is what actually bounds peak usage.
// - manifest.json: same 20 MB cap as bare project-JSON import.
export const MAX_PACKAGE_ENTRY_COUNT = 4096;
export const MAX_PACKAGE_ENTRY_BYTES = 256 * 1024 * 1024;
export const MAX_PACKAGE_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_PACKAGE_MANIFEST_BYTES = MAX_IMPORT_JSON_LENGTH;

export type PackageEntryInfo = {
  name: string;
  originalSize: number;
};

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

// Directory entries ("assets/") are structural noise some zip tools emit;
// they carry no bytes and are skipped rather than rejected.
function isDirectoryEntry(name: string): boolean {
  return name.endsWith("/");
}

// A hostile path means a hostile file: reject the whole package rather than
// skipping the entry. Windows separators, absolute paths, drive letters,
// `..` segments, and empty segments (`a//b`) all fail.
export function isSafeEntryPath(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes("\\")) return false;
  if (name.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  return name.split("/").every((segment) => segment.length > 0 && segment !== "..");
}

// Only these paths mean anything to the format. Unknown-but-safe extra
// entries are IGNORED (never inflated), so a future package version can add
// e.g. a views/ folder without breaking older apps — forward compatibility
// per docs/package-format.md.
export function isMeaningfulEntryPath(name: string): boolean {
  return name === MANIFEST_PATH || name.startsWith("assets/");
}

// Pure inventory validation, separated from the zip walk so the cap matrix is
// unit-testable without fabricating multi-gigabyte archives.
export function validatePackageInventory(entries: PackageEntryInfo[]): void {
  const files = entries.filter((entry) => !isDirectoryEntry(entry.name));

  for (const entry of files) {
    if (!isSafeEntryPath(entry.name)) {
      throw new Error(`the package contains an unsafe file path (${entry.name}).`);
    }
  }

  if (files.length > MAX_PACKAGE_ENTRY_COUNT) {
    throw new Error(
      `the package contains too many files (${files.length}; the limit is ${MAX_PACKAGE_ENTRY_COUNT}).`
    );
  }

  let total = 0;
  for (const entry of files) {
    const cap = entry.name === MANIFEST_PATH ? MAX_PACKAGE_MANIFEST_BYTES : MAX_PACKAGE_ENTRY_BYTES;
    if (entry.originalSize > cap) {
      throw new Error(
        `the package contains a file that is too large (${entry.name}, ${formatMegabytes(entry.originalSize)}; the limit is ${formatMegabytes(cap)}).`
      );
    }
    total += entry.originalSize;
    if (total > MAX_PACKAGE_TOTAL_BYTES) {
      throw new Error(
        `the package is too large to import (over ${formatMegabytes(MAX_PACKAGE_TOTAL_BYTES)} uncompressed).`
      );
    }
  }
}

function unzipWithFilter(
  bytes: Uint8Array,
  filter: (info: UnzipFileInfo) => boolean
): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter }, (error, data) => {
      if (error) reject(new Error("the file is not a readable zip archive."));
      else resolve(data);
    });
  });
}

// Two passes over the zip: pass 1 walks the directory with a filter that
// admits nothing (no inflation) to build the inventory; the caps and path
// rules run against that; only then does pass 2 inflate the meaningful
// entries. Nothing is decompressed before the whole archive has passed
// validation.
export async function extractPackageEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const inventory: PackageEntryInfo[] = [];
  await unzipWithFilter(bytes, (info) => {
    inventory.push({ name: info.name, originalSize: info.originalSize });
    return false;
  });

  if (inventory.length === 0) {
    throw new Error("the file is not a Sightlines package (empty or unreadable archive).");
  }

  validatePackageInventory(inventory);

  const wanted = new Set(
    inventory
      .map((entry) => entry.name)
      .filter((name) => !isDirectoryEntry(name) && isMeaningfulEntryPath(name))
  );

  const unzipped = await unzipWithFilter(bytes, (info) => wanted.has(info.name));
  return new Map(Object.entries(unzipped));
}
