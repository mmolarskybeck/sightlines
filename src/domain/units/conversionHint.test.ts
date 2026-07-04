import { describe, expect, it } from "vitest";
import { getConversionHint } from "./conversionHint";

describe("getConversionHint", () => {
  it("returns null for empty input", () => {
    expect(getConversionHint("", { parseUnit: "in", displayUnit: "in" })).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(getConversionHint("   ", { parseUnit: "in", displayUnit: "in" })).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(getConversionHint("abc", { parseUnit: "in", displayUnit: "in" })).toBeNull();
  });

  describe("trivial-suffix suppression (parseUnit === displayUnit)", () => {
    it("suppresses hint for bare number in inch field", () => {
      expect(getConversionHint("24", { parseUnit: "in", displayUnit: "in" })).toBeNull();
    });

    it("suppresses hint for fraction in inch field", () => {
      expect(
        getConversionHint("24 1/2", { parseUnit: "in", displayUnit: "in" })
      ).toBeNull();
    });

    it("suppresses hint for bare number in cm field", () => {
      expect(getConversionHint("62", { parseUnit: "cm", displayUnit: "cm" })).toBeNull();
    });

    it("suppresses hint for decimal in m field", () => {
      expect(getConversionHint("3.8", { parseUnit: "m", displayUnit: "m" })).toBeNull();
    });
  });

  describe("ft always shows hint (even for bare numbers)", () => {
    it("shows hint for bare number in ft field", () => {
      expect(getConversionHint("80", { parseUnit: "ft", displayUnit: "ft" })).toBe("80'");
    });

    it("shows hint for decimal in ft field", () => {
      expect(getConversionHint("8.53", { parseUnit: "ft", displayUnit: "ft" })).toBe(
        "8' 6 3/8\""
      );
    });
  });

  describe("parseUnit ≠ displayUnit (openingSize imperial: ft display / in parse)", () => {
    it("converts 36 inches to feet format", () => {
      expect(getConversionHint("36", { parseUnit: "in", displayUnit: "ft" })).toBe("3'");
    });

    it("converts 80 inches to feet format", () => {
      expect(getConversionHint("80", { parseUnit: "in", displayUnit: "ft" })).toBe(
        "6' 8\""
      );
    });
  });

  describe("explicit cross-unit inputs", () => {
    it("converts 30cm typed into inch field", () => {
      expect(getConversionHint("30cm", { parseUnit: "in", displayUnit: "in" })).toBe(
        "11 13/16\""
      );
    });

    it("converts 1.5 ft typed into inch field", () => {
      expect(getConversionHint("1.5 ft", { parseUnit: "in", displayUnit: "in" })).toBe(
        "18\""
      );
    });
  });

  describe("exact-match suppression (already in canonical form)", () => {
    it("suppresses hint when input matches committed form exactly", () => {
      expect(
        getConversionHint("6' 8\"", { parseUnit: "ft", displayUnit: "ft" })
      ).toBeNull();
    });

    it("suppresses hint for unicode prime variants", () => {
      expect(
        getConversionHint("6′ 8″", { parseUnit: "ft", displayUnit: "ft" })
      ).toBeNull();
    });

    it("suppresses hint for extra whitespace", () => {
      expect(
        getConversionHint("6'  8\"", { parseUnit: "ft", displayUnit: "ft" })
      ).toBeNull();
    });

    it("suppresses hint when cm unit is already present", () => {
      expect(getConversionHint("62 cm", { parseUnit: "cm", displayUnit: "cm" })).toBeNull();
    });

    it("suppresses hint when input matches form with parse≠display", () => {
      expect(
        getConversionHint("6' 8\"", { parseUnit: "in", displayUnit: "ft" })
      ).toBeNull();
    });
  });
});
