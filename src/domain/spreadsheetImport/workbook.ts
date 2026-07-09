import readXlsxFile from "read-excel-file/browser";
import type { ImportSheetPreview, ImportTable, ImportWorkbookPreview } from "./types";

export async function parseImportWorkbook(
  data: ArrayBuffer,
  sourceFilename: string
): Promise<ImportWorkbookPreview> {
  if (/\.(csv|tsv)$/i.test(sourceFilename)) {
    return {
      sourceFilename,
      sheets: [
        {
          name: "Sheet1",
          rows: parseDelimitedText(new TextDecoder().decode(data), sourceFilename)
        }
      ]
    };
  }

  const sheets = await readXlsxFile(data);

  return {
    sourceFilename,
    sheets: sheets
      .map((sheet) => ({
        name: sheet.sheet,
        rows: sheet.data.map((row) => row.map((cell) => normalizeCell(cell)))
      }))
      .filter((sheet) => sheet.rows.some((row) => row.some((cell) => cell.trim().length > 0)))
  };
}

export function createImportTable(
  workbook: ImportWorkbookPreview,
  sheetName: string,
  headerRowIndex?: number
): ImportTable {
  const sheet = workbook.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const resolvedHeaderRowIndex = headerRowIndex ?? detectHeaderRow(sheet);
  const headerRow = sheet.rows[resolvedHeaderRowIndex] ?? [];
  const width = headerRow.length;
  const columns = headerRow
    .map((label, index) => ({ index, label: label.trim() || `Column ${index + 1}` }))
    .filter((column) => column.label.trim().length > 0);

  const rows = sheet.rows
    .slice(resolvedHeaderRowIndex + 1)
    .map((values, index) => ({
      sourceRowIndex: resolvedHeaderRowIndex + index + 2,
      values: normalizeWidth(values, width)
    }))
    .filter((row) => row.values.some((cell) => cell.trim().length > 0));

  return {
    sourceFilename: workbook.sourceFilename,
    sheetName: sheet.name,
    headerRowIndex: resolvedHeaderRowIndex,
    columns,
    rows
  };
}

function detectHeaderRow(sheet: ImportSheetPreview): number {
  let best = 0;
  let bestScore = -Infinity;

  for (let index = 0; index < Math.min(10, sheet.rows.length); index += 1) {
    const row = sheet.rows[index];
    const filled = row.filter((cell) => cell.trim().length > 0);
    const textish = filled.filter((cell) => /[a-z]/i.test(cell)).length;
    const imageish = filled.filter((cell) => /\.(jpe?g|png|webp|tiff?)$/i.test(cell)).length;
    const score = filled.length * 2 + textish - imageish * 3;

    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }

  return best;
}

function normalizeWidth(values: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => values[index] ?? "");
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function parseDelimitedText(text: string, sourceFilename: string): string[][] {
  const delimiter = detectDelimiter(text, sourceFilename);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);

  return rows;
}

function detectDelimiter(text: string, sourceFilename: string): "," | "\t" {
  if (/\.tsv$/i.test(sourceFilename)) return "\t";
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commaCount = [...firstLine].filter((char) => char === ",").length;
  const tabCount = [...firstLine].filter((char) => char === "\t").length;
  return tabCount > commaCount ? "\t" : ",";
}
