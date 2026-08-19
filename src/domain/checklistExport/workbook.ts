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
const CSV_FORMULA_PREFIX = /^\s*[=+\-@]/;

const XLSX_HEADER_FILL = "FF285F63";
const XLSX_HEADER_BORDER = "FF174649";

function neutralizeCsvFormula(text: string): string {
  // Spreadsheet apps may evaluate formula markers even when whitespace comes
  // before them. A leading apostrophe is Excel's text marker; keeping it in
  // the CSV is the only portable way to make untrusted text inert on open.
  return CSV_FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function csvCell(cell: ChecklistExportCell): string {
  if (cell === null) return "";
  // Numeric cells remain numeric, including negative values. Only strings can
  // contain an untrusted formula payload that needs neutralizing.
  const text =
    typeof cell === "number" ? String(cell) : neutralizeCsvFormula(cell);
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

function appendXlsxStyleRecord(
  xml: string,
  collection: "fonts" | "fills" | "borders" | "cellXfs",
  record: string
): { xml: string; index: number } {
  const opening = new RegExp(`<${collection} count="(\\d+)">`);
  const match = xml.match(opening);
  if (!match) throw new Error(`Checklist XLSX is missing ${collection} styles.`);

  const index = Number(match[1]);
  return {
    index,
    xml: xml
      .replace(opening, `<${collection} count="${index + 1}">`)
      .replace(`</${collection}>`, `${record}</${collection}>`)
  };
}

function styleChecklistXlsxXml(stylesXml: string, sheetXml: string): {
  stylesXml: string;
  sheetXml: string;
} {
  const font = appendXlsxStyleRecord(
    stylesXml,
    "fonts",
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
  );
  const fill = appendXlsxStyleRecord(
    font.xml,
    "fills",
    `<fill><patternFill patternType="solid"><fgColor rgb="${XLSX_HEADER_FILL}"/><bgColor indexed="64"/></patternFill></fill>`
  );
  const border = appendXlsxStyleRecord(
    fill.xml,
    "borders",
    `<border><left/><right/><top/><bottom style="thin"><color rgb="${XLSX_HEADER_BORDER}"/></bottom><diagonal/></border>`
  );
  const cellStyle = appendXlsxStyleRecord(
    border.xml,
    "cellXfs",
    `<xf numFmtId="0" fontId="${font.index}" fillId="${fill.index}" borderId="${border.index}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>`
  );

  const headerRowMatch = sheetXml.match(/<row r="1">.*?<\/row>/);
  if (!headerRowMatch) throw new Error("Checklist XLSX is missing its header row.");
  const styledHeader = headerRowMatch[0]
    .replace('<row r="1">', '<row r="1" ht="24" customHeight="1">')
    .replace(/<c /g, `<c s="${cellStyle.index}" `);
  const defaultSheetView =
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  if (!sheetXml.includes(defaultSheetView)) {
    throw new Error("Checklist XLSX has an unexpected sheet-view structure.");
  }

  return {
    stylesXml: cellStyle.xml,
    sheetXml: sheetXml
      .replace(headerRowMatch[0], styledHeader)
      .replace(
        defaultSheetView,
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
      )
  };
}

// SheetJS is loaded dynamically, exactly as parseImportWorkbook does, so the
// xlsx chunk stays off the critical path — it downloads the first time someone
// actually exports (or imports) a spreadsheet. scripts/assert-chunk-graph.mjs
// guards the invariant at build time; a static import here would break it.
export async function writeChecklistXlsx(
  table: ChecklistExportTable
): Promise<Uint8Array> {
  const [XLSX, { strFromU8, strToU8, unzipSync, zipSync }] = await Promise.all([
    import("xlsx"),
    import("fflate")
  ]);
  // Numbers stay numbers and blanks stay blank: aoa_to_sheet types each cell
  // from its JS value, so a Height column is summable in Excel rather than a
  // column of text that merely looks numeric.
  const aoa = [table.headers, ...table.rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths are cosmetic but the difference between a usable sheet and
  // one where every title reads "Composition wi…". Width is in characters.
  sheet["!cols"] = table.headers.map((header, column) => {
    // Keep the stable exported-order column, but let it read as a compact index
    // beside Excel's own row labels rather than a second full-width data field.
    if (header === "#") return { wch: 6 };
    const longest = table.rows.reduce((max, row) => {
      const cell = row[column];
      return Math.max(max, cell === undefined || cell === null ? 0 : String(cell).length);
    }, header.length);
    return { wch: Math.min(48, Math.max(10, longest + 2)) };
  });
  // Filters turn the checklist into a working list rather than a static dump;
  // the sequence column remains useful because it preserves the exported order
  // after someone sorts or filters the visible rows.
  sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1:A1" };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, SHEET_NAME);
  const written = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const archive = unzipSync(new Uint8Array(written));
  const stylesPath = "xl/styles.xml";
  const sheetPath = "xl/worksheets/sheet1.xml";
  const styled = styleChecklistXlsxXml(
    strFromU8(archive[stylesPath]),
    strFromU8(archive[sheetPath])
  );
  archive[stylesPath] = strToU8(styled.stylesXml);
  archive[sheetPath] = strToU8(styled.sheetXml);
  return zipSync(archive);
}
