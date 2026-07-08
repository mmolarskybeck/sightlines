import { describe, expect, it } from "vitest";
import { inchesToMm } from "../units/length";
import { dimensionsFromColumns, parseImportedDimensions } from "./dimensions";

describe("parseImportedDimensions", () => {
  it("prefers framed dimensions over image dimensions", () => {
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
});
