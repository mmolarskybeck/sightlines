import { describe, expect, it } from "vitest";
import type { Dimensions } from "../project";
import { applyAspectFill, imageAspectRatio } from "./aspectFill";

// A 3:2 landscape image (e.g. 3000×2000 px) — ratio 1.5.
const LANDSCAPE = { widthPx: 3000, heightPx: 2000 };

function dims(overrides: Partial<Dimensions> = {}): Dimensions {
  return { status: "known", ...overrides };
}

describe("imageAspectRatio", () => {
  it("returns width ÷ height", () => {
    expect(imageAspectRatio({ widthPx: 3000, heightPx: 2000 })).toBeCloseTo(1.5);
  });

  it("returns undefined when a pixel dimension is missing", () => {
    expect(imageAspectRatio({ widthPx: 3000 })).toBeUndefined();
    expect(imageAspectRatio({ heightPx: 2000 })).toBeUndefined();
    expect(imageAspectRatio({})).toBeUndefined();
  });

  it("returns undefined for non-positive pixel dimensions", () => {
    expect(imageAspectRatio({ widthPx: 0, heightPx: 2000 })).toBeUndefined();
    expect(imageAspectRatio({ widthPx: 3000, heightPx: -1 })).toBeUndefined();
  });
});

describe("applyAspectFill", () => {
  it("derives height from width when the other axis is empty", () => {
    const next = applyAspectFill(dims(), "widthMm", 300, LANDSCAPE);
    expect(next.widthMm).toBe(300);
    expect(next.heightMm).toBe(200); // 300 / 1.5
  });

  it("derives width from height when the other axis is empty", () => {
    const next = applyAspectFill(dims(), "heightMm", 200, LANDSCAPE);
    expect(next.heightMm).toBe(200);
    expect(next.widthMm).toBe(300); // 200 × 1.5
  });

  it("re-derives the counterpart when the previous pair matched the ratio", () => {
    // Existing 300×200 matches 1.5; editing width to 600 should pull height to 400.
    const next = applyAspectFill(
      dims({ widthMm: 300, heightMm: 200 }),
      "widthMm",
      600,
      LANDSCAPE
    );
    expect(next.heightMm).toBe(400);
  });

  it("re-derives when the previous pair matched within rounding tolerance", () => {
    // 305×200 is ~1.525, within the 2% slack of 1.5 — treated as a match.
    const next = applyAspectFill(
      dims({ widthMm: 305, heightMm: 200 }),
      "widthMm",
      600,
      LANDSCAPE
    );
    expect(next.heightMm).toBe(400);
  });

  it("preserves a deliberately off-ratio counterpart", () => {
    // Existing 300×500 is nowhere near 1.5 (a tall mat) — editing width must
    // not clobber the curator's height.
    const next = applyAspectFill(
      dims({ widthMm: 300, heightMm: 500 }),
      "widthMm",
      600,
      LANDSCAPE
    );
    expect(next.widthMm).toBe(600);
    expect(next.heightMm).toBe(500);
  });

  it("never derives from or into depth", () => {
    const next = applyAspectFill(
      dims({ depthMm: 40 }),
      "widthMm",
      300,
      LANDSCAPE
    );
    expect(next.depthMm).toBe(40);
    expect(next.heightMm).toBe(200);
  });

  it("does not auto-fill when the image ratio is unavailable", () => {
    const next = applyAspectFill(dims(), "widthMm", 300, {});
    expect(next.widthMm).toBe(300);
    expect(next.heightMm).toBeUndefined();
  });

  it("leaves status and other fields untouched", () => {
    const next = applyAspectFill(
      dims({ status: "approximate", displayUnit: "cm" }),
      "widthMm",
      300,
      LANDSCAPE
    );
    expect(next.status).toBe("approximate");
    expect(next.displayUnit).toBe("cm");
  });

  it("rounds a derived value to 0.01 mm", () => {
    // 7:5 image, width 100 → height 100 × 5/7 = 71.428…, rounded to 71.43.
    const next = applyAspectFill(dims(), "widthMm", 100, {
      widthPx: 700,
      heightPx: 500
    });
    // 100 / (700/500) = 100 / 1.4 = 71.4285… → 71.43
    expect(next.heightMm).toBe(71.43);
  });
});
