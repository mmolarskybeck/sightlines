// Spreadsheet writers for the checklist export. Both take the same pure table
// (headers + cells) so the two formats can never drift apart in content —
// only in encoding.
import type { ChecklistExportCell, ChecklistExportTable } from "./types";

export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_MIME_TYPE = "text/csv";

// The single worksheet's tab name.
const SHEET_NAME = "Checklist";

// Cells needing quotes per RFC 4180, plus leading/trailing spaces (which Excel
// otherwise eats) — the quote is free insurance on a curator's " (detail)"
// suffix.
const CSV_NEEDS_QUOTING = /[",\r\n]|^\s|\s$/;

function csvCell(cell: ChecklistExportCell): string {
  if (cell === null) return "";
  const text = typeof cell === "number" ? String(cell) : cell;
  if (!CSV_NEEDS_QUOTING.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

// UTF-8 with a BOM and CRLF line endings. The BOM is what makes Excel on
// Windows open a non-ASCII artist name correctly instead of mojibake; without
// it the file is silently read as the system codepage.
export function writeChecklistCsv(table: ChecklistExportTable): Uint8Array {
  const lines = [table.headers, ...table.rows].map((row) =>
    row.map(csvCell).join(",")
  );
  const BOM = "\uFEFF";
  return new TextEncoder().encode(`${BOM}${lines.join("\r\n")}\r\n`);
}

// SheetJS is loaded dynamically, exactly as parseImportWorkbook does, so the
// xlsx chunk stays off the critical path — it downloads the first time someone
// actually exports (or imports) a spreadsheet. scripts/assert-chunk-graph.mjs
// guards the invariant at build time; a static import here would break it.
export async function writeChecklistXlsx(
  table: ChecklistExportTable
): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  // Numbers stay numbers and blanks stay blank: aoa_to_sheet types each cell
  // from its JS value, so a Height column is summable in Excel rather than a
  // column of text that merely looks numeric.
  const aoa = [table.headers, ...table.rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths are cosmetic but the difference between a usable sheet and
  // one where every title reads "Composition wi…". Width is in characters.
  sheet["!cols"] = table.headers.map((header, column) => {
    const longest = table.rows.reduce((max, row) => {
      const cell = row[column];
      return Math.max(max, cell === undefined || cell === null ? 0 : String(cell).length);
    }, header.length);
    return { wch: Math.min(48, Math.max(10, longest + 2)) };
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, SHEET_NAME);
  const written = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(written);
}
