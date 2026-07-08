import { describe, expect, it } from "vitest";
import { guessColumnMapping } from "./columnMapping";
import type { ImportTable } from "./types";

describe("guessColumnMapping", () => {
  it("maps common artwork fixture headers", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "id" },
        { index: 1, label: "title" },
        { index: 2, label: "artist_name" },
        { index: 3, label: "year" },
        { index: 4, label: "medium" },
        { index: 5, label: "height_cm" },
        { index: 6, label: "width_cm" },
        { index: 7, label: "image_path" }
      ],
      rows: [
        {
          sourceRowIndex: 2,
          values: [
            "mona-lisa",
            "Mona Lisa",
            "Leonardo da Vinci",
            "c. 1503-1506",
            "Oil on poplar panel",
            "77",
            "53",
            "images/mona-lisa.jpg"
          ]
        }
      ]
    };

    const { mapping } = guessColumnMapping(table);

    expect(mapping.title).toBe(1);
    expect(mapping.artist).toBe(2);
    expect(mapping.date).toBe(3);
    expect(mapping.medium).toBe(4);
    expect(mapping.height).toBe(5);
    expect(mapping.width).toBe(6);
    expect(mapping.imageFilename).toBe(7);
  });
});
