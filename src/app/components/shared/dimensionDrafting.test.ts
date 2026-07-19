import { describe, expect, it } from "vitest";
import {
  ELEVATION_LABEL_FONT_PX,
  LABEL_GLYPH_WIDTH_RATIO,
  LABEL_STROKE_WIDTH_RATIO,
  MIN_DIMENSION_SEGMENT_MM,
  estimateLabelWidth,
  labelFitsInSpan,
  labelTextStyle
} from "./dimensionDrafting";

// Characterization suite: pins CURRENT behavior of drafting utilities shared
// by PlanGapDimensionLines / PartitionDimensionLines / GroupDimensionLines /
// VerticalGapDimensionLines. None of these had any test coverage before this
// suite — an accidental change to a constant or formula here silently shifts
// dimension-label layout across all four renderers, so these numbers are
// deliberately pinned rather than re-derived.

describe("exported constants (pin current values)", () => {
  it("LABEL_GLYPH_WIDTH_RATIO", () => {
    expect(LABEL_GLYPH_WIDTH_RATIO).toBe(0.62);
  });

  it("LABEL_STROKE_WIDTH_RATIO", () => {
    expect(LABEL_STROKE_WIDTH_RATIO).toBe(0.3);
  });

  it("ELEVATION_LABEL_FONT_PX", () => {
    expect(ELEVATION_LABEL_FONT_PX).toBe(10);
  });

  it("MIN_DIMENSION_SEGMENT_MM", () => {
    expect(MIN_DIMENSION_SEGMENT_MM).toBe(0.5);
  });
});

describe("estimateLabelWidth", () => {
  it("returns 0 for an empty label regardless of font size", () => {
    expect(estimateLabelWidth("", 10)).toBe(0);
    expect(estimateLabelWidth("", 100)).toBe(0);
  });

  it("scales linearly with label length (imperial feet/inches label)", () => {
    // Representative imperial dimension label, e.g. PartitionDimensionLines'
    // formatLength(..., { unit: "ft" }) output.
    const label = `8'4 1/2"`;
    expect(estimateLabelWidth(label, 10)).toBeCloseTo(label.length * 10 * 0.62, 10);
    expect(estimateLabelWidth(label, 10)).toBeCloseTo(49.6, 10);
  });

  it("scales linearly with label length (metric cm label)", () => {
    const label = "142.5 cm";
    expect(estimateLabelWidth(label, 10)).toBeCloseTo(label.length * 10 * 0.62, 10);
    expect(estimateLabelWidth(label, 10)).toBeCloseTo(49.6, 10);
  });

  it("scales linearly with label length (metric meters label)", () => {
    const label = "1.43 m";
    expect(estimateLabelWidth(label, ELEVATION_LABEL_FONT_PX)).toBeCloseTo(
      label.length * ELEVATION_LABEL_FONT_PX * 0.62,
      10
    );
  });

  it("scales linearly with font size for a fixed label", () => {
    const label = `12'0"`;
    const atSmall = estimateLabelWidth(label, 5);
    const atLarge = estimateLabelWidth(label, 20);
    expect(atLarge).toBeCloseTo(atSmall * 4, 10);
  });
});

describe("labelFitsInSpan", () => {
  it("fits exactly when span equals labelWidth + slack", () => {
    expect(labelFitsInSpan(100, 80, 20)).toBe(true);
  });

  it("does not fit when span is just under labelWidth + slack", () => {
    expect(labelFitsInSpan(99.999, 80, 20)).toBe(false);
  });

  it("fits comfortably when span exceeds labelWidth + slack", () => {
    expect(labelFitsInSpan(200, 80, 20)).toBe(true);
  });

  it("does not fit in a zero span with any positive label width", () => {
    expect(labelFitsInSpan(0, 10, 0)).toBe(false);
  });

  it("does not fit in a negative span", () => {
    expect(labelFitsInSpan(-10, 5, 0)).toBe(false);
  });

  it("treats zero label width and zero slack as always fitting a non-negative span", () => {
    expect(labelFitsInSpan(0, 0, 0)).toBe(true);
    expect(labelFitsInSpan(50, 0, 0)).toBe(true);
  });
});

describe("labelTextStyle", () => {
  it("returns fontSize unchanged and strokeWidth as fontSize * LABEL_STROKE_WIDTH_RATIO", () => {
    expect(labelTextStyle(10)).toEqual({ fontSize: 10, strokeWidth: 3 });
  });

  it("scales strokeWidth with fontSize (elevation basis, e.g. handleSizeMm * 1.6)", () => {
    const fontSizeMm = 12.5 * 1.6; // representative plan-renderer basis
    expect(labelTextStyle(fontSizeMm)).toEqual({
      fontSize: fontSizeMm,
      strokeWidth: fontSizeMm * 0.3
    });
  });

  it("returns a zero strokeWidth for a zero fontSize", () => {
    expect(labelTextStyle(0)).toEqual({ fontSize: 0, strokeWidth: 0 });
  });

  it("shape has exactly fontSize and strokeWidth keys", () => {
    expect(Object.keys(labelTextStyle(10)).sort()).toEqual(["fontSize", "strokeWidth"]);
  });
});
