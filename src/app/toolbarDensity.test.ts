import { describe, expect, it } from "vitest";
import {
  chooseToolbarDensity,
  DEFAULT_TOOLBAR_FIT_BUFFER_PX,
  type ToolbarDensity
} from "./toolbarDensity";

const requiredWidths: Record<ToolbarDensity, number> = {
  comfortable: 1_000,
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

  it("condenses labels at the first actual fit boundary", () => {
    expect(chooseToolbarDensity(900, requiredWidths)).toBe("condensed");
  });

  it("uses the compact Insert menu when condensed controls do not fit", () => {
    expect(chooseToolbarDensity(600, requiredWidths)).toBe("compact");
  });

  it("falls back to the tight plus layout when every measured layout is too wide", () => {
    expect(chooseToolbarDensity(300, requiredWidths)).toBe("tight");
  });

  it("does not use a layout that only fits exactly at the edge", () => {
    expect(chooseToolbarDensity(999, requiredWidths)).toBe("condensed");
  });

  it("supports a larger buffer for touch and visual breathing room", () => {
    expect(chooseToolbarDensity(1_008, requiredWidths, 8)).toBe("comfortable");
    expect(chooseToolbarDensity(1_007, requiredWidths, 8)).toBe("condensed");
  });
});
