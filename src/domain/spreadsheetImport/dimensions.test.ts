import { describe, expect, it } from "vitest";
import { inchesToMm } from "../units/length";
import { detectUnitFromLabel, dimensionsFromColumns, parseImportedDimensions } from "./dimensions";

describe("parseImportedDimensions", () => {
  // The framed size is the work's true wall footprint, so it wins over an
  // image size in the same cell — importPlan flags the draft frameIncludedInImage
  // so the stored outer size is never widened again (see ROLE_PRIORITY).
  it("prefers the framed size over an image size in the same cell", () => {
    const parsed = parseImportedDimensions(
      "image: 7 x 9 in.; framed: 24 x 30 in.",
      "in"
    );

    expect(parsed?.role).toBe("framed");
    expect(parsed?.dimensions.heightMm).toBeCloseTo(inchesToMm(24));
    expect(parsed?.dimensions.widthMm).toBeCloseTo(inchesToMm(30));
  });

  it("uses the project artwork unit when no unit is present", () => {
    const parsed = parseImportedDimensions("24 x 30", "in");

    expect(parsed?.confidence).toBe("medium");
    expect(parsed?.warnings[0]).toMatch(/interpreted as inches/);
    expect(parsed?.dimensions.heightMm).toBeCloseTo(inchesToMm(24));
    expect(parsed?.dimensions.widthMm).toBeCloseTo(inchesToMm(30));
  });

  it("parses a MoMA dual-unit cell with a parenthesized metric alternate", () => {
    // `9 5/16 × 2 1/2" (23.6 × 6.3 cm)` — the naive full-string split strands a
    // piece like `2 1/2" (23.6`; the paren-aware split reads the imperial size.
    const parsed = parseImportedDimensions('9 5/16 × 2 1/2" (23.6 × 6.3 cm)', "in");

    expect(parsed).not.toBeNull();
    expect(parsed?.dimensions.heightMm).toBeCloseTo(inchesToMm(9 + 5 / 16));
    expect(parsed?.dimensions.widthMm).toBeCloseTo(inchesToMm(2.5));
  });

  it("prefers the explicit-unit variant when only the parenthetical carries a unit", () => {
    // Bare imperial outside, cm inside the parens — the cm reading wins because
    // it is the only variant with an explicit unit.
    const dual = parseImportedDimensions("9 5/16 × 2 1/2 (23.6 × 6.3 cm)", "in");
    expect(dual?.dimensions.displayUnit).toBe("cm");
    expect(dual?.dimensions.heightMm).toBeCloseTo(236);
    expect(dual?.dimensions.widthMm).toBeCloseTo(63);
  });

  it("applies a manual unit override to a bare combined cell (high confidence, no warning)", () => {
    const parsed = parseImportedDimensions("24 x 30", "in", "height-first", "cm");

    expect(parsed?.dimensions.heightMm).toBeCloseTo(240);
    expect(parsed?.dimensions.widthMm).toBeCloseTo(300);
    expect(parsed?.dimensions.displayUnit).toBe("cm");
    expect(parsed?.confidence).toBe("high");
    expect(parsed?.warnings.some((warning) => /No unit found/.test(warning))).toBe(false);
  });

  it("lets an inline unit in a combined cell win over a manual override", () => {
    const parsed = parseImportedDimensions("24 x 30 in", "cm", "height-first", "cm");

    expect(parsed?.dimensions.heightMm).toBeCloseTo(inchesToMm(24));
    expect(parsed?.dimensions.widthMm).toBeCloseTo(inchesToMm(30));
  });

  it("swaps to width-first when the order option requests it", () => {
    const heightFirst = parseImportedDimensions("12 x 13 in", "in", "height-first");
    expect(heightFirst?.dimensions.heightMm).toBeCloseTo(inchesToMm(12));
    expect(heightFirst?.dimensions.widthMm).toBeCloseTo(inchesToMm(13));

    const widthFirst = parseImportedDimensions("12 x 13 in", "in", "width-first");
    expect(widthFirst?.dimensions.heightMm).toBeCloseTo(inchesToMm(13));
    expect(widthFirst?.dimensions.widthMm).toBeCloseTo(inchesToMm(12));
  });
});

