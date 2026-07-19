// Display-case glyph construction — the single source of truth for how a
// case's real 3D geometry (CaseMesh.tsx's tray/glass/legs) is echoed as 2D
// marks in plan and elevation. Pure, mm-space, no React/pixel/zoom knowledge:
// callers (screen SVG, PDF export) apply their own coordinate mapping and, on
// screen, their own legibility clamp on top of the RAW mm structure returned
// here. This module owns the STRUCTURE (which marks exist, where, the leg
// threshold rule, leg placement); it does NOT own the per-surface clamp — a
// caller that clamps an inset for legibility passes the clamped value in.
//
// Coordinate conventions:
// - Elevation glyphs are returned in a LOCAL frame with origin at the box's
//   top-left, x rightward, y DOWNWARD (SVG-natural). The PDF, whose model
//   space is y-up, flips y itself.
// - Plan glyphs are returned in a LOCAL-CENTERED frame (origin at the
//   footprint center), x rightward, y downward — the frame both the screen
//   <g transform="rotate(...)"> and the PDF planRectWorldPoint expect.

import {
  CASE_BASE_SLAB_THICKNESS_MM,
  CASE_GLASS_THICKNESS_MM,
  CASE_LEG_INSET_MM,
  CASE_LEG_SIZE_MM,
  CASE_WALL_THICKNESS_MM,
  FLOOR_CASE_BOX_HEIGHT_MM
} from "../project";

// ─── Wall-case elevation (front face) ──────────────────────────────────────

export type CaseElevationGlyph = {
  // True when the inner marks fit without crossing the outline or each other;
  // when false the caller draws only the outline rect.
  showMarks: boolean;
  // A glass-lid line inset from the side walls, near the top edge.
  glassLid: { x1Mm: number; x2Mm: number; yMm: number };
  // A full-width base-slab line near the bottom edge.
  slab: { x1Mm: number; x2Mm: number; yMm: number };
};

// Front-face vitrine marks for a wall case: a glass-lid line inset by the tray
// wall thickness between the side walls (glassBand below the top), plus a
// bottom slab line (slabBand above the bottom). Insets default to the raw case
// constants; the screen passes its zoom-clamped values instead.
export function caseElevationGlyph({
  widthMm,
  heightMm,
  sideInsetMm = CASE_WALL_THICKNESS_MM,
  glassBandMm = CASE_GLASS_THICKNESS_MM,
  slabBandMm = CASE_WALL_THICKNESS_MM
}: {
  widthMm: number;
  heightMm: number;
  sideInsetMm?: number;
  glassBandMm?: number;
  slabBandMm?: number;
}): CaseElevationGlyph {
  const glassLidYMm = glassBandMm;
  const slabLineYMm = heightMm - slabBandMm;
  const lidX1Mm = sideInsetMm;
  const lidX2Mm = widthMm - sideInsetMm;
  return {
    // Too small for the lid line and slab line to fit without crossing (or the
    // side inset to leave any span) — skip every inner mark.
    showMarks: lidX2Mm > lidX1Mm && slabLineYMm > glassLidYMm,
    glassLid: { x1Mm: lidX1Mm, x2Mm: lidX2Mm, yMm: glassLidYMm },
    slab: { x1Mm: 0, x2Mm: widthMm, yMm: slabLineYMm }
  };
}

// ─── Floor-case elevation ghost (front projection) ─────────────────────────

export type CaseFloorGhostGlyph = {
  // False below the box+slab height floor: the caller draws a plain silhouette
  // rect (widthMm × heightMm) instead of the articulated glass/slab/legs.
  hasLegs: boolean;
  // The glass box at the top (meaningful only when hasLegs).
  glassBox: { widthMm: number; heightMm: number };
  // Local y (down from the ghost's top) of the base-slab line.
  slabYMm: number;
  // Local y of the floor line (= heightMm) — legs run from slabYMm to here.
  floorYMm: number;
  // Local x of each vertical leg line (two, an along-wall approximation).
  legs: { xMm: number }[];
};

// The front projection of a freestanding floor case: when tall enough, a glass
// box atop a base slab with two legs dropping to the floor; otherwise a plain
// silhouette (hasLegs=false). Legs are inset CASE_LEG_INSET_MM from each edge
// of the projected extent, clamped inside it on a narrow projection.
export function caseFloorGhostGlyph({
  widthMm,
  heightMm
}: {
  widthMm: number;
  heightMm: number;
}): CaseFloorGhostGlyph {
  const hasLegs = heightMm > FLOOR_CASE_BOX_HEIGHT_MM + CASE_BASE_SLAB_THICKNESS_MM;
  const glassBoxHeightMm = Math.min(FLOOR_CASE_BOX_HEIGHT_MM, heightMm);
  const slabYMm = FLOOR_CASE_BOX_HEIGHT_MM + CASE_BASE_SLAB_THICKNESS_MM;
  const legStartMm = Math.min(CASE_LEG_INSET_MM, widthMm);
  const legEndMm = Math.max(widthMm - CASE_LEG_INSET_MM, 0);
  return {
    hasLegs,
    glassBox: { widthMm, heightMm: glassBoxHeightMm },
    slabYMm,
    floorYMm: heightMm,
    legs: [{ xMm: legStartMm }, { xMm: legEndMm }]
  };
}

