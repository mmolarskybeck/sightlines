import { describe, expect, it } from "vitest";
import {
  makeArtwork,
  makeFixture,
  readZipCompressionMethods
} from "../package/packageTestFixtures";
import { readSightlinesZip } from "../package/zipPackage";
import type { ChecklistExportOptions } from "./types";
import {
  buildChecklistExport,
  CSV_MIME_TYPE,
  XLSX_MIME_TYPE,
  ZIP_MIME_TYPE
} from "./buildChecklistExport";

const BASE_OPTIONS: ChecklistExportOptions = {
  format: "xlsx",
  images: "display",
  sort: "project",
  placedOnly: false
};

function build(
  overrides: Partial<ChecklistExportOptions> = {},
  fixture = makeFixture()
) {
  return buildChecklistExport({
    project: fixture.project,
    libraryArtworks: fixture.library,
    options: { ...BASE_OPTIONS, ...overrides },
    getAsset: fixture.getAsset,
    getBlob: fixture.getBlob
  });
}

async function readSheetText(bytes: Uint8Array, path: string): Promise<string> {
  // A bare CSV (images: "none") is returned unzipped; everything else is a zip.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return new TextDecoder().decode(bytes);
  const entries = await readSightlinesZip(bytes);
  return new TextDecoder().decode(entries[path]);
}

describe("buildChecklistExport", () => {
  it("returns a bare .xlsx when there is nothing to bundle with it", async () => {
    const result = await build({ images: "none" });

    expect(result.filename).toBe("untitled-exhibition-checklist.xlsx");
    expect(result.mimeType).toBe(XLSX_MIME_TYPE);
    expect([result.bytes[0], result.bytes[1]]).toEqual([0x50, 0x4b]);
    expect(result.warnings).toEqual([]);
  });

  it("returns a bare .csv when images are off", async () => {
    const result = await build({ format: "csv", images: "none" });

    expect(result.filename).toBe("untitled-exhibition-checklist.csv");
    expect(result.mimeType).toBe(CSV_MIME_TYPE);
    expect([result.bytes[0], result.bytes[1], result.bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("zips the sheet with an images/ folder when images are included", async () => {
    const result = await build({ images: "display" });

    expect(result.filename).toBe("untitled-exhibition-checklist.zip");
    expect(result.mimeType).toBe(ZIP_MIME_TYPE);

    const entries = await readSightlinesZip(result.bytes);
    const paths = Object.keys(entries).sort();
    expect(paths).toHaveLength(3);
    expect(paths[0]).toBe("checklist.xlsx");
    expect(paths.slice(1).every((path) => path.startsWith("images/"))).toBe(true);
  });

  it("stores image bytes uncompressed and deflates the sheet", async () => {
    const result = await build({ images: "display" });
    const methods = readZipCompressionMethods(result.bytes);

    expect(methods.get("checklist.xlsx")).toBe(8);
    for (const [path, method] of methods) {
      if (path.startsWith("images/")) expect(method).toBe(0);
    }
  });

  it("puts a CSV in the zip and points the Image file column at images/", async () => {
    const result = await build({ format: "csv", images: "display" });
    const entries = await readSightlinesZip(result.bytes);
    const csvBytes = entries["checklist.csv"];
    // BOM checked on the bytes — TextDecoder strips it on the way out.
    expect([csvBytes[0], csvBytes[1], csvBytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await readSheetText(result.bytes, "checklist.csv");

    const lines = text.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0].startsWith("#,Artist,Title,Date,Medium,Dimensions,")).toBe(true);
    expect(lines[1]).toContain("images/001_Artwork-art-placed.webp");
    expect(lines[1]).toContain("Placed");
    expect(lines[2]).toContain("Unplaced");
  });

  it("respects the placed-only filter", async () => {
    const result = await build({ format: "csv", placedOnly: true });
    const text = await readSheetText(result.bytes, "checklist.csv");
    const lines = text.replace(/^\uFEFF/, "").trim().split("\r\n");

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Placed");
  });

  it("numbers rows in the sorted order, not the checklist order", async () => {
    const fixture = makeFixture();
    fixture.library = [
      makeArtwork("art-placed", { assetId: "asset-1", title: "Zebra" }),
      makeArtwork("art-unplaced", { assetId: "asset-2", title: "Aardvark" })
    ];
    const result = await build({ format: "csv", sort: "title", images: "none" }, fixture);
    const text = await readSheetText(result.bytes, "checklist.csv");
    const lines = text.replace(/^\uFEFF/, "").trim().split("\r\n");

    expect(lines[1].startsWith("1,,Aardvark")).toBe(true);
    expect(lines[2].startsWith("2,,Zebra")).toBe(true);
  });

  it("falls back down the tier list rather than dropping an image", async () => {
    const fixture = makeFixture();
    // "originals" prefers the original tier; evicting it must still yield the
    // display rendition rather than a blank Image file cell.
    fixture.blobs.delete(fixture.assets.get("asset-1")!.originalKey);
    const result = await build({ format: "csv", images: "originals" }, fixture);
    const text = await readSheetText(result.bytes, "checklist.csv");

    expect(result.warnings).toEqual([]);
    expect(text).toContain("images/001_Artwork-art-placed.webp");
  });

  it("warns and blanks the cell when every tier is missing, and never throws", async () => {
    const fixture = makeFixture();
    const asset = fixture.assets.get("asset-1")!;
    fixture.blobs.delete(asset.originalKey);
    fixture.blobs.delete(asset.displayKey);
    fixture.blobs.delete(asset.thumbnailKey);

    const result = await build({ format: "csv", images: "display" }, fixture);
    const text = await readSheetText(result.bytes, "checklist.csv");

    expect(result.warnings).toEqual([
      "Artwork art-placed: its image file is missing; exported without an image."
    ]);
    expect(text).not.toContain("Artwork-art-placed");
  });

  it("warns when a checklist id has no library record, and still exports the row", async () => {
    const fixture = makeFixture();
    fixture.library = fixture.library.filter((artwork) => artwork.id !== "art-unplaced");

    const result = await build({ format: "csv", images: "none" }, fixture);
    const text = await readSheetText(result.bytes, "checklist.csv");
    const lines = text.replace(/^\uFEFF/, "").trim().split("\r\n");

    expect(result.warnings).toEqual([
      "art-unplaced: its artwork record is missing from the library; exported as a blank row."
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[2].startsWith("2,,,")).toBe(true);
  });

  it("reuses one image file when two checklist works share an asset", async () => {
    const fixture = makeFixture();
    fixture.library = [
      makeArtwork("art-placed", { assetId: "asset-1" }),
      makeArtwork("art-unplaced", { assetId: "asset-1" })
    ];
    const result = await build({ images: "display" }, fixture);
    const entries = await readSightlinesZip(result.bytes);

    expect(Object.keys(entries).filter((path) => path.startsWith("images/"))).toHaveLength(1);
  });
});
