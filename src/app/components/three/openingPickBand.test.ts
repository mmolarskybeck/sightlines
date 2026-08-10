import { describe, expect, it } from "vitest";
import {
  OPENING_PICK_BAND_WIDTH_MM,
  openingPickBandRects,
  type PickBandRect
} from "./openingPickBand";

// Deliberately off-origin and unequal on both axes so a transposed axis or a
// dropped offset can't pass: a 900 x 2100 doorway starting 1200mm along the
// wall, floor to head.
const DOORWAY = { xMinMm: 1200, xMaxMm: 2100, yMinMm: 0, yMaxMm: 2100 };

function contains(rect: PickBandRect, xMm: number, yMm: number): boolean {
  return (
    Math.abs(xMm - rect.centerXMm) <= rect.widthMm / 2 &&
    Math.abs(yMm - rect.centerYMm) <= rect.heightMm / 2
  );
}

function covered(rects: PickBandRect[], xMm: number, yMm: number): boolean {
  return rects.some((rect) => contains(rect, xMm, yMm));
}

describe("openingPickBandRects", () => {
  it("returns four segments hugging the inside of the hole", () => {
    const rects = openingPickBandRects(DOORWAY);

    expect(rects).toHaveLength(4);
    // Every segment lies strictly inside the hole's own bounds — a band grown
    // outward would overhang the wall face around the aperture, stealing
    // clicks from the wall (and from anything hanging next to the door).
    for (const rect of rects) {
      expect(rect.centerXMm - rect.widthMm / 2).toBeGreaterThanOrEqual(DOORWAY.xMinMm);
      expect(rect.centerXMm + rect.widthMm / 2).toBeLessThanOrEqual(DOORWAY.xMaxMm);
      expect(rect.centerYMm - rect.heightMm / 2).toBeGreaterThanOrEqual(DOORWAY.yMinMm);
      expect(rect.centerYMm + rect.heightMm / 2).toBeLessThanOrEqual(DOORWAY.yMaxMm);
    }
  });

  it("covers a point just inside each edge", () => {
    const rects = openingPickBandRects(DOORWAY);
    const probeMm = 5; // well within the 60mm band

    expect(covered(rects, DOORWAY.xMinMm + probeMm, 1000)).toBe(true);
    expect(covered(rects, DOORWAY.xMaxMm - probeMm, 1000)).toBe(true);
    expect(covered(rects, 1650, DOORWAY.yMinMm + probeMm)).toBe(true);
    expect(covered(rects, 1650, DOORWAY.yMaxMm - probeMm)).toBe(true);
  });

  it("leaves the middle of the opening uncovered", () => {
    // THE point of the band: you look through a doorway at the next room, so
    // the aperture's middle must stay click-through or every work visible
    // through it becomes unselectable.
    const rects = openingPickBandRects(DOORWAY);

    expect(covered(rects, 1650, 1050)).toBe(false);
    // Just inside the band's inner boundary, on both axes.
    const inset = OPENING_PICK_BAND_WIDTH_MM + 1;
    expect(covered(rects, DOORWAY.xMinMm + inset, 1050)).toBe(false);
    expect(covered(rects, DOORWAY.xMaxMm - inset, 1050)).toBe(false);
    expect(covered(rects, 1650, DOORWAY.yMinMm + inset)).toBe(false);
    expect(covered(rects, 1650, DOORWAY.yMaxMm - inset)).toBe(false);
  });

  it("does not double up the corners", () => {
    // Horizontals span the full width; verticals fill only the gap between
    // them. Exactly one segment owns any given corner point.
    const rects = openingPickBandRects(DOORWAY);
    const hits = rects.filter((rect) =>
      contains(rect, DOORWAY.xMinMm + 1, DOORWAY.yMinMm + 1)
    );

    expect(hits).toHaveLength(1);
    // Total area = the band ring's area, which only holds if nothing overlaps.
    const total = rects.reduce((sum, rect) => sum + rect.widthMm * rect.heightMm, 0);
    const outer = (DOORWAY.xMaxMm - DOORWAY.xMinMm) * (DOORWAY.yMaxMm - DOORWAY.yMinMm);
    const innerW = DOORWAY.xMaxMm - DOORWAY.xMinMm - 2 * OPENING_PICK_BAND_WIDTH_MM;
    const innerH = DOORWAY.yMaxMm - DOORWAY.yMinMm - 2 * OPENING_PICK_BAND_WIDTH_MM;
    expect(total).toBeCloseTo(outer - innerW * innerH, 6);
  });

  it("degenerates to full coverage for an opening thinner than two bands", () => {
    // A wall-bounds-clamped sliver has no see-through middle worth keeping, and
    // segments wider than their own hole would overhang it. The clamp turns
    // the band into a solid target instead.
    const sliver = { xMinMm: 0, xMaxMm: 80, yMinMm: 0, yMaxMm: 2000 };
    const rects = openingPickBandRects(sliver);

    for (const rect of rects) {
      expect(rect.widthMm).toBeLessThanOrEqual(80);
      expect(rect.centerXMm - rect.widthMm / 2).toBeGreaterThanOrEqual(sliver.xMinMm);
      expect(rect.centerXMm + rect.widthMm / 2).toBeLessThanOrEqual(sliver.xMaxMm);
    }
    expect(covered(rects, 40, 1000)).toBe(true);
  });

  it("emits only the two horizontals when the band swallows the height", () => {
    const slot = { xMinMm: 0, xMaxMm: 1200, yMinMm: 1000, yMaxMm: 1100 };
    const rects = openingPickBandRects(slot);

    expect(rects).toHaveLength(2);
    expect(covered(rects, 600, 1050)).toBe(true);
  });

  it("emits nothing for a zero-area hole", () => {
    expect(openingPickBandRects({ xMinMm: 500, xMaxMm: 500, yMinMm: 0, yMaxMm: 2000 })).toEqual(
      []
    );
    expect(openingPickBandRects(DOORWAY, 0)).toEqual([]);
  });
});
