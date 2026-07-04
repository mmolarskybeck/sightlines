import { describe, expect, it } from "vitest";
import {
  displayUnitForSystem,
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "./unitSystem";

describe("unitSystemFromDisplayUnit", () => {
  it("maps inches to imperial", () => {
    expect(unitSystemFromDisplayUnit("in")).toBe("imperial");
  });

  it("maps feet to imperial", () => {
    expect(unitSystemFromDisplayUnit("ft")).toBe("imperial");
  });

  it("maps centimeters to metric", () => {
    expect(unitSystemFromDisplayUnit("cm")).toBe("metric");
  });

  it("maps meters to metric", () => {
    expect(unitSystemFromDisplayUnit("m")).toBe("metric");
  });
});

describe("displayUnitForSystem", () => {
  it("returns feet as the canonical imperial display unit", () => {
    expect(displayUnitForSystem("imperial")).toBe("ft");
  });

  it("returns meters as the canonical metric display unit", () => {
    expect(displayUnitForSystem("metric")).toBe("m");
  });
});

describe("getScopeUnits", () => {
  describe("imperial", () => {
    it("returns ft/ft for wall", () => {
      expect(getScopeUnits("imperial", "wall")).toEqual({
        displayUnit: "ft",
        parseUnit: "ft"
      });
    });

    it("returns in/in for artwork", () => {
      expect(getScopeUnits("imperial", "artwork")).toEqual({
        displayUnit: "in",
        parseUnit: "in"
      });
    });

    it("returns ft/in for openingSize (display ≠ parse)", () => {
      expect(getScopeUnits("imperial", "openingSize")).toEqual({
        displayUnit: "ft",
        parseUnit: "in"
      });
    });

    it("returns ft/ft for openingPosition", () => {
      expect(getScopeUnits("imperial", "openingPosition")).toEqual({
        displayUnit: "ft",
        parseUnit: "ft"
      });
    });
  });

  describe("metric", () => {
    it("returns m/m for wall", () => {
      expect(getScopeUnits("metric", "wall")).toEqual({
        displayUnit: "m",
        parseUnit: "m"
      });
    });

    it("returns cm/cm for artwork", () => {
      expect(getScopeUnits("metric", "artwork")).toEqual({
        displayUnit: "cm",
        parseUnit: "cm"
      });
    });

    it("returns cm/cm for openingSize", () => {
      expect(getScopeUnits("metric", "openingSize")).toEqual({
        displayUnit: "cm",
        parseUnit: "cm"
      });
    });

    it("returns cm/cm for openingPosition", () => {
      expect(getScopeUnits("metric", "openingPosition")).toEqual({
        displayUnit: "cm",
        parseUnit: "cm"
      });
    });
  });
});

describe("getPlaceholderForScope", () => {
  describe("imperial placeholders", () => {
    it("returns artwork placeholder", () => {
      expect(getPlaceholderForScope("imperial", "artwork")).toBe("e.g. 24 1/2\"");
    });

    it("returns wall placeholder", () => {
      expect(getPlaceholderForScope("imperial", "wall")).toBe("e.g. 12' 6\"");
    });

    it("returns openingSize placeholder", () => {
      expect(getPlaceholderForScope("imperial", "openingSize")).toBe("e.g. 6' 8\"");
    });

    it("returns openingPosition placeholder", () => {
      expect(getPlaceholderForScope("imperial", "openingPosition")).toBe("e.g. 4'");
    });
  });

  describe("metric placeholders", () => {
    it("returns artwork placeholder", () => {
      expect(getPlaceholderForScope("metric", "artwork")).toBe("e.g. 62 cm");
    });

    it("returns wall placeholder", () => {
      expect(getPlaceholderForScope("metric", "wall")).toBe("e.g. 3.8 m");
    });

    it("returns openingSize placeholder", () => {
      expect(getPlaceholderForScope("metric", "openingSize")).toBe("e.g. 203 cm");
    });

    it("returns openingPosition placeholder", () => {
      expect(getPlaceholderForScope("metric", "openingPosition")).toBe("e.g. 120 cm");
    });
  });
});