describe("dimensionsFromColumns", () => {
  it("uses explicit width and height columns as Sightlines width and height", () => {
    const parsed = dimensionsFromColumns({
      height: "77",
      width: "53",
      defaultUnit: "cm"
    });

    expect(parsed?.dimensions.heightMm).toBeCloseTo(770);
    expect(parsed?.dimensions.widthMm).toBeCloseTo(530);
    expect(parsed?.dimensions.status).toBe("known");
  });

  it("uses a cm column hint instead of an imperial project default (Mona Lisa regression)", () => {
    const parsed = dimensionsFromColumns({
      height: "77",
      width: "53",
      heightUnitHint: "cm",
      widthUnitHint: "cm",
      defaultUnit: "in"
    });

    expect(parsed?.dimensions.heightMm).toBeCloseTo(770);
    expect(parsed?.dimensions.widthMm).toBeCloseTo(530);
    expect(parsed?.dimensions.displayUnit).toBe("cm");
  });

  it("lets an inline unit in the cell text win over a conflicting column hint", () => {
    const parsed = dimensionsFromColumns({
      height: "30 in",
      heightUnitHint: "cm",
      defaultUnit: "cm"
    });

    expect(parsed?.dimensions.heightMm).toBeCloseTo(inchesToMm(30));
  });

  it("maps an mm hint to a cm displayUnit", () => {
    const parsed = dimensionsFromColumns({
      height: "770",
      heightUnitHint: "mm",
      defaultUnit: "cm"
    });

    expect(parsed?.dimensions.displayUnit).toBe("cm");
  });

  it("falls back to the project default with a warning and medium confidence when no hints exist", () => {
    const parsed = dimensionsFromColumns({
      height: "24",
      width: "30",
      defaultUnit: "in"
    });

    expect(parsed?.dimensions.heightMm).toBeCloseTo(inchesToMm(24));
    expect(parsed?.dimensions.widthMm).toBeCloseTo(inchesToMm(30));
    expect(parsed?.warnings.some((warning) => /No unit found/.test(warning))).toBe(true);
    expect(parsed?.confidence).toBe("medium");
  });

  it("applies a manual unit override to bare numbers with no warning and high confidence", () => {
    const parsed = dimensionsFromColumns({
      height: "24",
      width: "30",
      defaultUnit: "in",
      unitOverride: "cm"
    });

    expect(parsed?.dimensions.heightMm).toBeCloseTo(240);
    expect(parsed?.dimensions.widthMm).toBeCloseTo(300);
    expect(parsed?.dimensions.displayUnit).toBe("cm");
    expect(parsed?.warnings.some((warning) => /No unit found/.test(warning))).toBe(false);
    expect(parsed?.confidence).toBe("high");
  });

  it("lets an inline cell unit win over a manual override", () => {
    const parsed = dimensionsFromColumns({
      height: "30 in",
      defaultUnit: "cm",
      unitOverride: "cm"
    });

    expect(parsed?.dimensions.heightMm).toBeCloseTo(inchesToMm(30));
  });

  it("lets a column-header hint win over a manual override", () => {
    const parsed = dimensionsFromColumns({
      height: "77",
      heightUnitHint: "cm",
      defaultUnit: "in",
      unitOverride: "mm"
    });

    // The header says cm, so 77 is 770mm — not 77mm from the override.
    expect(parsed?.dimensions.heightMm).toBeCloseTo(770);
  });
});

describe("detectUnitFromLabel", () => {
  it("finds a unit in an underscored header where a raw \\b regex would miss it", () => {
    expect(detectUnitFromLabel("height_cm")).toBe("cm");
  });

  it("returns undefined when the label has no unit", () => {
    expect(detectUnitFromLabel("Height")).toBeUndefined();
  });
});
