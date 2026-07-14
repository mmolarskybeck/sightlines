import { describe, expect, it } from "vitest";
import { createArtworkImportPlan } from "./importPlan";
import type { ImportTable } from "./types";

describe("createArtworkImportPlan", () => {
  it("creates artwork drafts and matches image-path basenames", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "title" },
        { index: 1, label: "artist_name" },
        { index: 2, label: "year" },
        { index: 3, label: "height_cm" },
        { index: 4, label: "width_cm" },
        { index: 5, label: "image_path" }
      ],
      rows: [
        {
          sourceRowIndex: 2,
          values: [
            "Mona Lisa",
            "Leonardo da Vinci",
            "c. 1503-1506",
            "77",
            "53",
            "images/mona-lisa.jpg"
          ]
        }
      ]
    };
    const image = new File([new Uint8Array([1])], "mona-lisa.jpg", { type: "image/jpeg" });

    const plan = createArtworkImportPlan({
      table,
      imageFiles: [image],
      projectUnit: "m"
    });

    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts[0].artwork.title).toBe("Mona Lisa");
    expect(plan.drafts[0].artwork.artist).toBe("Leonardo da Vinci");
    expect(plan.drafts[0].artwork.dimensions.heightMm).toBeCloseTo(770);
    expect(plan.drafts[0].artwork.dimensions.widthMm).toBeCloseTo(530);
    expect(plan.drafts[0].imageMatch.status).toBe("matched");
    expect(plan.drafts[0].imageFile?.name).toBe("mona-lisa.jpg");
  });

  it("reads cm-labeled height/width columns as centimeters even on an imperial project (Mona Lisa regression)", () => {
    const table: ImportTable = {
      sourceFilename: "metadata.csv",
      sheetName: "Sheet1",
      headerRowIndex: 0,
      columns: [
        { index: 0, label: "title" },
        { index: 1, label: "artist_name" },
        { index: 2, label: "year" },
        { index: 3, label: "height_cm" },
        { index: 4, label: "width_cm" },
        { index: 5, label: "image_path" }
      ],
      rows: [
        {
          sourceRowIndex: 2,
          values: [
            "Mona Lisa",
            "Leonardo da Vinci",
            "c. 1503-1506",
            "77",
            "53",
            "images/mona-lisa.jpg"
          ]
        }
      ]
    };

    // "ft" is an imperial project unit — before the fix, the bare "77" in the
    // height_cm column would've been parsed as 77 feet/inches instead of 77cm.
    const plan = createArtworkImportPlan({
      table,
      imageFiles: [],
      projectUnit: "ft"
    });

    expect(plan.drafts[0].artwork.dimensions.heightMm).toBeCloseTo(770);
    expect(plan.drafts[0].artwork.dimensions.displayUnit).toBe("cm");
  });

  const dimensionsTable = (dimensionsCell: string): ImportTable => ({
    sourceFilename: "metadata.csv",
    sheetName: "Sheet1",
    headerRowIndex: 0,
    columns: [
      { index: 0, label: "title" },
      { index: 1, label: "dimensions" }
    ],
    rows: [{ sourceRowIndex: 2, values: ["A Work", dimensionsCell] }]
  });

  it("flags a framed-role cell as frame-inclusive and does not warn about double-counting", () => {
    const plan = createArtworkImportPlan({
      table: dimensionsTable("Framed: 24 x 36 in"),
      imageFiles: [],
      projectUnit: "in"
    });

    const draft = plan.drafts[0];
    expect(draft.artwork.frameIncludedInImage).toBe(true);
    // The framed size still lands in `dimensions` (both axes in mm); the flag is
    // what keeps it from being widened again.
    expect(draft.artwork.dimensions.widthMm).toBeCloseTo(914.4);
    expect(draft.artwork.dimensions.heightMm).toBeCloseTo(609.6);
    // The scary double-count warning is superseded — the flag prevents it
    // structurally. A calm frame-inclusive note takes its place.
    expect(draft.warnings.some((w) => /double-count/i.test(w.message))).toBe(false);
    expect(draft.warnings.some((w) => /frame-inclusive/i.test(w.message))).toBe(true);
  });

  it("stores the framed size and flags it when a cell carries both image and framed sizes", () => {
    const plan = createArtworkImportPlan({
      table: dimensionsTable("Image: 20 x 30 in; Framed: 24 x 36 in"),
      imageFiles: [],
      projectUnit: "in"
    });

    const draft = plan.drafts[0];
    // The framed size is the true wall footprint, so it wins over the image
    // size — and the flag keeps it from being widened again. The image number
    // survives only as raw source metadata, not as geometry.
    expect(draft.artwork.frameIncludedInImage).toBe(true);
    expect(draft.artwork.dimensions.widthMm).toBeCloseTo(914.4);
    expect(draft.artwork.dimensions.heightMm).toBeCloseTo(609.6);
  });

  it("leaves the flag unset for an ordinary unframed cell", () => {
    const plan = createArtworkImportPlan({
      table: dimensionsTable("24 x 36 in"),
      imageFiles: [],
      projectUnit: "in"
    });

    const draft = plan.drafts[0];
    expect(draft.artwork.frameIncludedInImage).toBeUndefined();
    expect(draft.warnings.some((w) => /frame-inclusive/i.test(w.message))).toBe(false);
  });
});
