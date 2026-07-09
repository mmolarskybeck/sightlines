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

  it("maps the full 16-column wikimedia fixture without stealing px/hash/url columns", () => {
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
        { index: 7, label: "image_path" },
        { index: 8, label: "mime_type" },
        { index: 9, label: "width_px" },
        { index: 10, label: "height_px" },
        { index: 11, label: "byte_size" },
        { index: 12, label: "sha256" },
        { index: 13, label: "source_file_page_url" },
        { index: 14, label: "download_url" },
        { index: 15, label: "license" }
      ],
      rows: [
        {
          sourceRowIndex: 1,
          values: [
            "mona-lisa",
            "Mona Lisa",
            "Leonardo da Vinci",
            "c. 1503-1506",
            "Oil on poplar panel",
            "77",
            "53",
            "images/mona-lisa.jpg",
            "image/jpeg",
            "1280",
            "1908",
            "980329",
            "8056105c343c16563f8afd4615b4653067e168ec41f344ef5b7e8aaea97463ad",
            "https://commons.wikimedia.org/wiki/File:Mona_Lisa,_by_Leonardo_da_Vinci",
            "https://commons.wikimedia.org/wiki/Special:FilePath/Mona%20Lisa.jpg?width=1200",
            "Public domain"
          ]
        },
        {
          sourceRowIndex: 2,
          values: [
            "starry-night",
            "The Starry Night",
            "Vincent van Gogh",
            "1889",
            "Oil on canvas",
            "73.7",
            "92.1",
            "images/starry-night.jpg",
            "image/jpeg",
            "1920",
            "1520",
            "1381879",
            "dbca2f16b195f6e83feb98d44c0d98eb0b39f560314efbedfedab9e45caa8a2f",
            "https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night",
            "https://commons.wikimedia.org/wiki/Special:FilePath/Van%20Gogh.jpg?width=1800",
            "Public domain"
          ]
        }
      ]
    };

    const { mapping } = guessColumnMapping(table);

    expect(mapping.height).toBe(5);
    expect(mapping.width).toBe(6);
    expect(mapping.accessionNumber).toBeUndefined();
    expect(mapping.dimensions).toBeUndefined();

    const claimedColumns = new Set(Object.values(mapping));
    for (let index = 8; index <= 15; index++) {
      expect(claimedColumns.has(index)).toBe(false);
    }
  });

  it("does not let accessionNumber steal a decimal height_cm column", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "catalog number" },
        { index: 1, label: "height_cm" }
      ],
      rows: [
        { sourceRowIndex: 1, values: ["P.123", "73.7"] },
        { sourceRowIndex: 2, values: ["P.124", "44.5"] }
      ]
    };

    const { mapping } = guessColumnMapping(table);

    expect(mapping.height).toBe(1);
    expect(mapping.accessionNumber).toBe(0);
  });

  it("maps museum-style headers, leaving unaliased ones unmapped", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "Object Number" },
        { index: 1, label: "Display Dimensions" },
        { index: 2, label: "Credit Line" }
      ],
      rows: [
        { sourceRowIndex: 1, values: ["1979.620.1", "24 x 30 in", "Gift of the artist"] }
      ]
    };

    const { mapping } = guessColumnMapping(table);

    expect(mapping.accessionNumber).toBe(0);
    expect(mapping.dimensions).toBe(1);
    expect(Object.values(mapping)).not.toContain(2);
  });

  it("maps compact unit headers at high confidence", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "H (cm)" },
        { index: 1, label: "W (cm)" },
        { index: 2, label: "D (cm)" }
      ],
      rows: [{ sourceRowIndex: 1, values: ["24", "30", "5"] }]
    };

    const { mapping, guesses } = guessColumnMapping(table);

    expect(mapping.height).toBe(0);
    expect(mapping.width).toBe(1);
    expect(mapping.depth).toBe(2);
    for (const guess of guesses) {
      expect(guess.confidence).toBe("high");
    }
  });

  it("never maps pixel/hash/mime/url/checksum columns to any field", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "byte_size" },
        { index: 1, label: "file_size" },
        { index: 2, label: "width_px" },
        { index: 3, label: "image_url" },
        { index: 4, label: "dpi" },
        { index: 5, label: "checksum" },
        { index: 6, label: "mime_type" }
      ],
      rows: [
        {
          sourceRowIndex: 1,
          values: [
            "980329",
            "980329",
            "1280",
            "https://example.com/image.jpg",
            "300",
            "8056105c343c16563f8afd4615b4653067e168ec41f344ef5b7e8aaea97463ad",
            "image/jpeg"
          ]
        }
      ]
    };

    const { mapping } = guessColumnMapping(table);
    const claimedColumns = new Set(Object.values(mapping));

    for (let index = 0; index <= 6; index++) {
      expect(claimedColumns.has(index)).toBe(false);
    }
  });

  it("maps numeric accessions via header alias but not via a bare numeric column with no alias", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "Object Number" },
        { index: 1, label: "code" }
      ],
      rows: [
        { sourceRowIndex: 1, values: ["1001", "9001"] },
        { sourceRowIndex: 2, values: ["1002", "9002"] }
      ]
    };

    const { mapping } = guessColumnMapping(table);

    expect(mapping.accessionNumber).toBe(0);
    expect(Object.values(mapping)).not.toContain(1);
  });

  it("maps a multi-dot accession-shaped value column even without a strong header alias", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [{ index: 0, label: "ref" }],
      rows: [
        // Values deliberately don't start with a year-like "19xx"/"20xx"
        // prefix, so this exercises the accessionNumber value heuristic
        // without also tripping the (unrelated) date value heuristic.
        { sourceRowIndex: 1, values: ["45.620.1"] },
        { sourceRowIndex: 2, values: ["45.620.2"] }
      ]
    };

    const { mapping } = guessColumnMapping(table);

    expect(mapping.accessionNumber).toBe(0);
  });

  it("is deterministic: lower column index wins ties, and repeated calls agree", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "height" },
        { index: 1, label: "height" }
      ],
      rows: [{ sourceRowIndex: 1, values: ["24", "30"] }]
    };

    const first = guessColumnMapping(table);
    expect(first.mapping.height).toBe(0);

    const second = guessColumnMapping(table);
    expect(second).toEqual(first);
  });
});
