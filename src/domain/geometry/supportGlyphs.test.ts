import { describe, expect, it } from "vitest";
import {
  BONNET_CLEARANCE_MM,
  bonnetInsetMm,
  supportElevationGlyph
} from "./supportGlyphs";
import { CASE_GLASS_THICKNESS_MM } from "./caseGlyphs";

// The resolver, the normaliser, the plan-rect helpers and the default factory
// that used to live here are GONE with the attached-support model (schema v8,
// floor-supports spec §2). Their replacements are tested beside them:
// placement/floorRiders.test.ts owns the derived relationship, and
// placement/createSupport.test.ts owns the sizing defaults this file's
// defaultFloorSupport suite used to cover.

describe("bonnetInsetMm", () => {
  it("is the glass wall plus its clearance, per side", () => {
    expect(bonnetInsetMm()).toBe(CASE_GLASS_THICKNESS_MM + BONNET_CLEARANCE_MM);
  });
});

describe("supportElevationGlyph", () => {
  it("stands the block on the floor line with its top at heightMm", () => {
    const glyph = supportElevationGlyph({ xMinMm: 200, xMaxMm: 900, heightMm: 1000 });
    expect(glyph.block).toEqual({
      xMinMm: 200,
      xMaxMm: 900,
      bottomYMm: 0,
      topYMm: 1000
    });
    expect(glyph.bonnet).toBeNull();
    expect(glyph.totalHeightMm).toBe(1000);
  });

  it("rises the bonnet from the top face at the block's own span", () => {
    const glyph = supportElevationGlyph({
      xMinMm: 200,
      xMaxMm: 900,
      heightMm: 1000,
      bonnetHeightMm: 450
    });
    expect(glyph.bonnet).toEqual({
      xMinMm: 200,
      xMaxMm: 900,
      bottomYMm: 1000,
      topYMm: 1450
    });
    expect(glyph.totalHeightMm).toBe(1450);
  });

  it("reports a bonnet shorter than the works under it without clamping", () => {
    // A LOCKED bonnet may be under-typed (USER DECISION 2026-09-17). The glyph
    // states it as it is; the drawing shows the collision.
    const glyph = supportElevationGlyph({
      xMinMm: 0,
      xMaxMm: 600,
      heightMm: 900,
      bonnetHeightMm: 150
    });
    expect(glyph.bonnet?.topYMm).toBe(1050);
    expect(glyph.totalHeightMm).toBe(1050);
  });
});
