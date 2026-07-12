import { describe, expect, it } from "vitest";
import { fitArtworkImageSizeMm, textureNativeAspect } from "./artworkFit";

const RECT = { widthMm: 1000, heightMm: 1000 };

describe("fitArtworkImageSizeMm", () => {
  it("leaves a known-dimension placement at its authored rect (fills, as before)", () => {
    // Even with a wildly different native aspect, a known rect is trusted.
    expect(fitArtworkImageSizeMm(RECT, "known", 3)).toEqual(RECT);
  });

  it("leaves an approximate-dimension placement at its authored rect", () => {
    expect(fitArtworkImageSizeMm(RECT, "approximate", 3)).toEqual(RECT);
  });

  it("contains a wide image inside a square unknown rect (letterbox top/bottom)", () => {
    // 2:1 image in a 1000x1000 rect → full width, half height, centered.
    const fitted = fitArtworkImageSizeMm(RECT, "unknown", 2);
    expect(fitted).toEqual({ widthMm: 1000, heightMm: 500 });
    // Never exceeds the rect, and the native aspect is preserved.
    expect(fitted.widthMm).toBeLessThanOrEqual(RECT.widthMm);
    expect(fitted.heightMm).toBeLessThanOrEqual(RECT.heightMm);
    expect(fitted.widthMm / fitted.heightMm).toBeCloseTo(2);
  });

  it("contains a tall image inside a square unknown rect (pillarbox sides)", () => {
    // 1:2 image → full height, half width.
    const fitted = fitArtworkImageSizeMm(RECT, "unknown", 0.5);
    expect(fitted).toEqual({ widthMm: 500, heightMm: 1000 });
    expect(fitted.widthMm / fitted.heightMm).toBeCloseTo(0.5);
  });

  it("contains inside a non-square unknown rect, preserving native aspect", () => {
    // A 1600x900 (16:9) rect with a 1:1 native image → height-bound square.
    const fitted = fitArtworkImageSizeMm({ widthMm: 1600, heightMm: 900 }, "unknown", 1);
    expect(fitted).toEqual({ widthMm: 900, heightMm: 900 });
  });

  it("returns the rect unchanged when the aspect matches (meet == fill)", () => {
    const rect = { widthMm: 1600, heightMm: 900 };
    const fitted = fitArtworkImageSizeMm(rect, "unknown", 1600 / 900);
    expect(fitted.widthMm).toBeCloseTo(1600);
    expect(fitted.heightMm).toBeCloseTo(900);
  });

  it("falls back to the rect when the native aspect isn't usable yet", () => {
    expect(fitArtworkImageSizeMm(RECT, "unknown", undefined)).toEqual(RECT);
    expect(fitArtworkImageSizeMm(RECT, "unknown", 0)).toEqual(RECT);
    expect(fitArtworkImageSizeMm(RECT, "unknown", Number.NaN)).toEqual(RECT);
  });

  it("falls back to the rect for a degenerate rect", () => {
    const rect = { widthMm: 0, heightMm: 0 };
    expect(fitArtworkImageSizeMm(rect, "unknown", 1.5)).toEqual(rect);
  });

  it("treats an undefined status like known (missing record fills its rect)", () => {
    expect(fitArtworkImageSizeMm(RECT, undefined, 2)).toEqual(RECT);
  });
});

describe("textureNativeAspect", () => {
  it("returns width/height for a loaded image", () => {
    expect(textureNativeAspect({ width: 800, height: 400 })).toBeCloseTo(2);
  });

  it("returns undefined for a missing or unsized image", () => {
    expect(textureNativeAspect(undefined)).toBeUndefined();
    expect(textureNativeAspect(null)).toBeUndefined();
    expect(textureNativeAspect({ width: 0, height: 400 })).toBeUndefined();
    expect(textureNativeAspect({ width: 800, height: 0 })).toBeUndefined();
    expect(textureNativeAspect({})).toBeUndefined();
  });
});
