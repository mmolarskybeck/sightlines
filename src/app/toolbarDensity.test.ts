import { describe, expect, it } from "vitest";
import {
  chooseToolbarDensity,
  DEFAULT_TOOLBAR_FIT_BUFFER_PX,
  type ToolbarDensity
} from "./toolbarDensity";

const requiredWidths: Record<ToolbarDensity, number> = {
  comfortable: 1_000,
  trimmed: 820,
  condensed: 720,
  compact: 520,
  tight: 360
};

describe("chooseToolbarDensity", () => {
  it("keeps the full text layout when it fits with the safety buffer", () => {
    expect(chooseToolbarDensity(1_000 + DEFAULT_TOOLBAR_FIT_BUFFER_PX, requiredWidths)).toBe(
      "comfortable"
    );
  });

  it("trims the weakest-need labels one tier before condensing them all", () => {
    // A ~740px canvas column (this width) no longer fits the full labels but
    // keeps the priority Overlap + Precision labels the trimmed tier retains.
    expect(chooseToolbarDensity(850, requiredWidths)).toBe("trimmed");
  });

  it("condenses labels at the first actual fit boundary", () => {
    expect(chooseToolbarDensity(760, requiredWidths)).toBe("condensed");
  });

  it("uses the compact Insert menu when condensed controls do not fit", () => {
    expect(chooseToolbarDensity(600, requiredWidths)).toBe("compact");
  });

  it("falls back to the tight plus layout when every measured layout is too wide", () => {
    expect(chooseToolbarDensity(300, requiredWidths)).toBe("tight");
  });

  it("does not use a layout that only fits exactly at the edge", () => {
    expect(chooseToolbarDensity(999, requiredWidths)).toBe("trimmed");
  });

  it("supports a larger buffer for touch and visual breathing room", () => {
    expect(chooseToolbarDensity(1_008, requiredWidths, 8)).toBe("comfortable");
    expect(chooseToolbarDensity(1_007, requiredWidths, 8)).toBe("trimmed");
  });
});
