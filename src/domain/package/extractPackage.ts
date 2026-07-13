import { unzip, type UnzipFileInfo, type Unzipped } from "fflate";
import { MAX_IMPORT_JSON_LENGTH } from "../schema/projectSchema";
import { MANIFEST_PATH } from "./buildPackage";

// Enforce all archive caps before inflation to reject decompression bombs.
//
// These limits leave headroom for large shows while bounding tab memory use.
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

// Skip zero-byte directory entries emitted by some zip tools.
function isDirectoryEntry(name: string): boolean {
  return name.endsWith("/");
}

// Reject unsafe paths rather than silently skipping them.
export function isSafeEntryPath(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes("\\")) return false;
  if (name.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  return name.split("/").every((segment) => segment.length > 0 && segment !== "..");
}

// Ignore unknown safe paths without inflating them for forward compatibility.
export function isMeaningfulEntryPath(name: string): boolean {
  return name === MANIFEST_PATH || name.startsWith("assets/");
}

// Kept pure so size limits can be tested without large archives.
export function validatePackageInventory(entries: PackageEntryInfo[]): void {
  const files = entries.filter((entry) => !isDirectoryEntry(entry.name));

  const seenPaths = new Set<string>();
  for (const entry of entries) {
    if (seenPaths.has(entry.name)) {
      throw new Error(`the package contains a duplicate file path (${entry.name}).`);
    }
    seenPaths.add(entry.name);
  }

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

// Inventory first without inflation; inflate meaningful entries only after validation.
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
