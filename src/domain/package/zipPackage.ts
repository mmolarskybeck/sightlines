import { unzip, zip, type AsyncZippable, type Unzipped } from "fflate";
import type { PackageZipFile } from "./buildPackage";

// fflate's async zip runs off the main thread (Web Worker in the browser,
// worker_threads in Node), so a large project doesn't freeze the UI while it
// packs — no dedicated worker of our own required for this slice
// (docs/plan.md §4.5). Per-file compression: image blobs at level 0 (store,
// no recompression of already-compressed bytes) and the JSON manifest deflated.
export function writeSightlinesZip(files: PackageZipFile[]): Promise<Uint8Array> {
  const zippable: AsyncZippable = {};
  for (const file of files) {
    zippable[file.path] = [file.bytes, { level: file.compression === "store" ? 0 : 6 }];
  }

  return new Promise((resolve, reject) => {
    zip(zippable, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

// Inverse, used by tests here and by the future import slice. Kept async to match
// the writer and to stay off the main thread; the import safety pipeline
// (docs/plan.md §13 — path-traversal / size / count caps) layers on top of this.
export function readSightlinesZip(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}
