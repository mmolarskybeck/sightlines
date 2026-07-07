import { describe, expect, it } from "vitest";
import { feetToMm, formatLength, inchesToMm, parseLength } from "./length";

describe("parseLength", () => {
  it("parses feet and inches", () => {
    const result = parseLength(`5'6"`, "in");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.valueMm : 0).toBeCloseTo(inchesToMm(66));
  });

  it("parses mixed fractional inches", () => {
    const result = parseLength(`24 3/8 in`, "in");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.valueMm : 0).toBeCloseTo(inchesToMm(24.375));
  });

  it("parses bare fractions as inches", () => {
    const result = parseLength(`3/8"`, "in");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.valueMm : 0).toBeCloseTo(inchesToMm(0.375));
  });

  it("uses the context unit for bare numbers", () => {
    const result = parseLength("12", "ft");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.valueMm : 0).toBeCloseTo(feetToMm(12));
  });

  it("negates the ENTIRE compound value on a leading minus (feet + inches)", () => {
    // Regression: "-5' 3 9/16" is −(5' + 3 9/16"), NOT (−5') + 3 9/16".
    // 5' = 1524mm, 3 9/16" = 90.4875mm -> −1614.4875mm.
    const result = parseLength(`-5' 3 9/16"`, "in");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.valueMm : 0).toBeCloseTo(-1614.4875, 4);
  });

  it("negates the ENTIRE compound value on a leading minus (whole inch + fraction)", () => {
    // "-3 9/16" is −(3 9/16"), NOT −3 + 9/16 = −2 7/16".
    const result = parseLength(`-3 9/16"`, "in");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.valueMm : 0).toBeCloseTo(inchesToMm(-3.5625), 6);
  });

  it("round-trips a negative imperial length through format then parse", () => {
    const original = -1615.9;
    const formatted = formatLength(original, { unit: "ft" });
    const result = parseLength(formatted, "in");

    expect(result.ok).toBe(true);
    // Within 16th-of-an-inch rounding of the formatter.
    expect(result.ok ? result.valueMm : 0).toBeCloseTo(original, 0);
  });

  it("still parses plain negatives", () => {
    const inch = parseLength(`-3"`, "in");
    expect(inch.ok && inch.valueMm).toBeCloseTo(inchesToMm(-3));

    const foot = parseLength("-0.5'", "in");
    expect(foot.ok && foot.valueMm).toBeCloseTo(feetToMm(-0.5));

    const cm = parseLength("-10cm", "cm");
    expect(cm.ok && cm.valueMm).toBeCloseTo(-100);
  });
});

describe("formatLength", () => {
  it("formats feet and inches with reduced fractions", () => {
    expect(formatLength(inchesToMm(66.5), { unit: "ft" })).toBe(`5' 6 1/2"`);
  });

  it("formats secondary units", () => {
    expect(formatLength(inchesToMm(10), { unit: "in", secondaryUnit: "cm" })).toBe(
      `10" (25.4 cm)`
    );
  });
});
