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
