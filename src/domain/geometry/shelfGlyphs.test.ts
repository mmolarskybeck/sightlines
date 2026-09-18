import { describe, expect, it } from "vitest";
import {
  shelfBottomYMm,
  shelfCenterYMmForTop,
  shelfElevationGlyph,
  shelfPlanGlyph,
  shelfTopYMm
} from "./shelfGlyphs";
import {
  DEFAULT_SHELF_DEPTH_MM,
  DEFAULT_SHELF_THICKNESS_MM,
  DEFAULT_SHELF_TOP_MM,
  DEFAULT_SHELF_WIDTH_MM,
  SHELF_END_MARGIN_MM,
  SHELF_TOP_SNAP_TOLERANCE_MM
} from "../project";

// The shelf's whole geometry is the centre↔top arithmetic plus two trivial
// rects; these pin the arithmetic, because EVERY other shelf behavior (the
// snap target, the rider test, the inspector's Top height field) is expressed
// in terms of the top face while the document stores the centre.

describe("shelf heights", () => {
  it("reads the top and bottom faces off the stored slab centre", () => {
    const shelf = { yMm: 1180, heightMm: 40 };
    expect(shelfTopYMm(shelf)).toBe(1200);
    expect(shelfBottomYMm(shelf)).toBe(1160);
  });

  it("round-trips a top height back to the stored centre", () => {
    expect(shelfCenterYMmForTop(1200, 40)).toBe(1180);
    expect(shelfTopYMm({ yMm: shelfCenterYMmForTop(900, 25), heightMm: 25 })).toBe(900);
  });

  it("keeps the TOP fixed when the thickness changes", () => {
    // The inspector rule: a thickness edit grows the slab downward, because
    // the top face is what a work stands on and must not move under it.
    const topMm = shelfTopYMm({ yMm: 1180, heightMm: 40 });
    const thickened = { yMm: shelfCenterYMmForTop(topMm, 90), heightMm: 90 };
    expect(shelfTopYMm(thickened)).toBe(topMm);
    expect(shelfBottomYMm(thickened)).toBe(topMm - 90);
  });
});

describe("shelfElevationGlyph", () => {
  it("spans the slab's ends and its two faces in wall-local mm", () => {
    expect(
      shelfElevationGlyph({ xMm: 2000, widthMm: 1200, yMm: 1180, heightMm: 40 })
    ).toEqual({
      xMinMm: 1400,
      xMaxMm: 2600,
      bottomYMm: 1160,
      topYMm: 1200
    });
  });
});

describe("shelfPlanGlyph", () => {
  it("is the footprint outline in the local-centered frame", () => {
    expect(shelfPlanGlyph({ widthMm: 1200, depthMm: 300 }).outline).toEqual({
      x0Mm: -600,
      y0Mm: -150,
      x1Mm: 600,
      y1Mm: 150
    });
  });
});

describe("shelf defaults", () => {
  it("re-exports through project.ts with the authored values", () => {
    // project.ts re-exports these beside the case defaults; the cycle rule is
    // that shelfGlyphs may only import TYPES back from it. Reading them HERE
    // through project.ts is what proves the re-export is wired.
    expect(DEFAULT_SHELF_WIDTH_MM).toBe(1200);
    expect(DEFAULT_SHELF_THICKNESS_MM).toBe(40);
    expect(DEFAULT_SHELF_DEPTH_MM).toBe(300);
    expect(DEFAULT_SHELF_TOP_MM).toBe(1200);
    expect(SHELF_END_MARGIN_MM).toBe(100);
    expect(SHELF_TOP_SNAP_TOLERANCE_MM).toBe(2);
  });
});
