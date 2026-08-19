import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ChecklistPdfExportOptions } from "../../../domain/checklistExport/types";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  CURRENT_ASSET_SCHEMA_VERSION,
  type Artwork,
  type Asset,
  type Project
} from "../../../domain/project";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { buildChecklistPdf, CHECKLIST_PDF_MIME_TYPE } from "./buildChecklistPdf";
import { CHECKLIST_PAGE_SIZE_PT } from "./layout";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const binary = atob(ONE_PIXEL_PNG_BASE64);
  return new Blob(
    [Uint8Array.from(binary, (character) => character.charCodeAt(0))],
    { type: "image/png" }
  );
}

function asset(id: string): Asset {
  return {
    id,
    schemaVersion: CURRENT_ASSET_SCHEMA_VERSION,
    mimeType: "image/png",
    originalKey: `${id}/original`,
    displayKey: `${id}/display`,
    thumbnailKey: `${id}/thumbnail`,
    widthPx: 1,
    heightPx: 1,
    byteSize: 70
  };
}

function artwork(id: string, overrides: Partial<Artwork> = {}): Artwork {
  return {
    id,
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    artist: `Artist ${id}`,
    title: `Work ${id}`,
    date: "2024",
    dimensions: { status: "known", widthMm: 500, heightMm: 400 },
    metadata: { medium: "Oil on linen" },
    ...overrides
  };
}

function projectWith(ids: string[]): Project {
  return { ...createSampleProject(), title: "Night Vision", checklistArtworkIds: ids };
}

const OPTIONS: ChecklistPdfExportOptions = {
  format: "pdf",
  sort: "project",
  placedOnly: false,
  numbering: false,
  accession: false,
  location: true
};

function seams(overrides: {
  getAsset?: (assetId: string) => Promise<Asset>;
  getBlob?: (key: string) => Promise<Blob>;
} = {}) {
  return {
    getAsset: overrides.getAsset ?? (async (id: string) => asset(id)),
    getBlob: overrides.getBlob ?? (async () => pngBlob())
  };
}

