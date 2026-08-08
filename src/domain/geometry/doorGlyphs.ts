// Hinged-door glyph construction — the single source of truth for how a door's
// leaf and swing are drawn, in plan and in elevation, on every surface (screen
// SVG, PDF export, the PDF preview). Pure, mm-space, no React/pixel/zoom
// knowledge, following the caseGlyphs.ts precedent: this module owns the
// STRUCTURE and returns raw mm; callers apply their own coordinate mapping.
//
// Unlike caseGlyphs, this module ALSO owns its rendering constants (leaf
// thickness, knob height/inset/radius, the drawn reveal). They are not
// curatorial defaults a user ever adjusts — they describe how a door is
// depicted — so they do not belong in the placement-defaults module beside
// DOOR_WIDTH_MM.
//
// Coordinate conventions:
// - Plan glyphs are returned in a LOCAL-CENTERED frame (origin at the opening
//   rect's center), with +x = the wall's AUTHORED start→end direction and
//   +y = the LEFT of that direction. In a PlanRect's local coordinates that is
//   the bottomY side — the same left normal (-sin, cos) that
//   offsetPlanRectToViewerSide (planObjects.ts) already uses, and the frame
//   both the screen <g transform="rotate(...)"> and the PDF's
//   planRectWorldPoint expect. `swingsToLeft` therefore sweeps toward +y.
// - Elevation glyphs are returned in a LOCAL frame with origin at the opening's
//   top-left, x rightward (= authored wall x, mapped straight through by
//   elevationScene), y DOWNWARD (SVG-natural). The PDF, whose model space is
//   y-up, flips y itself.

import type { DoorLeaf } from "../project";

// ─── Drawn-door constants ──────────────────────────────────────────────────

// Leaf panel thickness — a real single-leaf door slab. Used by the 3D shut-leaf
// box; plan and elevation draw the leaf as a line/rect and do not consume it.
export const DOOR_LEAF_THICKNESS_MM = 45;

// Knob center height above the door's BOTTOM edge (not above the floor — a
// door's bottom is its floor, and this stays right if one is ever raised).
export const DOOR_KNOB_HEIGHT_MM = 1000;

// Knob center distance in from the LATCH STILE — the leaf's own free edge, not
// the opening's jamb. Measuring from the jamb instead would put the knob
// DOOR_LEAF_REVEAL_INSET_MM further out and, on a standard door, past the
// panel edge it belongs on.
export const DOOR_KNOB_INSET_MM = 65;

export const DOOR_KNOB_RADIUS_MM = 28;

// The gap drawn between the opening's frame and the leaf panel in elevation.
// Deliberately far larger than a real ~3 mm door reveal: at plan/print scale a
// true reveal collapses onto the frame line and the leaf stops reading as a
// separate panel. It is a DRAWING inset, like caseGlyphs' insets, not a
// construction dimension.
export const DOOR_LEAF_REVEAL_INSET_MM = 40;

// ─── Plan swing glyph ──────────────────────────────────────────────────────

export type DoorGlyphPointMm = { xMm: number; yMm: number };

export type DoorGlyphBoundsMm = {
  minXMm: number;
  minYMm: number;
  maxXMm: number;
  maxYMm: number;
};

export type DoorSwingPlanGlyph = {
  // The leaf, drawn open at 90°: from the hinge jamb straight out into the
  // swing side. This is the architectural convention — a plan shows the door
  // where it is NOT (open), because that is the floor the swing consumes.
  leaf: { x1Mm: number; y1Mm: number; x2Mm: number; y2Mm: number };
  // The quarter-circle from the open leaf's tip round to the latch jamb.
  // Angles are degrees in the local frame described at the top of the file
  // (atan2(y, x), so a positive sweep runs the same way SVG's sweep-flag=1
  // does). `sweepFlag`/`largeArcFlag` are handed over ready for an SVG `A`
  // command, whose endpoints are (startXMm,startYMm) → (endXMm,endYMm).
  arc: {
    cxMm: number;
    cyMm: number;
    radiusMm: number;
    startAngleDeg: number;
    sweepDeg: number;
    startXMm: number;
    startYMm: number;
    endXMm: number;
    endYMm: number;
    sweepFlag: 0 | 1;
    largeArcFlag: 0;
  };
  // The arc flattened to a polyline, for pdf-lib — it has no arc primitive, so
  // print cannot consume the `A` command SVG uses. Same module, same numbers:
  // that is the point of flattening here rather than in the export.
  arcPolyline: (segments?: number) => DoorGlyphPointMm[];
  // Paint extents of the LEAF AND ARC ONLY, in the same local-centered frame.
  // Deliberately excludes the opening rect: callers already have that (as
  // renderedRect) and union the two. This exists because the swing is the only
  // glyph in the app that leaves its own rect, so PDF page fitting has to grow
  // its bounds for it.
  boundsMm: DoorGlyphBoundsMm;
};

