import { describe, expect, it } from "vitest";
import { DOOR_HEIGHT_MM, DOOR_WIDTH_MM } from "../placement/createOpening";
import type { DoorLeaf } from "../project";
import {
  DOOR_KNOB_HEIGHT_MM,
  DOOR_KNOB_INSET_MM,
  DOOR_KNOB_RADIUS_MM,
  DOOR_LEAF_REVEAL_INSET_MM,
  doorElevationGlyph,
  doorSwingPlanGlyph,
  doorSwingPlanGlyphFor
} from "./doorGlyphs";
import { mirrorDoorLeaf } from "./sharedWalls";

const DEPTH_MM = 150;

function planGlyph(hingeAtStart: boolean, swingsToLeft: boolean) {
  return doorSwingPlanGlyph({
    widthMm: DOOR_WIDTH_MM,
    depthMm: DEPTH_MM,
    hingeAtStart,
    swingsToLeft
  });
}

// The arc's midpoint is the honest test of "which quadrant does the swing eat":
// the two endpoints alone are satisfied by either sweep direction.
function arcMidpoint(glyph: ReturnType<typeof planGlyph>) {
  return glyph.arcPolyline(2)[1];
}

describe("doorSwingPlanGlyph — handing", () => {
  // Local frame: +x = the wall's authored start→end, +y = the left of it. Each
  // combination has to put the swept floor in its own quadrant, or two doors
  // with different handing would draw identically.
  it("hinge at start, swinging left: the arc sweeps toward the wall end, on the left", () => {
    const mid = arcMidpoint(planGlyph(true, true));
    expect(mid.xMm).toBeGreaterThan(0);
    expect(mid.yMm).toBeGreaterThan(0);
  });

  it("hinge at start, swinging right: same end of the wall, opposite side", () => {
    const mid = arcMidpoint(planGlyph(true, false));
    expect(mid.xMm).toBeGreaterThan(0);
    expect(mid.yMm).toBeLessThan(0);
  });

  it("hinge at end, swinging left: the arc sweeps back toward the wall start", () => {
    const mid = arcMidpoint(planGlyph(false, true));
    expect(mid.xMm).toBeLessThan(0);
    expect(mid.yMm).toBeGreaterThan(0);
  });

  it("hinge at end, swinging right", () => {
    const mid = arcMidpoint(planGlyph(false, false));
    expect(mid.xMm).toBeLessThan(0);
    expect(mid.yMm).toBeLessThan(0);
  });

  it("pivots on the hinge jamb and closes on the latch jamb, radius = the clear width", () => {
    const glyph = planGlyph(true, true);
    const halfWidthMm = DOOR_WIDTH_MM / 2;

    // Hinge at the start jamb, on the swing-side face of the opening rect.
    expect(glyph.leaf.x1Mm).toBeCloseTo(-halfWidthMm);
    expect(glyph.leaf.y1Mm).toBeCloseTo(DEPTH_MM / 2);
    // Open at 90°: straight out into the room, a clear width away.
    expect(glyph.leaf.x2Mm).toBeCloseTo(-halfWidthMm);
    expect(glyph.leaf.y2Mm).toBeCloseTo(DEPTH_MM / 2 + DOOR_WIDTH_MM);
    // ...and the arc lands exactly on the latch jamb, which is what makes the
    // radius the door's clear width rather than an arbitrary flourish.
    expect(glyph.arc.radiusMm).toBe(DOOR_WIDTH_MM);
    expect(glyph.arc.endXMm).toBeCloseTo(halfWidthMm);
    expect(glyph.arc.endYMm).toBeCloseTo(DEPTH_MM / 2);
    expect(Math.abs(glyph.arc.sweepDeg)).toBe(90);
    expect(glyph.arc.largeArcFlag).toBe(0);
  });

  it("hands the SVG sweep-flag over in the same frame the angles are in", () => {
    // sweepFlag=1 must mean "positive sweepDeg" — mixing the two conventions
    // draws the arc through the wall instead of the room.
    for (const [hinge, swing] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false]
    ] as const) {
      const glyph = planGlyph(hinge, swing);
      expect(glyph.arc.sweepFlag).toBe(glyph.arc.sweepDeg > 0 ? 1 : 0);
    }
  });
});

