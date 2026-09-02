import { describe, expect, it } from "vitest";
import type { Artwork } from "../../../domain/project";
import {
  checklistRowMatchesQuery,
  defaultChecklistView,
  groupChecklistRowsByArtist,
  shouldDefaultToArtistGrouping,
  sortChecklistRows,
  type ChecklistRowData
} from "./checklistViewPreferences";

function work(artist?: string) {
  return { artwork: artist === undefined ? null : { artist } };
}

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

function artwork(
  id: string,
  title: string,
  artist?: string,
  overrides: Partial<Artwork> = {}
): Artwork {
  return {
    id,
    schemaVersion: 1,
    title,
    artist,
    dimensions: { status: "unknown" },
    metadata: {},
    ...overrides
  };
}

describe("shouldDefaultToArtistGrouping", () => {
  it("is true only when at least two artists each have multiple works", () => {
    expect(
      shouldDefaultToArtistGrouping([
        work("Boyun Jang"),
        work("Boyun Jang"),
        work("Alma Thomas"),
        work("Alma Thomas")
      ])
    ).toBe(true);

    // One artist with everything is a solo show.
    expect(
      shouldDefaultToArtistGrouping([
        work("Boyun Jang"),
        work("Boyun Jang"),
        work("Boyun Jang"),
        work("Alma Thomas")
      ])
    ).toBe(false);

    // One work per artist reads better flat.
    expect(
      shouldDefaultToArtistGrouping([
        work("Boyun Jang"),
        work("Alma Thomas"),
        work("Ruth Asawa")
      ])
    ).toBe(false);

    expect(shouldDefaultToArtistGrouping([])).toBe(false);
  });

  it("matches artists case-insensitively and ignores surrounding whitespace", () => {
    expect(
      shouldDefaultToArtistGrouping([
        work("Boyun Jang"),
        work(" boyun jang "),
        work("ALMA THOMAS"),
        work("Alma Thomas")
      ])
    ).toBe(true);
  });

  it("never counts blank or missing artists as a group", () => {
    expect(
      shouldDefaultToArtistGrouping([
        work(""),
        work("   "),
        work(undefined),
        work(undefined),
        work("Boyun Jang"),
        work("Boyun Jang")
      ])
    ).toBe(false);
  });
});

describe("defaultChecklistView", () => {
  it("opens a group show grouped by artist, anything else in project order", () => {
    expect(
      defaultChecklistView([
        work("Boyun Jang"),
        work("Boyun Jang"),
        work("Alma Thomas"),
        work("Alma Thomas")
      ])
    ).toEqual({ sort: "artist", groupByArtist: true });

    expect(defaultChecklistView([work("Boyun Jang"), work("Alma Thomas")])).toEqual({
      sort: "project",
      groupByArtist: false
    });
  });
});

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

describe("checklist retrieval and artist groups", () => {
  it("matches every search term across curator-facing and imported metadata", () => {
    const searchable = row(0, {
      artworkId: "searchable",
      artwork: artwork("searchable", "Harbor at Dusk", "Boyun Jang", {
        date: "2024",
        locationOrLender: "North Gallery",
        metadata: { subject: "urban landscape" }
      })
    });

    expect(checklistRowMatchesQuery(searchable, "boyun landscape")).toBe(true);
    expect(checklistRowMatchesQuery(searchable, "north 2024")).toBe(true);
    expect(checklistRowMatchesQuery(searchable, "portrait")).toBe(false);
  });

  it("groups artist names case-insensitively and keeps missing artists together", () => {
    const groups = groupChecklistRowsByArtist([
      row(0, { artworkId: "one", artwork: artwork("one", "One", "Boyun Jang") }),
      row(1, { artworkId: "two", artwork: artwork("two", "Two", " boyun jang ") }),
      row(2, { artworkId: "three", artwork: artwork("three", "Three") }),
      row(3, { artworkId: "four", artwork: artwork("four", "Four", "  ") })
    ]);

    expect(groups.map((group) => [group.label, group.rows.length])).toEqual([
      ["Boyun Jang", 2],
      ["Artist not recorded", 2]
    ]);
  });
});
