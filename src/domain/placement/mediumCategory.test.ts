import { describe, expect, it } from "vitest";
import {
  MEDIUM_SUGGESTIONS,
  defaultDisplayAsForCategory,
  mediumCategory
} from "./mediumCategory";

describe("mediumCategory — aliases", () => {
  it("maps every photograph spelling", () => {
    for (const medium of ["Photograph", "Photo", "Photography"]) {
      expect(mediumCategory(medium)).toBe("photograph");
    }
  });

  it("maps every film/video spelling", () => {
    for (const medium of ["Film/video", "Film", "Video"]) {
      expect(mediumCategory(medium)).toBe("video");
    }
  });

  it("maps every drawing/print spelling onto one category", () => {
    for (const medium of ["Drawing/print", "Drawing", "Print"]) {
      expect(mediumCategory(medium)).toBe("drawingPrint");
    }
  });

  it("maps the single-word categories", () => {
    expect(mediumCategory("Painting")).toBe("painting");
    expect(mediumCategory("Sculpture")).toBe("sculpture");
    expect(mediumCategory("Installation")).toBe("installation");
  });

  it("recognizes every string it offers as a suggestion", () => {
    // The datalist and the matcher must not be able to drift: a suggestion a
    // curator clicks has to produce a category, or the list would be lying.
    for (const suggestion of MEDIUM_SUGGESTIONS) {
      expect(mediumCategory(suggestion)).toBeDefined();
    }
  });
});

describe("mediumCategory — normalization", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(mediumCategory("  PAINTING  ")).toBe("painting");
    expect(mediumCategory("sCuLpTuRe")).toBe("sculpture");
  });

  it("ignores spacing around the slash", () => {
    expect(mediumCategory("Film / video")).toBe("video");
    expect(mediumCategory("drawing /print")).toBe("drawingPrint");
  });

  it("collapses runs of internal whitespace", () => {
    expect(mediumCategory("film  /  video")).toBe("video");
  });
});

describe("mediumCategory — exact match only (predictability over cleverness)", () => {
  it("does not match prose that merely contains a category word", () => {
    // The whole point of the rule: a free-text medium must never be able to
    // restage a work in the room behind the curator's back.
    expect(mediumCategory("Oil on canvas")).toBeUndefined();
    expect(mediumCategory("single-channel video, 12 min")).toBeUndefined();
    expect(mediumCategory("Gelatin silver print, edition of 5")).toBeUndefined();
    expect(mediumCategory("Bronze sculpture with patina")).toBeUndefined();
  });

  it("returns undefined for an absent or empty medium", () => {
    expect(mediumCategory(undefined)).toBeUndefined();
    expect(mediumCategory("")).toBeUndefined();
    expect(mediumCategory("   ")).toBeUndefined();
  });

  it("returns undefined for a word outside the vocabulary", () => {
    expect(mediumCategory("performance")).toBeUndefined();
  });
});

describe("defaultDisplayAsForCategory", () => {
  it("hangs the flat families framed", () => {
    expect(defaultDisplayAsForCategory("photograph")).toBe("framed");
    expect(defaultDisplayAsForCategory("painting")).toBe("framed");
    expect(defaultDisplayAsForCategory("drawingPrint")).toBe("framed");
  });

  it("throws video at a wall, and never assumes a monitor", () => {
    // A monitor is equipment the curator has to actually own; it is a choice,
    // never a default.
    expect(defaultDisplayAsForCategory("video")).toBe("projection");
  });

  it("stands sculpture and installation in the room", () => {
    expect(defaultDisplayAsForCategory("sculpture")).toBe("sculpture");
    expect(defaultDisplayAsForCategory("installation")).toBe("sculpture");
  });

  it("has no answer for an unrecognized category", () => {
    expect(defaultDisplayAsForCategory(undefined)).toBeUndefined();
  });
});