describe("doorSwingPlanGlyph — the mirrored twin", () => {
  // A shared door is two objects on two anti-parallel walls. Wall B's local
  // frame is wall A's negated on BOTH axes (opposite direction, opposite
  // interior), so this is the map from B-local back into A's frame.
  const asSeenFromTheOtherWall = (point: { xMm: number; yMm: number }) => ({
    xMm: -point.xMm,
    yMm: -point.yMm
  });

  it("lands in the same WORLD quadrant as the half it mirrors", () => {
    for (const leaf of [
      { hingeAtStart: true, swingsToLeft: true },
      { hingeAtStart: true, swingsToLeft: false },
      { hingeAtStart: false, swingsToLeft: true },
      { hingeAtStart: false, swingsToLeft: false }
    ] satisfies DoorLeaf[]) {
      const near = doorSwingPlanGlyphFor(leaf, { widthMm: DOOR_WIDTH_MM, depthMm: DEPTH_MM });
      const far = doorSwingPlanGlyphFor(mirrorDoorLeaf(leaf), {
        widthMm: DOOR_WIDTH_MM,
        depthMm: DEPTH_MM
      });

      const nearMid = arcMidpoint(near);
      const farMid = asSeenFromTheOtherWall(arcMidpoint(far));
      expect(farMid.xMm).toBeCloseTo(nearMid.xMm);
      expect(farMid.yMm).toBeCloseTo(nearMid.yMm);

      // The open leaf too, not just the arc: a mirror that got only the sweep
      // right would still draw the panel on the wrong jamb.
      expect(-far.leaf.x1Mm).toBeCloseTo(near.leaf.x1Mm);
      expect(-far.leaf.y1Mm).toBeCloseTo(near.leaf.y1Mm);
      expect(-far.leaf.x2Mm).toBeCloseTo(near.leaf.x2Mm);
      expect(-far.leaf.y2Mm).toBeCloseTo(near.leaf.y2Mm);
    }
  });
});

describe("doorSwingPlanGlyph — arcPolyline and bounds", () => {
  it("flattens the arc between the same two endpoints the SVG `A` command uses", () => {
    const glyph = planGlyph(true, true);
    const points = glyph.arcPolyline(8);

    expect(points).toHaveLength(9);
    expect(points[0].xMm).toBeCloseTo(glyph.arc.startXMm);
    expect(points[0].yMm).toBeCloseTo(glyph.arc.startYMm);
    expect(points[8].xMm).toBeCloseTo(glyph.arc.endXMm);
    expect(points[8].yMm).toBeCloseTo(glyph.arc.endYMm);
    // Every intermediate point is genuinely on the circle — print and screen
    // must trace the same curve, not merely start and end together.
    for (const point of points) {
      expect(Math.hypot(point.xMm - glyph.arc.cxMm, point.yMm - glyph.arc.cyMm)).toBeCloseTo(
        glyph.arc.radiusMm
      );
    }
  });

  it("survives a nonsense segment count rather than returning nothing to draw", () => {
    expect(planGlyph(true, true).arcPolyline(0)).toHaveLength(2);
  });

  it("bounds the whole swept quadrant, not just the chord", () => {
    for (const [hinge, swing] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false]
    ] as const) {
      const glyph = planGlyph(hinge, swing);
      const bounds = glyph.boundsMm;
      for (const point of [
        ...glyph.arcPolyline(64),
        { xMm: glyph.leaf.x1Mm, yMm: glyph.leaf.y1Mm },
        { xMm: glyph.leaf.x2Mm, yMm: glyph.leaf.y2Mm }
      ]) {
        expect(point.xMm).toBeGreaterThanOrEqual(bounds.minXMm - 0.001);
        expect(point.xMm).toBeLessThanOrEqual(bounds.maxXMm + 0.001);
        expect(point.yMm).toBeGreaterThanOrEqual(bounds.minYMm - 0.001);
        expect(point.yMm).toBeLessThanOrEqual(bounds.maxYMm + 0.001);
      }
    }
  });

  it("reaches a full clear width beyond the opening rect — the reason page fitting needs it", () => {
    // The swing is the only glyph in the app that leaves its own rect, so
    // bounds that merely echoed the rect would silently crop it in export.
    const glyph = planGlyph(true, true);
    expect(glyph.boundsMm.maxYMm).toBeCloseTo(DEPTH_MM / 2 + DOOR_WIDTH_MM);
    expect(glyph.boundsMm.maxXMm).toBeCloseTo(DOOR_WIDTH_MM / 2);
  });
});

