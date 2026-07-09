import { describe, expect, it } from "vitest";
import { createImportTable, parseImportWorkbook } from "./workbook";

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
});
