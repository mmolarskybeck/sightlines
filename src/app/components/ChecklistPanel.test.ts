import { describe, expect, it } from "vitest";
import type { ChecklistRowData } from "./ChecklistPanel";
import { sortChecklistRows } from "./ChecklistPanel";

function row(
  projectIndex: number,
  partial: Partial<ChecklistRowData> & {
    artworkId: string;
  }
): ChecklistRowData {
  return {
    artwork: null,
    isPlaced: false,
    placementIds: [],
    wallName: null,
    projectIndex,
    ...partial
  };
}

describe("sortChecklistRows", () => {
  it("keeps project order by default", () => {
    const rows = [
      row(2, { artworkId: "c" }),
      row(0, { artworkId: "a" }),
      row(1, { artworkId: "b" })
    ];

    expect(sortChecklistRows(rows, "project").map((item) => item.artworkId)).toEqual([
      "a",
      "b",
      "c"
    ]);
  });

  it("sorts by title with project order as the stable tiebreaker", () => {
    const rows = [
      row(2, {
        artworkId: "z",
        artwork: {
          id: "z",
          schemaVersion: 1,
          title: "Zebra",
          dimensions: { status: "unknown" },
          metadata: {}
        }
      }),
      row(0, {
        artworkId: "a",
        artwork: {
          id: "a",
          schemaVersion: 1,
          title: "Arc",
          dimensions: { status: "unknown" },
          metadata: {}
        }
      }),
      row(1, {
        artworkId: "b",
        artwork: {
          id: "b",
          schemaVersion: 1,
          title: "Arc",
          dimensions: { status: "unknown" },
          metadata: {}
        }
      })
    ];

    expect(sortChecklistRows(rows, "title").map((item) => item.artworkId)).toEqual([
      "a",
      "b",
      "z"
    ]);
  });

  it("groups unplaced works before placed works for status sorting", () => {
    const rows = [
      row(0, { artworkId: "placed-first", isPlaced: true }),
      row(1, { artworkId: "unplaced", isPlaced: false }),
      row(2, { artworkId: "placed-second", isPlaced: true })
    ];

    expect(sortChecklistRows(rows, "status").map((item) => item.artworkId)).toEqual([
      "unplaced",
      "placed-first",
      "placed-second"
    ]);
  });
});
