import { describe, expect, it } from "vitest";
import {
  caseElevationGlyph,
  caseFloorGhostGlyph,
  casePlanGlyph,
  wallTextPlanGlyph
} from "./caseGlyphs";
import {
  CASE_BASE_SLAB_THICKNESS_MM,
  CASE_GLASS_THICKNESS_MM,
  CASE_LEG_INSET_MM,
  CASE_LEG_SIZE_MM,
  CASE_WALL_THICKNESS_MM,
  FLOOR_CASE_BOX_HEIGHT_MM
} from "../project";

// These pin the ON-SCREEN case-glyph construction that used to live inline in
// ElevationCase.tsx / PlanObject.tsx, now extracted here. The screen passes its
// zoom-clamped insets in; these tests exercise the raw-mm structure the module
// owns (which marks exist, where, thresholds, leg placement).

describe("caseElevationGlyph", () => {
  it("insets the glass lid between the tray walls and lays a full-width slab", () => {
    const glyph = caseElevationGlyph({ widthMm: 1500, heightMm: 180 });
    expect(glyph.showMarks).toBe(true);
    expect(glyph.glassLid).toEqual({
      x1Mm: CASE_WALL_THICKNESS_MM,
      x2Mm: 1500 - CASE_WALL_THICKNESS_MM,
      yMm: CASE_GLASS_THICKNESS_MM
    });
    expect(glyph.slab).toEqual({
      x1Mm: 0,
      x2Mm: 1500,
      yMm: 180 - CASE_WALL_THICKNESS_MM
    });
  });

  it("honors caller-supplied (clamped) insets over the raw defaults", () => {
    const glyph = caseElevationGlyph({
      widthMm: 1000,
      heightMm: 400,
      sideInsetMm: 50,
      glassBandMm: 12,
      slabBandMm: 30
    });
    expect(glyph.glassLid).toEqual({ x1Mm: 50, x2Mm: 950, yMm: 12 });
    expect(glyph.slab.yMm).toBe(370);
  });

  it("drops all inner marks when the box is too small for them to fit", () => {
    // Side inset consumes the whole width — the lid line would invert.
    const narrow = caseElevationGlyph({ widthMm: 30, heightMm: 200 });
    expect(narrow.showMarks).toBe(false);
    // Glass band and slab band would cross.
    const shallow = caseElevationGlyph({ widthMm: 400, heightMm: 20 });
    expect(shallow.showMarks).toBe(false);
  });
});

describe("caseFloorGhostGlyph", () => {
  it("adds a glass box, slab line, and two legs once tall enough", () => {
    const glyph = caseFloorGhostGlyph({ widthMm: 600, heightMm: 950 });
    expect(glyph.hasLegs).toBe(true);
    expect(glyph.glassBox).toEqual({ widthMm: 600, heightMm: FLOOR_CASE_BOX_HEIGHT_MM });
    expect(glyph.slabYMm).toBe(FLOOR_CASE_BOX_HEIGHT_MM + CASE_BASE_SLAB_THICKNESS_MM);
    expect(glyph.floorYMm).toBe(950);
    expect(glyph.legs).toEqual([
      { xMm: CASE_LEG_INSET_MM },
      { xMm: 600 - CASE_LEG_INSET_MM }
    ]);
  });

  it("falls back to a plain silhouette at or below the box+slab height", () => {
    const threshold = FLOOR_CASE_BOX_HEIGHT_MM + CASE_BASE_SLAB_THICKNESS_MM;
    expect(caseFloorGhostGlyph({ widthMm: 600, heightMm: threshold }).hasLegs).toBe(false);
    expect(caseFloorGhostGlyph({ widthMm: 600, heightMm: threshold + 1 }).hasLegs).toBe(true);
  });

  it("clamps the legs inside a projection narrower than the inset", () => {
    const glyph = caseFloorGhostGlyph({ widthMm: 30, heightMm: 950 });
    // Both legs collapse to within [0, width] rather than crossing outside it.
    expect(glyph.legs).toEqual([{ xMm: 30 }, { xMm: 0 }]);
  });
});

describe("casePlanGlyph", () => {
  it("insets the glass, hatches it, and places four legs for a floor case", () => {
    const glyph = casePlanGlyph({ widthMm: 1800, depthMm: 600, includeLegs: true });
    expect(glyph.glass).toEqual({
      x0Mm: -900 + CASE_WALL_THICKNESS_MM,
      y0Mm: -300 + CASE_WALL_THICKNESS_MM,
      x1Mm: 900 - CASE_WALL_THICKNESS_MM,
      y1Mm: 300 - CASE_WALL_THICKNESS_MM
    });
    expect(glyph.hatch.length).toBeGreaterThan(0);
    // Every hatch stroke runs the +45° diagonal (y = x + c).
    for (const line of glyph.hatch) {
      expect(line.y2Mm - line.y1Mm).toBeCloseTo(line.x2Mm - line.x1Mm, 6);
    }
    const legOffsetX = 900 - CASE_LEG_INSET_MM;
    const legOffsetD = 300 - CASE_LEG_INSET_MM;
    expect(glyph.legs).toEqual([
      { cxMm: -legOffsetX, cyMm: -legOffsetD, sizeMm: CASE_LEG_SIZE_MM },
      { cxMm: legOffsetX, cyMm: -legOffsetD, sizeMm: CASE_LEG_SIZE_MM },
      { cxMm: -legOffsetX, cyMm: legOffsetD, sizeMm: CASE_LEG_SIZE_MM },
      { cxMm: legOffsetX, cyMm: legOffsetD, sizeMm: CASE_LEG_SIZE_MM }
    ]);
  });

  it("draws no legs for a wall case (includeLegs=false)", () => {
    const glyph = casePlanGlyph({ widthMm: 1800, depthMm: 600, includeLegs: false });
    expect(glyph.legs).toEqual([]);
    expect(glyph.glass).not.toBeNull();
  });

  it("suppresses legs below the collision threshold even when floor-placed", () => {
    const min = 2 * (CASE_LEG_INSET_MM + CASE_LEG_SIZE_MM);
    expect(casePlanGlyph({ widthMm: min - 1, depthMm: 1000, includeLegs: true }).legs).toEqual([]);
    expect(casePlanGlyph({ widthMm: min, depthMm: 1000, includeLegs: true }).legs.length).toBe(4);
  });

  it("drops the glass and hatch when the wall inset leaves no span", () => {
    const glyph = casePlanGlyph({ widthMm: 30, depthMm: 30, includeLegs: true });
    expect(glyph.glass).toBeNull();
    expect(glyph.hatch).toEqual([]);
  });

  it("respects caller-supplied (clamped) wall inset and leg size", () => {
    const glyph = casePlanGlyph({
      widthMm: 1800,
      depthMm: 600,
      includeLegs: true,
      wallInsetMm: 60,
      legSizeMm: 25
    });
    expect(glyph.glass?.x0Mm).toBe(-900 + 60);
    expect(glyph.legs.every((leg) => leg.sizeMm === 25)).toBe(true);
  });
});

describe("wallTextPlanGlyph", () => {
  it("draws two centered text lines, the second shortened at its right end", () => {
    const glyph = wallTextPlanGlyph({ widthMm: 1000, depthMm: 200 });
    const inset = Math.min(1000, 200) * 0.22;
    const insetWidth = 1000 - inset * 2;
    expect(glyph.lines).toEqual([
      { x1Mm: -500 + inset, x2Mm: 500 - inset, yMm: -inset * 0.4 },
      { x1Mm: -500 + inset, x2Mm: 500 - inset - insetWidth * 0.35, yMm: inset * 0.4 }
    ]);
  });
});