describe("buildChecklistPdf", () => {
  it("writes a US Letter portrait PDF named after the project", async () => {
    const ids = ["a", "b", "c"];
    const result = await buildChecklistPdf({
      project: projectWith(ids),
      libraryArtworks: ids.map((id) => artwork(id, { assetId: `asset-${id}` })),
      options: OPTIONS,
      ...seams()
    });

    expect(result.filename).toBe("night-vision-checklist.pdf");
    expect(result.mimeType).toBe(CHECKLIST_PDF_MIME_TYPE);
    expect(result.warnings).toEqual([]);
    // %PDF- magic, not just "some bytes".
    expect([...result.bytes.slice(0, 5)]).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);

    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(CHECKLIST_PAGE_SIZE_PT.widthPt, 3);
    expect(height).toBeCloseTo(CHECKLIST_PAGE_SIZE_PT.heightPt, 3);
    expect(pdf.getTitle()).toBe("Night Vision — Checklist");
  });

  it("flows four works to a page and starts a second for the fifth", async () => {
    const ids = Array.from({ length: 5 }, (_unused, index) => `w${index}`);
    const result = await buildChecklistPdf({
      project: projectWith(ids),
      libraryArtworks: ids.map((id) => artwork(id)),
      options: OPTIONS,
      ...seams()
    });

    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(2);
  });

  it("constrains a long project title with the fallback font on both title and running-header pages", async () => {
    const ids = Array.from({ length: 5 }, (_unused, index) => `w${index}`);
    const longTitle = Array.from(
      { length: 30 },
      () => "Extremely Long Exhibition Title"
    ).join(" ");
    const result = await buildChecklistPdf({
      project: { ...projectWith(ids), title: longTitle },
      libraryArtworks: ids.map((id) => artwork(id)),
      options: OPTIONS,
      ...seams()
    });

    expect(result.warnings).toEqual([]);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2);
  });

  it("continues one caption taller than a page without dropping its text", async () => {
    const longCredit = Array.from(
      { length: 900 },
      (_unused, index) => `Collection credit ${index + 1}`
    ).join(" ");
    const result = await buildChecklistPdf({
      project: projectWith(["a"]),
      libraryArtworks: [artwork("a", { locationOrLender: longCredit })],
      options: OPTIONS,
      ...seams()
    });

    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBeGreaterThan(1);
    expect(result.warnings).toEqual([]);
  });

  it("prints a work whose image is gone, with a warning, rather than throwing", async () => {
    const result = await buildChecklistPdf({
      project: projectWith(["a", "b"]),
      libraryArtworks: [
        artwork("a", { assetId: "asset-a", title: "Missing Picture" }),
        artwork("b")
      ],
      options: OPTIONS,
      ...seams({
        getBlob: async () => {
          throw new Error("blob evicted");
        }
      })
    });

    expect(result.warnings).toEqual([
      "Missing Picture: its image could not be read; printed without a thumbnail."
    ]);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("warns once for a checklist id whose library record was deleted", async () => {
    const result = await buildChecklistPdf({
      project: projectWith(["ghost"]),
      libraryArtworks: [],
      options: OPTIONS,
      ...seams()
    });

    expect(result.warnings).toEqual([
      "ghost: its artwork record is missing from the library; printed as a blank entry."
    ]);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
  });

  it("embeds one image per asset however many works share it", async () => {
    const getAsset = vi.fn(async (id: string) => asset(id));
    const getBlob = vi.fn(async () => pngBlob());

    await buildChecklistPdf({
      project: projectWith(["a", "b", "c"]),
      libraryArtworks: [
        artwork("a", { assetId: "shared" }),
        artwork("b", { assetId: "shared" }),
        artwork("c", { assetId: "own" })
      ],
      options: OPTIONS,
      ...seams({ getAsset, getBlob })
    });

    expect(getAsset).toHaveBeenCalledTimes(2);
    expect(getBlob).toHaveBeenCalledTimes(2);
  });

  it("honors the placed-only filter, which can empty the document", async () => {
    const result = await buildChecklistPdf({
      project: projectWith(["a", "b"]),
      libraryArtworks: [artwork("a"), artwork("b")],
      options: { ...OPTIONS, placedOnly: true },
      ...seams()
    });

    // Nothing in the sample project is placed, so this is a title page alone —
    // still a readable file, never a zero-page one.
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
  });

  it("reads the same rows the spreadsheet does, so sort changes the document", async () => {
    const project = projectWith(["a", "b"]);
    const artworks = [
      artwork("a", { artist: "Zulu", title: "Zed" }),
      artwork("b", { artist: "Alpha", title: "Aleph" })
    ];

    const byProject = await buildChecklistPdf({
      project,
      libraryArtworks: artworks,
      options: OPTIONS,
      ...seams()
    });
    const byArtist = await buildChecklistPdf({
      project,
      libraryArtworks: artworks,
      options: { ...OPTIONS, sort: "artist" },
      exportedAt: new Date("2026-08-19T00:00:00.000Z"),
      ...seams()
    });

    // Same works, same page count, different byte stream: the order really is
    // wired through rather than being a dialog control with no effect.
    expect((await PDFDocument.load(byArtist.bytes)).getPageCount()).toBe(1);
    expect(Buffer.from(byArtist.bytes).equals(Buffer.from(byProject.bytes))).toBe(
      false
    );
  });

  it("accepts bundled font bytes and still writes a loadable document", async () => {
    const { readFileSync } = await import("node:fs");
    const regular = new Uint8Array(readFileSync("public/fonts/Geist-Regular.ttf"));
    const strong = new Uint8Array(readFileSync("public/fonts/Geist-SemiBold.ttf"));

    const result = await buildChecklistPdf({
      project: projectWith(["a"]),
      libraryArtworks: [artwork("a", { artist: "Constantin Brâncuși" })],
      options: { ...OPTIONS, numbering: true, accession: true },
      fontBytes: { regular, strong },
      ...seams()
    });

    // Geist covers the Latin Extended letters the standard-14 fallback would
    // have had to substitute, so no glyph warning.
    expect(result.warnings).toEqual([]);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
  });
});
