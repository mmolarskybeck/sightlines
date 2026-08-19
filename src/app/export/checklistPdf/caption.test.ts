import { describe, expect, it } from "vitest";
import type { ChecklistExportRow } from "../../../domain/checklistExport/types";
import { CURRENT_ARTWORK_SCHEMA_VERSION, type Artwork } from "../../../domain/project";
import {
  buildChecklistCaptionLines,
  captionUnitsFor,
  formatCaptionDimensions,
  formatCaptionLocation
} from "./caption";

function artwork(overrides: Partial<Artwork> = {}): Artwork {
  return {
    id: "art-1",
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    artist: "Agnes Martin",
    title: "Untitled #10",
    date: "1990",
    dimensions: { status: "known", widthMm: 500, heightMm: 400 },
    metadata: { medium: "Acrylic and graphite on canvas" },
    ...overrides
  };
}

function row(overrides: Partial<ChecklistExportRow> = {}): ChecklistExportRow {
  return {
    artworkId: "art-1",
    artwork: artwork(),
    projectIndex: 0,
    placement: null,
    ...overrides
  };
}

const OPTIONS = { accession: false, location: true };

describe("formatCaptionDimensions", () => {
  it("prints height first, one unit mark per group, with the other system in parentheses", () => {
    const text = formatCaptionDimensions(
      artwork({ dimensions: { status: "known", widthMm: 209.55, heightMm: 269.875 } }),
      "in"
    );

    // 269.875mm = 10 5/8", 209.55mm = 8 1/4" — the reference document's shape.
    expect(text).toBe('10 5/8 × 8 1/4" (27 × 21 cm)');
  });

  it("leads with centimetres on a metric project", () => {
    const text = formatCaptionDimensions(
      artwork({ dimensions: { status: "known", widthMm: 209.55, heightMm: 269.875 } }),
      "m"
    );

    expect(text).toBe('27 × 21 cm (10 5/8 × 8 1/4")');
  });

  it("adds depth as a third axis only when the record carries one", () => {
    const flat = formatCaptionDimensions(
      artwork({ dimensions: { status: "known", widthMm: 254, heightMm: 254 } }),
      "in"
    );
    const deep = formatCaptionDimensions(
      artwork({
        dimensions: { status: "known", widthMm: 254, heightMm: 254, depthMm: 50.8 }
      }),
      "in"
    );

    expect(flat).toBe('10 × 10" (25.4 × 25.4 cm)');
    expect(deep).toBe('10 × 10 × 2" (25.4 × 25.4 × 5.1 cm)');
  });

  it("stays blank when either principal axis is unknown", () => {
    expect(
      formatCaptionDimensions(
        artwork({ dimensions: { status: "unknown" } }),
        "in"
      )
    ).toBe("");
    expect(formatCaptionDimensions(null, "in")).toBe("");
  });
});

describe("captionUnitsFor", () => {
  it("maps every project unit onto the artwork-scope pair", () => {
    expect(captionUnitsFor("ft")).toEqual({ primary: "in", secondary: "cm" });
    expect(captionUnitsFor("in")).toEqual({ primary: "in", secondary: "cm" });
    expect(captionUnitsFor("m")).toEqual({ primary: "cm", secondary: "in" });
    expect(captionUnitsFor("cm")).toEqual({ primary: "cm", secondary: "in" });
  });
});

describe("formatCaptionLocation", () => {
  const placement = {
    kind: "wall" as const,
    roomName: "Gallery 2",
    wallName: "North",
    roomIndex: 0,
    wallIndex: 1,
    alongMm: 1000
  };

  it("joins room and wall for a wall placement", () => {
    expect(formatCaptionLocation(row({ placement }))).toBe("Gallery 2 · North");
  });

  it("gives the room alone for a floor placement, which has no wall", () => {
    expect(
      formatCaptionLocation(
        row({ placement: { ...placement, kind: "floor", wallName: null, wallIndex: -1 } })
      )
    ).toBe("Gallery 2");
  });

  it("says nothing for an unplaced work or an unresolvable room", () => {
    expect(formatCaptionLocation(row())).toBe("");
    expect(
      formatCaptionLocation(row({ placement: { ...placement, roomName: null } }))
    ).toBe("");
  });
});

describe("buildChecklistCaptionLines", () => {
  it("prints the museum caption order with the styles the writer maps to type", () => {
    const lines = buildChecklistCaptionLines(
      row({
        artwork: artwork({
          locationOrLender: "Collection of the artist",
          dimensions: { status: "known", widthMm: 209.55, heightMm: 269.875 }
        }),
        placement: {
          kind: "wall",
          roomName: "Gallery 2",
          wallName: "North",
          roomIndex: 0,
          wallIndex: 1,
          alongMm: 1000
        }
      }),
      "in",
      OPTIONS
    );

    expect(lines).toEqual([
      { text: "Agnes Martin", style: "artist" },
      { text: "Untitled #10", style: "title" },
      { text: "1990", style: "body" },
      { text: "Acrylic and graphite on canvas", style: "body" },
      { text: '10 5/8 × 8 1/4" (27 × 21 cm)', style: "body" },
      { text: "Collection of the artist", style: "body" },
      { text: "Gallery 2 · North", style: "muted" }
    ]);
  });

  it("drops blank fields rather than printing empty lines", () => {
    const lines = buildChecklistCaptionLines(
      row({
        artwork: artwork({
          date: "   ",
          metadata: {},
          dimensions: { status: "unknown" }
        })
      }),
      "in",
      OPTIONS
    );

    expect(lines.map((line) => line.style)).toEqual(["artist", "title"]);
  });

  it("puts the ordinal above the artist line only when numbering is on", () => {
    const off = buildChecklistCaptionLines(row(), "in", OPTIONS);
    const on = buildChecklistCaptionLines(row(), "in", { ...OPTIONS, number: 7 });

    expect(off[0].style).toBe("artist");
    expect(on[0]).toEqual({ text: "7", style: "number" });
    expect(on[1].style).toBe("artist");
  });

  it("slots the accession number after the dimensions, and only when asked", () => {
    const base = row({ artwork: artwork({ accessionNumber: "2019.44.1" }) });

    expect(
      buildChecklistCaptionLines(base, "in", OPTIONS).map((line) => line.text)
    ).not.toContain("2019.44.1");

    const withAccession = buildChecklistCaptionLines(base, "in", {
      ...OPTIONS,
      accession: true
    });
    const texts = withAccession.map((line) => line.text);
    expect(texts.indexOf("2019.44.1")).toBe(
      texts.findIndex((text) => text.includes("×")) + 1
    );
  });

  it("omits the location line entirely when the switch is off", () => {
    const lines = buildChecklistCaptionLines(
      row({
        placement: {
          kind: "wall",
          roomName: "Gallery 2",
          wallName: "North",
          roomIndex: 0,
          wallIndex: 1,
          alongMm: 1000
        }
      }),
      "in",
      { accession: false, location: false }
    );

    expect(lines.some((line) => line.style === "muted")).toBe(false);
  });

  it("still prints a caption for a work whose library record is gone", () => {
    expect(
      buildChecklistCaptionLines(row({ artwork: null }), "in", OPTIONS)
    ).toEqual([]);
  });
});
