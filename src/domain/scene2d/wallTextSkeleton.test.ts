import { describe, expect, it } from "vitest";
import { computeWallTextSkeleton } from "./wallTextSkeleton";

describe("computeWallTextSkeleton", () => {
  it("keeps every bar inside the normalized panel box", () => {
    const { bars } = computeWallTextSkeleton(600, 400);
    expect(bars.length).toBeGreaterThanOrEqual(2);
    for (const bar of bars) {
      expect(bar.xFrac).toBeGreaterThanOrEqual(0);
      expect(bar.yFrac).toBeGreaterThanOrEqual(0);
      expect(bar.xFrac + bar.widthFrac).toBeLessThanOrEqual(1);
      expect(bar.yFrac + bar.heightFrac).toBeLessThanOrEqual(1);
    }
  });

  it("makes the last line shorter than the others", () => {
    const { bars } = computeWallTextSkeleton(600, 400);
    const last = bars[bars.length - 1];
    const first = bars[0];
    expect(last.widthFrac).toBeLessThan(first.widthFrac);
  });

  it("scales the bar count with the panel's available height", () => {
    const short = computeWallTextSkeleton(600, 200);
    const tall = computeWallTextSkeleton(600, 900);
    expect(tall.bars.length).toBeGreaterThan(short.bars.length);
  });

  it("clamps the bar count within sane bounds for extreme aspects", () => {
    const veryTall = computeWallTextSkeleton(200, 5000);
    const veryWide = computeWallTextSkeleton(5000, 100);
    expect(veryTall.bars.length).toBeLessThanOrEqual(7);
    expect(veryWide.bars.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps padding symmetric in real length across axes", () => {
    const { padXFrac, padYFrac } = computeWallTextSkeleton(800, 400);
    // Same absolute inset both ways: the wider axis gets the smaller fraction.
    expect(padXFrac * 800).toBeCloseTo(padYFrac * 400, 5);
  });
});
