import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { createImportTable, parseImportWorkbook } from "./workbook";

// Builds an in-memory workbook of the given aoa (array-of-arrays) rows and
// serializes it to the requested legacy/modern Excel binary — so the .xls and
// .xlsx paths are exercised without shipping a binary fixture or referencing
// any file on disk.
function excelBuffer(rows: unknown[][], bookType: "xls" | "xlsx"): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  const out = XLSX.write(book, { type: "array", bookType, cellDates: true });
  return out instanceof ArrayBuffer ? out : new Uint8Array(out).buffer;
}

describe("parseImportWorkbook", () => {
  it("parses quoted CSV text into an import table", async () => {
    const csv = [
      "title,artist_name,image_path",
      "\"Mona Lisa\",\"Leonardo, da Vinci\",images/mona-lisa.jpg"
    ].join("\n");

    const workbook = await parseImportWorkbook(new TextEncoder().encode(csv).buffer, "metadata.csv");
    const table = createImportTable(workbook, "Sheet1");

    expect(table.columns.map((column) => column.label)).toEqual([
      "title",
      "artist_name",
      "image_path"
    ]);
    expect(table.rows[0].values).toEqual([
      "Mona Lisa",
      "Leonardo, da Vinci",
      "images/mona-lisa.jpg"
    ]);
  });

  it("parses a legacy .xls workbook, normalizing dates to ISO", async () => {
    const buffer = excelBuffer(
      [
        ["Title", "Artist", "Date"],
        ["Mona Lisa", "Leonardo", new Date(Date.UTC(1980, 4, 20, 12))]
      ],
      "xls"
    );

    const workbook = await parseImportWorkbook(buffer, "checklist.xls");
    const table = createImportTable(workbook, "Sheet1");

    expect(table.columns.map((column) => column.label)).toEqual(["Title", "Artist", "Date"]);
    expect(table.rows[0].values[0]).toBe("Mona Lisa");
    expect(table.rows[0].values[1]).toBe("Leonardo");
    expect(table.rows[0].values[2]).toBe("1980-05-20");
  });

  it("parses an .xlsx workbook and drops fully empty sheets from the preview", async () => {
    const buffer = excelBuffer(
      [
        ["Title", "Artist"],
        ["The Starry Night", "Vincent van Gogh"]
      ],
      "xlsx"
    );

    const workbook = await parseImportWorkbook(buffer, "checklist.xlsx");
    const table = createImportTable(workbook, "Sheet1");

    expect(table.rows[0].values).toEqual(["The Starry Night", "Vincent van Gogh"]);
  });
});
