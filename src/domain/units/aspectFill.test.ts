import { describe, expect, it } from "vitest";
import type { Dimensions } from "../project";
import { applyAspectFill, imageAspectRatio, isAspectLocked } from "./aspectFill";

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
    expect(next.aspectLocked).toBe(true);
  });

  it("derives width from height when the other axis is empty", () => {
    const next = applyAspectFill(dims(), "heightMm", 200, LANDSCAPE);
    expect(next.heightMm).toBe(200);
    expect(next.widthMm).toBe(300); // 200 × 1.5
    expect(next.aspectLocked).toBe(true);
  });

  it("re-derives the counterpart when the pair is explicitly locked", () => {
    // Existing 300×200 matches 1.5 and is locked; editing width to 600
    // should pull height to 400.
    const next = applyAspectFill(
      dims({ widthMm: 300, heightMm: 200, aspectLocked: true }),
      "widthMm",
      600,
      LANDSCAPE
    );
    expect(next.heightMm).toBe(400);
  });

  it("re-derives via the legacy tolerance fallback when aspectLocked is unset", () => {
    // Pre-existing data with no aspectLocked field: 305×200 is ~1.525, within
    // the 2% slack of 1.5, so isAspectLocked's fallback treats it as locked.
    const next = applyAspectFill(
      dims({ widthMm: 305, heightMm: 200 }),
      "widthMm",
      600,
      LANDSCAPE
    );
    expect(next.heightMm).toBe(400);
  });

  it("preserves a deliberately off-ratio counterpart (legacy fallback, no match)", () => {
    // Existing 300×500 is nowhere near 1.5 (a tall mat) and has no explicit
    // aspectLocked — the fallback heuristic sees no match, so editing width
    // must not clobber the curator's height.
    const next = applyAspectFill(
      dims({ widthMm: 300, heightMm: 500 }),
      "widthMm",
      600,
      LANDSCAPE
    );
    expect(next.widthMm).toBe(600);
    expect(next.heightMm).toBe(500);
  });

  it("never re-derives when explicitly unlocked, even if the pair still matches the ratio", () => {
    // Regression test: a curator auto-derived 300×200 (matches 1.5), then
    // unlocked it to enter a real, mismatched height. Before this fix,
    // committing height would clobber the already-correct width because the
    // pre-commit pair still matched the ratio.
    const next = applyAspectFill(
      dims({ widthMm: 300, heightMm: 200, aspectLocked: false }),
      "heightMm",
      220,
      LANDSCAPE
    );
    expect(next.heightMm).toBe(220);
    expect(next.widthMm).toBe(300);
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

describe("isAspectLocked", () => {
  it("honors an explicit true regardless of whether the pair matches", () => {
    expect(
      isAspectLocked(
        dims({ widthMm: 300, heightMm: 500, aspectLocked: true }),
        LANDSCAPE
      )
    ).toBe(true);
  });

  it("honors an explicit false regardless of whether the pair matches", () => {
    expect(
      isAspectLocked(
        dims({ widthMm: 300, heightMm: 200, aspectLocked: false }),
        LANDSCAPE
      )
    ).toBe(false);
  });

  it("falls back to tolerance-matching when aspectLocked is unset", () => {
    expect(isAspectLocked(dims({ widthMm: 300, heightMm: 200 }), LANDSCAPE)).toBe(
      true
    );
    expect(isAspectLocked(dims({ widthMm: 300, heightMm: 500 }), LANDSCAPE)).toBe(
      false
    );
  });

  it("falls back to false when unset and there is no usable image ratio", () => {
    expect(isAspectLocked(dims(), {})).toBe(false);
  });

  it("honors an explicit true even with no usable image ratio", () => {
    // The caller (ArtworkInspector) is expected to gate the lock UI on
    // imageAspectRatio itself; isAspectLocked just reports the stored intent.
    expect(isAspectLocked(dims({ aspectLocked: true }), {})).toBe(true);
  });
});
