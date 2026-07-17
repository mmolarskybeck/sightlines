import { describe, expect, it } from "vitest";
import {
  formatDetailsSummary,
  formatDimensionsSummary,
  formatFramingSummary
} from "./artworkInspectorSummaries";

describe("formatDimensionsSummary", () => {
  it("formats width × height in the given unit", () => {
    // 36 1/4" and 29" exactly.
    const summary = formatDimensionsSummary(
      { widthMm: 920.75, heightMm: 736.6, status: "known" },
      "in"
    );
    expect(summary).toBe('36 1/4" × 29"');
  });

  it("appends depth when present", () => {
    const summary = formatDimensionsSummary(
      { widthMm: 1016, heightMm: 812.8, depthMm: 50.8, status: "known" },
      "in"
    );
    expect(summary).toBe('40" × 32" × 2"');
  });

  it("marks a single unknown face with a placeholder", () => {
    const summary = formatDimensionsSummary({ widthMm: 1016, status: "approximate" }, "in");
    expect(summary).toBe('40" × ?');
  });

  it("returns null when neither face dimension is known", () => {
    expect(formatDimensionsSummary({ status: "unknown" }, "in")).toBeNull();
    expect(formatDimensionsSummary({ depthMm: 50, status: "unknown" }, "in")).toBeNull();
  });

  it("formats metric units", () => {
    const summary = formatDimensionsSummary(
      { widthMm: 620, heightMm: 480, status: "known" },
      "cm"
    );
    expect(summary).toBe("62 cm × 48 cm");
  });
});

describe("formatFramingSummary", () => {
  // 36" x 24" image; mat 3" + frame 1" per side round cleanly in inches.
  const dims = { widthMm: 914.4, heightMm: 609.6, status: "known" as const };

  it("combines mat and frame with the finish name, plus the overall size", () => {
    expect(formatFramingSummary(76.2, { widthMm: 25.4, finish: "gold" }, dims, "in")).toBe(
      '3" mat · 1" gold frame · 44" × 32" overall'
    );
  });

  it("shows a mat alone, plus the overall size", () => {
    expect(formatFramingSummary(76.2, undefined, dims, "in")).toBe('3" mat · 42" × 30" overall');
  });

  it("shows a frame alone, plus the overall size", () => {
    expect(formatFramingSummary(undefined, { widthMm: 25.4, finish: "wood" }, dims, "in")).toBe(
      '1" wood frame · 38" × 26" overall'
    );
  });

  it("reads None when there is neither, even with known dims", () => {
    expect(formatFramingSummary(undefined, undefined, dims, "in")).toBe("None");
  });

  it("omits the overall when an image axis is unknown", () => {
    expect(
      formatFramingSummary(
        76.2,
        { widthMm: 25.4, finish: "gold" },
        { widthMm: 914.4, status: "approximate" },
        "in"
      )
    ).toBe('3" mat · 1" gold frame');
  });

  it("reads 'Size includes the frame' when flagged, ignoring any stored mat/frame", () => {
    expect(
      formatFramingSummary(76.2, { widthMm: 25.4, finish: "gold" }, dims, "in", true)
    ).toBe("Size includes the frame");
  });
});

describe("formatDetailsSummary", () => {
  it("prefers the accession number", () => {
    expect(formatDetailsSummary("1990.12", "Private collection")).toBe("1990.12");
  });

  it("falls back to location/lender", () => {
    expect(formatDetailsSummary(undefined, "Private collection")).toBe("Private collection");
    expect(formatDetailsSummary("  ", "Private collection")).toBe("Private collection");
  });

  it("returns null when the registrar cluster is empty", () => {
    expect(formatDetailsSummary(undefined, undefined)).toBeNull();
    expect(formatDetailsSummary("", "  ")).toBeNull();
  });
});