describe("doorElevationGlyph", () => {
  it("insets the leaf and puts the knob on the latch stile at handle height", () => {
    const glyph = doorElevationGlyph({
      widthMm: DOOR_WIDTH_MM,
      heightMm: DOOR_HEIGHT_MM,
      hingeAtStart: true
    });

    expect(glyph.showMarks).toBe(true);
    expect(glyph.leafRect).toEqual({
      xMm: DOOR_LEAF_REVEAL_INSET_MM,
      yMm: DOOR_LEAF_REVEAL_INSET_MM,
      widthMm: DOOR_WIDTH_MM - DOOR_LEAF_REVEAL_INSET_MM * 2,
      heightMm: DOOR_HEIGHT_MM - DOOR_LEAF_REVEAL_INSET_MM * 2
    });
    // Inset from the LEAF's free edge, not the opening's jamb; y is measured
    // DOWN from the opening's top, so handle height inverts.
    expect(glyph.knob).toEqual({
      cxMm: DOOR_WIDTH_MM - DOOR_LEAF_REVEAL_INSET_MM - DOOR_KNOB_INSET_MM,
      cyMm: DOOR_HEIGHT_MM - DOOR_KNOB_HEIGHT_MM,
      radiusMm: DOOR_KNOB_RADIUS_MM
    });
    // No clamp on a standard door — the constants have to be mutually
    // consistent, not merely rescued by the clamp.
    expect(glyph.knob!.cxMm).toBeLessThanOrEqual(
      glyph.leafRect.xMm + glyph.leafRect.widthMm - DOOR_KNOB_RADIUS_MM
    );
  });

  it("moves the knob to the other stile when the hinge moves, and nothing else", () => {
    const atStart = doorElevationGlyph({
      widthMm: DOOR_WIDTH_MM,
      heightMm: DOOR_HEIGHT_MM,
      hingeAtStart: true
    });
    const atEnd = doorElevationGlyph({
      widthMm: DOOR_WIDTH_MM,
      heightMm: DOOR_HEIGHT_MM,
      hingeAtStart: false
    });

    expect(atEnd.knob?.cxMm).toBe(DOOR_LEAF_REVEAL_INSET_MM + DOOR_KNOB_INSET_MM);
    expect(atEnd.leafRect).toEqual(atStart.leafRect);
    expect(atEnd.knob?.cyMm).toBe(atStart.knob?.cyMm);
  });

  it("drops every mark on a door too small for the reveal to leave a panel", () => {
    const glyph = doorElevationGlyph({ widthMm: 60, heightMm: 60, hingeAtStart: true });

    expect(glyph.showMarks).toBe(false);
    expect(glyph.knob).toBeNull();
    // The rect is still non-negative, so a caller that ignores showMarks draws
    // nothing rather than an inverted rect.
    expect(glyph.leafRect.widthMm).toBe(0);
    expect(glyph.leafRect.heightMm).toBe(0);
  });

  it("keeps the panel but drops the knob when the panel cannot contain it", () => {
    // A narrow door: the leaf still reads, but no knob position leaves the full
    // radius clear of the stiles.
    const glyph = doorElevationGlyph({ widthMm: 120, heightMm: 2030, hingeAtStart: true });

    expect(glyph.showMarks).toBe(true);
    expect(glyph.leafRect.widthMm).toBe(40);
    expect(glyph.knob).toBeNull();
  });

  it("clamps the knob onto the panel on a door shorter than handle height", () => {
    const heightMm = 900; // below DOOR_KNOB_HEIGHT_MM: the raw y goes negative.
    const glyph = doorElevationGlyph({ widthMm: DOOR_WIDTH_MM, heightMm, hingeAtStart: true });

    expect(glyph.showMarks).toBe(true);
    expect(glyph.knob).not.toBeNull();
    const knob = glyph.knob!;
    expect(knob.cyMm).toBeGreaterThanOrEqual(glyph.leafRect.yMm + knob.radiusMm);
    expect(knob.cyMm).toBeLessThanOrEqual(
      glyph.leafRect.yMm + glyph.leafRect.heightMm - knob.radiusMm
    );
  });

  it("clamps the knob inside the stiles on a door narrower than the knob inset", () => {
    // Wide enough for the knob to fit, too narrow for its nominal inset.
    const widthMm = 160;
    const glyph = doorElevationGlyph({ widthMm, heightMm: 2030, hingeAtStart: true });

    const knob = glyph.knob!;
    expect(knob.cxMm).toBeGreaterThanOrEqual(glyph.leafRect.xMm + knob.radiusMm);
    expect(knob.cxMm).toBeLessThanOrEqual(
      glyph.leafRect.xMm + glyph.leafRect.widthMm - knob.radiusMm
    );
  });
});