// Default flattening resolution: 8 segments over 90° is ~11° per chord, whose
// sagitta on a 915 mm door is under 5 mm — well below a print hairline at any
// plan scale this app produces.
const DEFAULT_ARC_SEGMENTS = 8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function doorSwingPlanGlyph({
  widthMm,
  depthMm,
  hingeAtStart,
  swingsToLeft
}: {
  widthMm: number;
  depthMm: number;
  hingeAtStart: boolean;
  swingsToLeft: boolean;
}): DoorSwingPlanGlyph {
  const halfWidthMm = widthMm / 2;
  // The hinge sits on the swing-side face of the opening rect, not on the wall
  // centerline: the leaf swings within the room it opens into, so its pivot is
  // on that face. With no depth at all this degenerates harmlessly to the
  // centerline.
  const swingSign = swingsToLeft ? 1 : -1;
  // Which way the latch jamb lies from the hinge, along the wall.
  const latchSign = hingeAtStart ? 1 : -1;

  const hingeXMm = -latchSign * halfWidthMm;
  const hingeYMm = (swingSign * depthMm) / 2;

  // Open at 90°: perpendicular to the wall, on the swing side. Radius is the
  // door's clear width, so the arc closes exactly on the latch jamb.
  const tipXMm = hingeXMm;
  const tipYMm = hingeYMm + swingSign * widthMm;
  const latchXMm = hingeXMm + latchSign * widthMm;
  const latchYMm = hingeYMm;

  // Both endpoints lie on an axis through the hinge, so the angles are exact
  // multiples of 90° — written out rather than atan2'd so the four combinations
  // are readable, and so a zero-width door cannot produce NaN.
  const startAngleDeg = swingSign * 90;
  const endAngleDeg = latchSign > 0 ? 0 : 180;
  // A quarter turn whose direction is the product of the two flags: flipping
  // either flag reverses it, flipping both leaves it unchanged (which is
  // exactly the mirrored-twin case — see mirrorDoorLeaf).
  const sweepDeg = -latchSign * swingSign * 90;

  const boundsMm: DoorGlyphBoundsMm = {
    minXMm: Math.min(hingeXMm, tipXMm, latchXMm),
    minYMm: Math.min(hingeYMm, tipYMm, latchYMm),
    maxXMm: Math.max(hingeXMm, tipXMm, latchXMm),
    maxYMm: Math.max(hingeYMm, tipYMm, latchYMm)
  };
  // A 90° arc bulges past the chord between its endpoints, and on exactly one
  // axis it can also reach past both — whenever a cardinal direction falls
  // strictly inside the sweep. Test the four cardinals rather than assuming,
  // so this stays correct if the sweep is ever something other than a quarter.
  const sweepLoDeg = Math.min(startAngleDeg, startAngleDeg + sweepDeg);
  const sweepHiDeg = Math.max(startAngleDeg, startAngleDeg + sweepDeg);
  for (const cardinalDeg of [-180, -90, 0, 90, 180, 270]) {
    if (cardinalDeg < sweepLoDeg || cardinalDeg > sweepHiDeg) continue;
    const xMm = hingeXMm + widthMm * Math.cos(toRadians(cardinalDeg));
    const yMm = hingeYMm + widthMm * Math.sin(toRadians(cardinalDeg));
    boundsMm.minXMm = Math.min(boundsMm.minXMm, xMm);
    boundsMm.minYMm = Math.min(boundsMm.minYMm, yMm);
    boundsMm.maxXMm = Math.max(boundsMm.maxXMm, xMm);
    boundsMm.maxYMm = Math.max(boundsMm.maxYMm, yMm);
  }

  return {
    leaf: { x1Mm: hingeXMm, y1Mm: hingeYMm, x2Mm: tipXMm, y2Mm: tipYMm },
    arc: {
      cxMm: hingeXMm,
      cyMm: hingeYMm,
      radiusMm: widthMm,
      startAngleDeg,
      sweepDeg,
      startXMm: tipXMm,
      startYMm: tipYMm,
      endXMm: latchXMm,
      endYMm: latchYMm,
      sweepFlag: sweepDeg >= 0 ? 1 : 0,
      largeArcFlag: 0
    },
    arcPolyline(segments = DEFAULT_ARC_SEGMENTS) {
      const count = Math.max(1, Math.floor(segments));
      const points: DoorGlyphPointMm[] = [];
      for (let index = 0; index <= count; index++) {
        const angleDeg = startAngleDeg + (sweepDeg * index) / count;
        points.push({
          xMm: hingeXMm + widthMm * Math.cos(toRadians(angleDeg)),
          yMm: hingeYMm + widthMm * Math.sin(toRadians(angleDeg))
        });
      }
      return points;
    },
    boundsMm
  };
}

