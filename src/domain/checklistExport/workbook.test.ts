import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChecklistExportTable } from "./types";
import { writeChecklistCsv, writeChecklistXlsx } from "./workbook";

const table: ChecklistExportTable = {
  headers: ["#", "Artist", "Title", "Height (cm)", "Notes"],
  rows: [
    [1, "Agnes Martin", 'Untitled, "no. 3"', 40, null],
    [2, "Brâncuși", "Line one\nline two", null, " padded "],
    [3, "Comma, Inc.", "Plain", 12.5, ""]
  ]
};

function decodeCsv(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("writeChecklistCsv", () => {
  it("starts with a UTF-8 BOM so Excel reads non-ASCII names correctly", () => {
    const bytes = writeChecklistCsv(table);
    // Checked on the BYTES: TextDecoder swallows a leading BOM by default, so
    // decoding first would hide a missing one.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(decodeCsv(bytes)).toContain("Brâncuși");
  });

  it("quotes per RFC 4180 and doubles embedded quotes", () => {
    const lines = decodeCsv(writeChecklistCsv(table)).replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("#,Artist,Title,Height (cm),Notes");
    expect(lines[1]).toBe('1,Agnes Martin,"Untitled, ""no. 3""",40,');
  });

  it("quotes cells containing newlines and edge whitespace", () => {
    const text = decodeCsv(writeChecklistCsv(table)).replace(/^\uFEFF/, "");
    expect(text).toContain('"Line one\nline two"');
    expect(text).toContain('" padded "');
    expect(text).toContain('"Comma, Inc."');
  });

  it("writes null cells as empty and ends with a terminating CRLF", () => {
    const text = decodeCsv(writeChecklistCsv(table)).replace(/^\uFEFF/, "");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(4);
  });

  it("neutralizes formula-leading text while leaving numbers and ordinary text intact", () => {
    const unsafeTable: ChecklistExportTable = {
      headers: ["Equals", "Plus", "Minus", "At", "Number", "Ordinary"],
      rows: [["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", -42, "Agnes Martin"]]
    };

    const text = decodeCsv(writeChecklistCsv(unsafeTable)).replace(/^\uFEFF/, "");
    expect(text).toBe(
      "Equals,Plus,Minus,At,Number,Ordinary\r\n" +
        "'=1+1,'+cmd,'-2+3,'@SUM(A1:A2),-42,Agnes Martin\r\n"
    );
  });

  it("neutralizes formula markers after leading whitespace", () => {
    const unsafeTable: ChecklistExportTable = {
      headers: ["Spaces", "Tab", "Newline", "Safe apostrophe"],
      rows: [["  =1+1", "\t+cmd", "\n@SUM(A1:A2)", "'=already text"]]
    };

    const text = decodeCsv(writeChecklistCsv(unsafeTable)).replace(/^\uFEFF/, "");
    expect(text).toBe(
      "Spaces,Tab,Newline,Safe apostrophe\r\n" +
        "'  =1+1,'\t+cmd,\"'\n@SUM(A1:A2)\",'=already text\r\n"
    );
  });
});

describe("writeChecklistXlsx", () => {
  it("round-trips through SheetJS with numbers still numeric", async () => {
    const bytes = await writeChecklistXlsx(table);
    const XLSX = await import("xlsx");
    const book = XLSX.read(bytes, { type: "array", cellStyles: true });

    expect(book.SheetNames).toEqual(["Checklist"]);
    const sheet = book.Sheets.Checklist;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

    expect(aoa[0]).toEqual(["#", "Artist", "Title", "Height (cm)", "Notes"]);
    expect(aoa[1][0]).toBe(1);
    expect(aoa[1][3]).toBe(40);
    expect(typeof aoa[1][3]).toBe("number");
    expect(aoa[1][2]).toBe('Untitled, "no. 3"');
    expect(aoa[2][3]).toBeNull();
    expect(sheet["!autofilter"]).toEqual({ ref: "A1:E4" });
    expect(sheet["!cols"]?.[0]?.wch).toBeCloseTo(6, 0);
  });

  it("styles and freezes the filterable header row", async () => {
    const archive = unzipSync(await writeChecklistXlsx(table));
    const sheetXml = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const stylesXml = strFromU8(archive["xl/styles.xml"]);

    expect(sheetXml).toContain('<autoFilter ref="A1:E4"/>');
    expect(sheetXml).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    );
    expect(sheetXml).toMatch(/<row r="1" ht="24" customHeight="1">/);
    expect(sheetXml).toMatch(/<c s="1" r="A1"/);
    expect(stylesXml).toContain('fgColor rgb="FF285F63"');
    expect(stylesXml).toContain('<font><b/><sz val="11"/><color rgb="FFFFFFFF"/>');
  });

  it("writes a real zip-backed xlsx (PK header)", async () => {
    const bytes = await writeChecklistXlsx(table);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });
});
