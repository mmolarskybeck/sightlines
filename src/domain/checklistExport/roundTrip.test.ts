// The contract that makes this export worth having: a file Sightlines wrote
// must come back through Sightlines' own import wizard without hand-mapping a
// single column. The header strings in rows.ts exist to satisfy FIELD_ALIASES
// in spreadsheetImport/columnMapping.ts — this test is what stops someone
// "tidying" one of them.
import { describe, expect, it } from "vitest";
import { CURRENT_ARTWORK_SCHEMA_VERSION, type Artwork } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { guessColumnMapping } from "../spreadsheetImport/columnMapping";
import { createImportTable, parseImportWorkbook } from "../spreadsheetImport/workbook";
import type { ImportField } from "../spreadsheetImport/types";
import { buildChecklistExportRows, buildChecklistExportTable } from "./rows";
import { writeChecklistCsv, writeChecklistXlsx } from "./workbook";

function libraryArtwork(id: string, overrides: Partial<Artwork> = {}): Artwork {
  return {
    id,
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    artist: "Agnes Martin",
    title: `Untitled ${id}`,
    date: "1974",
    accessionNumber: `1979.620.${id}`,
    locationOrLender: "Collection of the artist",
    creditLine: "Courtesy of the artist and Gallery X",
    dimensions: { status: "known", widthMm: 1830, heightMm: 1830 },
    metadata: { medium: "Acrylic and graphite on canvas" },
    ...overrides
  };
}

function exportedTable() {
  const project = { ...createSampleProject(), checklistArtworkIds: ["1", "2", "3"] };
  const library = ["1", "2", "3"].map((id) => libraryArtwork(id));
  const rows = buildChecklistExportRows(project, library);
  return { project, table: buildChecklistExportTable({ project, rows }) };
}

// header label -> the field the wizard guessed for it.
function mappedFields(bytes: Uint8Array, filename: string) {
  return (async () => {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const workbook = await parseImportWorkbook(buffer, filename);
    const table = createImportTable(workbook, workbook.sheets[0].name);
    const { mapping } = guessColumnMapping(table);
    const labelByIndex = new Map(table.columns.map((column) => [column.index, column.label]));
    return new Map(
      Object.entries(mapping).map(([field, index]) => [
        field as ImportField,
        labelByIndex.get(index as number)
      ])
    );
  })();
}

const EXPECTED: [ImportField, string][] = [
  ["artist", "Artist"],
  ["title", "Title"],
  ["date", "Date"],
  ["medium", "Medium"],
  ["dimensions", "Dimensions"],
  ["height", "Height (in)"],
  ["width", "Width (in)"],
  ["depth", "Depth (in)"],
  ["accessionNumber", "Object number"],
  ["locationOrLender", "Location / Lender"],
  ["creditLine", "Credit line"],
  ["imageFilename", "Image file"]
];

describe("checklist export → import wizard round trip", () => {
  it("maps every core column from the exported CSV, with no hand-mapping", async () => {
    const { table } = exportedTable();
    const fields = await mappedFields(writeChecklistCsv(table), "checklist.csv");

    for (const [field, header] of EXPECTED) {
      expect([field, fields.get(field)]).toEqual([field, header]);
    }
  });

  it("maps every core column from the exported xlsx too", async () => {
    const { table } = exportedTable();
    const fields = await mappedFields(await writeChecklistXlsx(table), "checklist.xlsx");

    for (const [field, header] of EXPECTED) {
      expect([field, fields.get(field)]).toEqual([field, header]);
    }
  });

  it("does not let a non-artwork column claim a field", async () => {
    const { table } = exportedTable();
    const fields = await mappedFields(writeChecklistCsv(table), "checklist.csv");
    const claimed = new Set(fields.values());

    // Row, Framing, Status, Room and Wall describe the export, not the work.
    for (const header of ["Row", "Framing", "Status", "Room", "Wall"]) {
      expect(claimed.has(header)).toBe(false);
    }
  });

  // A bare "#" IS an object-number alias (collection exports head that column
  // with nothing else), so the index column has to be headed "Row" or our own
  // file would re-import its row numbers as object numbers. This is the
  // assertion that keeps the two decisions in step.
  it("keeps its row index out of the object-number field", async () => {
    const { table } = exportedTable();
    expect(table.headers[0]).toBe("Row");

    const fields = await mappedFields(writeChecklistCsv(table), "checklist.csv");
    expect(fields.get("accessionNumber")).toBe("Object number");

    // Proof the hazard is real rather than hypothetical: with no other
    // object-number column in the file, a bare "#" header claims the field —
    // which is exactly what our index column would have done to itself.
    const objectNumberIndex = table.headers.indexOf("Object number");
    const withoutObjectNumber = <T,>(cells: T[]) =>
      cells.filter((_cell, index) => index !== objectNumberIndex);
    const hashTable = {
      headers: withoutObjectNumber(table.headers).map((header, index) =>
        index === 0 ? "#" : header
      ),
      rows: table.rows.map(withoutObjectNumber)
    };
    const hashFields = await mappedFields(writeChecklistCsv(hashTable), "hash.csv");
    expect(hashFields.get("accessionNumber")).toBe("#");
  });
});
