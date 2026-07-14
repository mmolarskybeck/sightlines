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
});

describe("detectUnitFromLabel", () => {
  it("finds a unit in an underscored header where a raw \\b regex would miss it", () => {
    expect(detectUnitFromLabel("height_cm")).toBe("cm");
  });

  it("returns undefined when the label has no unit", () => {
    expect(detectUnitFromLabel("Height")).toBeUndefined();
  });
});
