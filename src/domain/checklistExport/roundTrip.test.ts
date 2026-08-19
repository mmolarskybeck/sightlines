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
    locationOrLender: "Gift of the artist",
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
  ["accessionNumber", "Accession number"],
  ["locationOrLender", "Location / Lender"],
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

    // "#", Framing, Status, Room and Wall describe the export, not the work.
    for (const header of ["#", "Framing", "Status", "Room", "Wall"]) {
      expect(claimed.has(header)).toBe(false);
    }
  });
});