// ─── Elevation leaf glyph ──────────────────────────────────────────────────

export type DoorElevationGlyph = {
  // False when the reveal leaves no panel at all — then the caller draws only
  // the plain opening outline, exactly as a doorway is drawn today. Same
  // showMarks contract as caseElevationGlyph, and a flat shape rather than a
  // discriminated union for the same reason: every consumer wants to read
  // `leafRect` behind one boolean, not narrow a union in three renderers.
  showMarks: boolean;
  // The leaf panel, inset from the opening on all four sides.
  leafRect: { xMm: number; yMm: number; widthMm: number; heightMm: number };
  // The handle, on the LATCH side at handle height. Null when the panel is too
  // small to contain the knob — a knob drawn outside its own leaf is the
  // caseGlyphs `includeLegs` mistake in a different costume.
  knob: { cxMm: number; cyMm: number; radiusMm: number } | null;
};

// The front face of a hinged door. Deliberately takes only `hingeAtStart` and
// NOT `swingsToLeft`: an elevation cannot honestly show swing depth, which was
// the exact objection that removed the old unconditional swing arc (a1ebe03).
// It says which stile is the hinge stile — a fact an elevation can show — and
// nothing more.
export function doorElevationGlyph({
  widthMm,
  heightMm,
  hingeAtStart,
  revealInsetMm = DOOR_LEAF_REVEAL_INSET_MM,
  knobRadiusMm = DOOR_KNOB_RADIUS_MM
}: {
  widthMm: number;
  heightMm: number;
  hingeAtStart: boolean;
  revealInsetMm?: number;
  knobRadiusMm?: number;
}): DoorElevationGlyph {
  const leafWidthMm = widthMm - revealInsetMm * 2;
  const leafHeightMm = heightMm - revealInsetMm * 2;
  const showMarks = leafWidthMm > 0 && leafHeightMm > 0;
  const leafRect = {
    xMm: revealInsetMm,
    yMm: revealInsetMm,
    widthMm: Math.max(leafWidthMm, 0),
    heightMm: Math.max(leafHeightMm, 0)
  };

  // The knob has to fit INSIDE the panel with its full radius clear, so the
  // usable band is the leaf shrunk by the radius on every side. A door narrower
  // or shorter than that band has no legible knob position at all — drop it
  // rather than clamp it onto the panel edge, where it would read as a smudge
  // on the stile.
  const knobMinXMm = leafRect.xMm + knobRadiusMm;
  const knobMaxXMm = leafRect.xMm + leafRect.widthMm - knobRadiusMm;
  const knobMinYMm = leafRect.yMm + knobRadiusMm;
  const knobMaxYMm = leafRect.yMm + leafRect.heightMm - knobRadiusMm;
  if (!showMarks || knobMaxXMm < knobMinXMm || knobMaxYMm < knobMinYMm) {
    return { showMarks, leafRect, knob: null };
  }

  // Latch side = opposite the hinge, measured in from the leaf's own edge. y is
  // measured DOWN from the opening's top, so handle height (above the bottom)
  // inverts.
  const rawKnobXMm = hingeAtStart
    ? leafRect.xMm + leafRect.widthMm - DOOR_KNOB_INSET_MM
    : leafRect.xMm + DOOR_KNOB_INSET_MM;
  const rawKnobYMm = heightMm - DOOR_KNOB_HEIGHT_MM;
  return {
    showMarks,
    leafRect,
    knob: {
      // Clamped, not dropped: on a narrow-but-usable door the knob inset can
      // exceed the panel while the knob itself still fits, and a knob pinned to
      // the latch stile is right; on a door SHORTER than handle height the
      // clamp is what keeps the knob on the panel instead of above the head.
      cxMm: Math.min(Math.max(rawKnobXMm, knobMinXMm), knobMaxXMm),
      cyMm: Math.min(Math.max(rawKnobYMm, knobMinYMm), knobMaxYMm),
      radiusMm: knobRadiusMm
    }
  };
}

// Convenience for the surfaces that hold a whole `DoorLeaf` and a plan rect
// (the plan scene builder, the PDF page, the preview): keeps the flag→argument
// mapping in one place rather than repeating it at every call site.
export function doorSwingPlanGlyphFor(
  leaf: DoorLeaf,
  { widthMm, depthMm }: { widthMm: number; depthMm: number }
): DoorSwingPlanGlyph {
  return doorSwingPlanGlyph({
    widthMm,
    depthMm,
    hingeAtStart: leaf.hingeAtStart,
    swingsToLeft: leaf.swingsToLeft
  });
}