// ─── Plan case glyph ───────────────────────────────────────────────────────

export type CasePlanGlyph = {
  // Inner glass rect (local-centered), or null when the wall inset leaves no
  // glass span — then no hatch either.
  glass: { x0Mm: number; y0Mm: number; x1Mm: number; y1Mm: number } | null;
  // Sparse 45° glazing hatch lines across the glass surface.
  hatch: { x1Mm: number; y1Mm: number; x2Mm: number; y2Mm: number }[];
  // Square leg footprints (empty for a wall case, or when the footprint is too
  // small for legs to sit inside CASE_LEG_INSET_MM without colliding).
  legs: { cxMm: number; cyMm: number; sizeMm: number }[];
};

// Top-down vitrine glyph: a glass inset rect with a loose 45° glazing hatch,
// and — for a freestanding floor case — four square legs inset
// CASE_LEG_INSET_MM from the footprint edge. Insets/leg size default to the
// raw case constants; the screen passes its zoom-clamped values. The leg
// APPEARANCE threshold always uses the raw constants (matching FloorCaseMesh).
export function casePlanGlyph({
  widthMm,
  depthMm,
  includeLegs,
  wallInsetMm = CASE_WALL_THICKNESS_MM,
  legSizeMm = CASE_LEG_SIZE_MM
}: {
  widthMm: number;
  depthMm: number;
  includeLegs: boolean;
  wallInsetMm?: number;
  legSizeMm?: number;
}): CasePlanGlyph {
  const halfW = widthMm / 2;
  const halfD = depthMm / 2;
  const glassWidthMm = widthMm - wallInsetMm * 2;
  const glassDepthMm = depthMm - wallInsetMm * 2;

  let glass: CasePlanGlyph["glass"] = null;
  const hatch: CasePlanGlyph["hatch"] = [];
  if (glassWidthMm > 0 && glassDepthMm > 0) {
    const gx0 = -halfW + wallInsetMm;
    const gy0 = -halfD + wallInsetMm;
    const gx1 = gx0 + glassWidthMm;
    const gy1 = gy0 + glassDepthMm;
    glass = { x0Mm: gx0, y0Mm: gy0, x1Mm: gx1, y1Mm: gy1 };
    // Loose 45° glazing hatch: sparse strokes on the diagonal y = x + c
    // opposite the blocked-zone hatch, wide-spaced so it stays quiet at small
    // sizes. c indexes the diagonals, centered in range.
    const hatchSpacingMm = Math.max(Math.min(glassWidthMm, glassDepthMm) * 1.2, 300);
    const cMin = gy0 - gx1;
    const cMax = gy1 - gx0;
    const hatchCount = Math.floor((cMax - cMin) / hatchSpacingMm);
    const hatchStartC = cMin + (cMax - cMin - (hatchCount - 1) * hatchSpacingMm) / 2;
    for (let i = 0; i < hatchCount; i++) {
      const c = hatchStartC + i * hatchSpacingMm;
      const xa = Math.max(gx0, gy0 - c);
      const xb = Math.min(gx1, gy1 - c);
      if (xb <= xa) continue;
      hatch.push({ x1Mm: xa, y1Mm: xa + c, x2Mm: xb, y2Mm: xb + c });
    }
  }

  const legs: CasePlanGlyph["legs"] = [];
  // Below this footprint the two legs on an edge would collide (or straddle the
  // edge) — pin nothing; matches FloorCaseMesh's own clamp. Uses the RAW
  // constants, not the clamped legSize.
  if (
    includeLegs &&
    Math.min(widthMm, depthMm) >= 2 * (CASE_LEG_INSET_MM + CASE_LEG_SIZE_MM)
  ) {
    const legOffsetXMm = Math.max(halfW - CASE_LEG_INSET_MM, legSizeMm / 2);
    const legOffsetDMm = Math.max(halfD - CASE_LEG_INSET_MM, legSizeMm / 2);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1]
    ] as const) {
      legs.push({
        cxMm: sx * legOffsetXMm,
        cyMm: sy * legOffsetDMm,
        sizeMm: legSizeMm
      });
    }
  }

  return { glass, hatch, legs };
}

// ─── Wall-text plan glyph ──────────────────────────────────────────────────

export type WallTextPlanGlyph = {
  // A couple of short horizontal "text lines" (local-centered), the second
  // shortened at its right end — the plan echo of the elevation skeleton panel.
  lines: { x1Mm: number; x2Mm: number; yMm: number }[];
};

export function wallTextPlanGlyph({
  widthMm,
  depthMm
}: {
  widthMm: number;
  depthMm: number;
}): WallTextPlanGlyph {
  const halfW = widthMm / 2;
  const insetMm = Math.min(widthMm, depthMm) * 0.22;
  const insetWidthMm = Math.max(0, widthMm - insetMm * 2);
  const leftMm = -halfW + insetMm;
  const rightMm = halfW - insetMm;
  return {
    lines: [
      { x1Mm: leftMm, x2Mm: rightMm, yMm: -insetMm * 0.4 },
      { x1Mm: leftMm, x2Mm: rightMm - insetWidthMm * 0.35, yMm: insetMm * 0.4 }
    ]
  };
}
