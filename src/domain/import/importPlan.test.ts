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
});
