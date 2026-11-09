// Floor-support construction — the single source of truth for the pedestal or
// plinth a floor-placed work STANDS ON, and the optional plexi bonnet over
// either. Pure, mm-space, no React/pixel/zoom knowledge, exactly like
// caseGlyphs.ts, shelfGlyphs.ts and monitorGlyphs.ts beside it: plan,
// elevation, the PDF and the 3D mesh all read the geometry here and then apply
// their own coordinate mapping, so the drawing, the print and the model cannot
// drift.
//
// A support is its OWN floor object (SupportFloorObject, schema v8 —
// floor-supports spec §2), modelled on the wall shelf rather than attached to
// one artwork. Which works stand on it is DERIVED from geometry at every read
// and never stored; placement/floorRiders.ts owns that entire relationship,
// and nothing here knows about riders.
//
// Coordinate conventions (the same two shelfGlyphs.ts uses):
// - Elevation glyphs are wall-local mm with y UP from the floor line — the
//   space the elevation scene itself is built in.
// - A support's plan footprint is just getFloorObjectPlanRect(support): it is
//   an ordinary floor object with its own centre, size and angle, so there is
//   deliberately no bespoke plan-rect helper here any more.
//
// CYCLE TRAP: this module is imported for its DEFAULTS by project.ts (which
// re-exports them beside the case, shelf and monitor defaults), so it may only
// import TYPES from ../project. A runtime import back into project.ts would
// close the cycle.

import { CASE_GLASS_THICKNESS_MM } from "./caseGlyphs";

// ─── Curatorial defaults ───────────────────────────────────────────────────
//
// First numbers a curator adjusts afterwards, in the same spirit as the
// display-case, shelf and monitor defaults: the point is that a support appears
// at a believable gallery size the moment it is created, not that these are the
// only legal values.

// Reveal around the work on a pedestal, per side. Smaller than this and the
// pedestal top reads as flush with the work at plan zoom — the pedestal stops
// looking like a pedestal.
export const PEDESTAL_MARGIN_MM = 100;
// The smallest standard gallery pedestal footprint. A tiny object still gets a
// pedestal you could actually build.
export const PEDESTAL_MIN_FOOTPRINT_MM = 300;
// Pedestal height is derived from the project's centerline datum so the work
// lands "near eye level" — the same datum the elevation centerline draws — and
// then clamped to what a pedestal can physically be.
export const PEDESTAL_MIN_HEIGHT_MM = 600;
export const PEDESTAL_MAX_HEIGHT_MM = 1400;
// Used when the caller has no centerline to measure from (a project whose
// default was never set). Mid-range, waist-to-chest.
export const PEDESTAL_FALLBACK_HEIGHT_MM = 1100;

// A plinth is the LOW WIDE member of the pair: a bigger reveal and a bigger
// minimum footprint are the whole distinction, so they are separate constants
// rather than a shared margin with a different height.
export const PLINTH_MARGIN_MM = 150;
export const PLINTH_DEFAULT_HEIGHT_MM = 150;
export const PLINTH_MIN_FOOTPRINT_MM = 600;

// Bonnet (plexi vitrine cover) geometry. Its footprint IS the support's
// (USER DECISION 2026-09-17) — a bonnet is the support's own lid, not a second
// box to size — so only its height and the air inside it are parameters here.
//
// Derived (unlocked) bonnet height = the tallest rider's height + this. Enough
// headroom to read as a cover rather than a lid resting on the work.
export const BONNET_HEADROOM_MM = 75;
// Floor for a LOCKED bonnet height. Below this it is a glass sliver, not a
// cover, and the number is almost certainly a typo.
export const BONNET_MIN_HEIGHT_MM = 150;
// Air between a rider's footprint and the glass, per side, on top of the glass
// thickness itself. Reuses CASE_GLASS_THICKNESS_MM so the app has ONE glass
// language: a bonnet and a vitrine lid are the same material.
export const BONNET_CLEARANCE_MM = 25;

// Per-side inset from the support's edge to the largest rider footprint a
// bonnet can cover: the glass wall plus its clearance.
export function bonnetInsetMm(): number {
  return CASE_GLASS_THICKNESS_MM + BONNET_CLEARANCE_MM;
}

// ─── Elevation glyph ───────────────────────────────────────────────────────

export type SupportElevationGlyph = {
  // The block itself, standing on the floor line. Wall-local mm, y UP from the
  // floor, so `bottomYMm` is always 0 and `topYMm` is the support's top face —
  // the height a rider's baseHeightMm matches.
  block: { xMinMm: number; xMaxMm: number; bottomYMm: number; topYMm: number };
  // The plexi bonnet rising FROM the top face, at the support's own span
  // (bonnet footprint = support footprint). Null when there is no bonnet.
  //
  // A bonnet may be SHORTER than the work standing under it (a locked height
  // the curator under-typed): the consumer draws the work in full straight
  // through it rather than clipping, because that collision is the thing worth
  // seeing.
  bonnet: { xMinMm: number; xMaxMm: number; bottomYMm: number; topYMm: number } | null;
  // Floor to the top of whatever rises off the support — the block alone, or
  // the bonnet over it. What an elevation ghost spans and a dimension line
  // measures against.
  totalHeightMm: number;
};

// The front projection of a support: a block, and the glass over it. The
// along-wall span is the CALLER's (buildElevationScene projects the rotated
// footprint onto the wall), because a rotated pedestal is wider in elevation
// than its own width; this module only ever draws what it is handed.
export function supportElevationGlyph({
  xMinMm,
  xMaxMm,
  heightMm,
  bonnetHeightMm
}: {
  xMinMm: number;
  xMaxMm: number;
  heightMm: number;
  bonnetHeightMm?: number;
}): SupportElevationGlyph {
  return {
    block: { xMinMm, xMaxMm, bottomYMm: 0, topYMm: heightMm },
    bonnet:
      bonnetHeightMm !== undefined
        ? {
            xMinMm,
            xMaxMm,
            bottomYMm: heightMm,
            topYMm: heightMm + bonnetHeightMm
          }
        : null,
    totalHeightMm: heightMm + (bonnetHeightMm ?? 0)
  };
}
