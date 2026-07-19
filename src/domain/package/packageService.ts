// Pure package-builder service: turns a project plus its library/asset seams
// into a downloadable .sightlines package with no store side effects. Both the
// manual export slice (packageSlice) and cloud backup consume this — the slice
// keeps its own error-banner handling; the service only builds or throws.
//
// The derivation itself lives in buildPackage (createSightlinesPackage owns the
// manifest + zip; tiersForMode/writeSightlinesZip are its building blocks); this
// wraps it with the two shapes callers actually want: a Blob (for upload) and
// the raw zip bytes (for a browser download), under the package's filename.

import type { Artwork, Asset, Project } from "../project";
import type { PackageExportMode } from "../schema/packageSchema";
import { createSightlinesPackage, packageFilename } from "./buildPackage";

// A .sightlines package is a zip container; octet-stream is the neutral type
// the download path already uses and the upload path can hand to any provider.
export const SIGHTLINES_PACKAGE_MIME_TYPE = "application/octet-stream";

export type BuildProjectPackageInput = {
  project: Project;
  // Only referenced records ship; buildPackage filters the union down.
  libraryArtworks: Artwork[];
  mode: PackageExportMode;
  // Repository seams keep the service browser- and store-independent.
  getAsset: (assetId: string) => Promise<Asset>;
  getBlob: (key: string) => Promise<Blob>;
};

export type BuiltProjectPackage = {
  // Ready to upload as-is (cloud backup) …
  blob: Blob;
  // … or to hand raw to the browser download path (manual export).
  zip: Uint8Array;
  filename: string;
  warnings: string[];
};

// Copy into a fresh ArrayBuffer-backed part so Blob's part type is satisfied
// regardless of what pooled buffer the zip inflated into (fflate may hand back
// a view into a larger buffer).
function packageBytesToBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: SIGHTLINES_PACKAGE_MIME_TYPE });
}

// Build the package or throw. No store reads or writes — the caller decides how
// to surface a failure.
export async function buildProjectPackage(
  input: BuildProjectPackageInput
): Promise<BuiltProjectPackage> {
  const { zip, warnings } = await createSightlinesPackage({
    project: input.project,
    libraryArtworks: input.libraryArtworks,
    mode: input.mode,
    getAsset: input.getAsset,
    getBlob: input.getBlob
  });
  return {
    blob: packageBytesToBlob(zip),
    zip,
    filename: packageFilename(input.project),
    warnings
  };
}
