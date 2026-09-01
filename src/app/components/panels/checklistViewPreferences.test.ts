import { describe, expect, it } from "vitest";
import {
  defaultChecklistView,
  shouldDefaultToArtistGrouping
} from "./checklistViewPreferences";

function work(artist?: string) {
  return { artwork: artist === undefined ? null : { artist } };
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
