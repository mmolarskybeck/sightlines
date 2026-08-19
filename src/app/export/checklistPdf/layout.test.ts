import { describe, expect, it } from "vitest";
import {
  bandHeightPt,
  captionHeightPt,
  CAPTION_STYLE_METRICS,
  CHECKLIST_LAYOUT,
  CHECKLIST_PAGE_SIZE_PT,
  fitThumbnailRect,
  paginateChecklistBands,
  wrapCaptionLines,
  wrapCaptionText,
  type MeasureText
} from "./layout";

// A stand-in for font metrics: every glyph is half its point size wide, which
// makes the wrap arithmetic exact and readable in the assertions below.
const measure: MeasureText = (text, metrics) => text.length * metrics.sizePt * 0.5;

const BODY = CAPTION_STYLE_METRICS.body;

describe("wrapCaptionText", () => {
  it("breaks on words and keeps every one of them", () => {
    const lines = wrapCaptionText("one two three four", 40, BODY, measure);

    // 40pt / (10pt * 0.5) = 8 characters per line.
    expect(lines).toEqual(["one two", "three", "four"]);
    expect(lines.join(" ")).toBe("one two three four");
  });

  it("hard-breaks a single word wider than the column rather than running past the margin", () => {
    const lines = wrapCaptionText("supercalifragilistic", 40, BODY, measure);

    expect(lines.every((line) => measure(line, BODY) <= 40)).toBe(true);
    expect(lines.join("")).toBe("supercalifragilistic");
  });

  it("returns nothing for blank text", () => {
    expect(wrapCaptionText("   ", 100, BODY, measure)).toEqual([]);
  });
});

describe("wrapCaptionLines", () => {
  it("carries each source line's style metrics onto every wrapped fragment", () => {
    const wrapped = wrapCaptionLines(
      [
        { text: "Agnes", style: "artist" },
        { text: "a much longer credit line here", style: "body" }
      ],
      40,
      measure
    );

    expect(wrapped[0].metrics.strong).toBe(true);
    expect(wrapped.slice(1).every((line) => line.metrics === CAPTION_STYLE_METRICS.body))
      .toBe(true);
    expect(wrapped.length).toBeGreaterThan(2);
  });
});

describe("bandHeightPt", () => {
  it("keeps the nominal 2.3in rhythm while the caption fits the image well", () => {
    expect(bandHeightPt(60)).toBeCloseTo(CHECKLIST_LAYOUT.bandMinHeightPt, 6);
    expect(bandHeightPt(CHECKLIST_LAYOUT.thumbHeightPt)).toBeCloseTo(
      CHECKLIST_LAYOUT.bandMinHeightPt,
      6
    );
  });

  it("grows the band instead of shrinking the text once a caption overflows", () => {
    const tall = CHECKLIST_LAYOUT.bandMinHeightPt + 40;
    expect(bandHeightPt(tall)).toBeCloseTo(tall + CHECKLIST_LAYOUT.bandGutterPt, 6);
  });
});

describe("paginateChecklistBands", () => {
  const nominal = bandHeightPt(0);

  it("fits four nominal bands to a page, on the title page and after it", () => {
    const placements = paginateChecklistBands(Array.from({ length: 9 }, () => nominal));

    expect(placements.map((placement) => placement.pageIndex)).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1, 2
    ]);
    expect(placements[0].topPt).toBeCloseTo(CHECKLIST_LAYOUT.firstPageTopPt, 6);
    expect(placements[4].topPt).toBeCloseTo(CHECKLIST_LAYOUT.pageTopPt, 6);
  });

  it("never lets a band start below the bottom limit unless it is alone on its page", () => {
    const placements = paginateChecklistBands([nominal, nominal, nominal, nominal]);

    for (const placement of placements) {
      expect(placement.topPt).toBeLessThanOrEqual(CHECKLIST_LAYOUT.firstPageTopPt);
      expect(placement.topPt - placement.heightPt).toBeGreaterThanOrEqual(
        CHECKLIST_LAYOUT.bottomLimitPt - 0.001
      );
    }
  });

  it("pushes the rest of the page down when one caption makes its band taller", () => {
    const tall = bandHeightPt(400);
    const placements = paginateChecklistBands([nominal, tall, nominal, nominal]);

    expect(placements[1].topPt).toBeCloseTo(
      CHECKLIST_LAYOUT.firstPageTopPt - nominal,
      6
    );
    // The tall band eats the room the third and fourth works would have used.
    expect(placements.map((placement) => placement.pageIndex)).toEqual([0, 0, 1, 1]);
  });

  it("keeps an unbreakably tall band on its own page rather than looping", () => {
    const placements = paginateChecklistBands([
      CHECKLIST_PAGE_SIZE_PT.heightPt * 2
    ]);

    expect(placements).toHaveLength(1);
    expect(placements[0].pageIndex).toBe(0);
  });
});

describe("fitThumbnailRect", () => {
  it("fits aspect-true inside the well, top-left anchored, without cropping", () => {
    const rect = fitThumbnailRect({ widthPx: 400, heightPx: 800 }, 600);

    expect(rect.widthPt / rect.heightPt).toBeCloseTo(0.5, 6);
    expect(rect.heightPt).toBeCloseTo(CHECKLIST_LAYOUT.thumbHeightPt, 6);
    expect(rect.widthPt).toBeLessThanOrEqual(CHECKLIST_LAYOUT.thumbWidthPt);
    expect(rect.xPt).toBe(CHECKLIST_LAYOUT.marginXPt);
    // Top-left anchored: the image hangs from the band's top edge.
    expect(rect.yPt + rect.heightPt).toBeCloseTo(600, 6);
  });

  it("uses the width when the work is the wider one", () => {
    const rect = fitThumbnailRect({ widthPx: 1000, heightPx: 400 }, 600);

    expect(rect.widthPt).toBeCloseTo(CHECKLIST_LAYOUT.thumbWidthPt, 6);
    expect(rect.heightPt).toBeLessThan(CHECKLIST_LAYOUT.thumbHeightPt);
  });
});

describe("captionHeightPt", () => {
  it("sums the leading of every wrapped line", () => {
    const wrapped = wrapCaptionLines(
      [
        { text: "Artist", style: "artist" },
        { text: "Title", style: "title" }
      ],
      400,
      measure
    );

    expect(captionHeightPt(wrapped)).toBe(
      CAPTION_STYLE_METRICS.artist.leadingPt + CAPTION_STYLE_METRICS.title.leadingPt
    );
  });
});
