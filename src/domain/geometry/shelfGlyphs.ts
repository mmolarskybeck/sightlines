// Shelf glyph construction — the single source of truth for how a wall
// shelf's real 3D geometry (a slab cantilevered off the wall face) is echoed
// as 2D marks in plan and elevation, plus the height arithmetic every surface
// needs to talk about a shelf's TOP rather than its stored centre. Pure,
// mm-space, no React/pixel/zoom knowledge, exactly like caseGlyphs.ts beside
// it: callers (screen SVG, PDF export) apply their own coordinate mapping.
//
// Coordinate conventions (the same two caseGlyphs.ts uses):
// - Elevation glyphs are wall-local mm with y UP from the floor line — the
//   space the elevation scene itself is built in. A shelf has no inner marks
//   to place in a top-left local frame, so the work this glyph does is the
//   centre→edges arithmetic, and returning it in wall-local space is what
//   makes it directly usable by the scene builder.
// - Plan glyphs are returned in a LOCAL-CENTERED frame (origin at the
//   footprint centre), x rightward, y downward — the frame both the screen
//   <g transform="rotate(...)"> and the PDF planRectWorldPoint expect.
//
// CYCLE TRAP: this module is imported for its DEFAULTS by project.ts (which
// re-exports them beside the case defaults), so it may only import TYPES from
// ../project. A runtime import back into project.ts would close the cycle.
import type { ShelfWallObject } from "../project";

// Shelf defaults (curatorial, not code minimums — a first placement a curator
// immediately adjusts numerically, same spirit as the opening and display-case
// defaults). A picture-ledge-ish slab: shoulder-width, thin, shallow, with its
// TOP at a height a work can stand on and still read against hung work.
export const DEFAULT_SHELF_WIDTH_MM = 1200;
export const DEFAULT_SHELF_THICKNESS_MM = 40; // the slab's vertical thickness
export const DEFAULT_SHELF_DEPTH_MM = 300; // protrusion from the wall face
export const DEFAULT_SHELF_TOP_MM = 1200; // height of the slab's TOP face

// How far past a work's own width a one-click "Add shelf under this work"
// slab reaches on EACH side, so the shelf reads as supporting the work rather
// than being hidden behind it.
export const SHELF_END_MARGIN_MM = 100;

// How close a work's bottom edge must sit to a shelf's top face to count as
// STANDING ON it — both the snap target's meaning and, afterwards, the rider
// test that decides what a shelf carries when it moves (shelfRiders.ts).
//
// Deliberately tiny: riders are derived from geometry on every move path and
// never stored, so this number is the entire definition of the relationship.
// Widening it would silently pick up works merely hanging near a shelf.
export const SHELF_TOP_SNAP_TOLERANCE_MM = 2;

// The slab fields the height helpers read. Structural rather than
// `Pick<ShelfWallObject, ...>` alone so a caller holding a scene entry or a
// test literal can ask the question without inventing an id and a wallId.
export type ShelfSlab = Pick<ShelfWallObject, "yMm" | "heightMm">;

// The height of a shelf's TOP face. `yMm` is the slab's CENTRE (the
// WallObjectBase convention every wall object follows), so every surface that
// talks about "the shelf" — the inspector's Top height field, the snap target,
// the rider test — has to add half the thickness, and they all do it here so
// they cannot drift by a rounding.
export function shelfTopYMm(shelf: ShelfSlab): number {
  return shelf.yMm + shelf.heightMm / 2;
}

export function shelfBottomYMm(shelf: ShelfSlab): number {
  return shelf.yMm - shelf.heightMm / 2;
}

// The stored centre `yMm` for a shelf whose TOP should sit at `topMm`. The
// inverse of shelfTopYMm, and the one place a top-anchored edit turns back
// into the stored centre — a width/depth/thickness edit keeps the TOP fixed,
// which means recomputing yMm rather than leaving it alone.
export function shelfCenterYMmForTop(topMm: number, thicknessMm: number): number {
  return topMm - thicknessMm / 2;
}

export type ShelfElevationGlyph = {
  // Wall-local x of the slab's two ends.
  xMinMm: number;
  xMaxMm: number;
  // Wall-local y (UP from the floor line) of the slab's two faces.
  bottomYMm: number;
  topYMm: number;
};

// The front face of a shelf in elevation: a solid band, with no inner marks at
// all — a shelf is one slab, unlike the case's tray/glass/legs. Takes the
// stored centre-anchored fields and returns the four edges.
export function shelfElevationGlyph(
  shelf: ShelfSlab & Pick<ShelfWallObject, "xMm" | "widthMm">
): ShelfElevationGlyph {
  return {
    xMinMm: shelf.xMm - shelf.widthMm / 2,
    xMaxMm: shelf.xMm + shelf.widthMm / 2,
    bottomYMm: shelfBottomYMm(shelf),
    topYMm: shelfTopYMm(shelf)
  };
}

export type ShelfPlanGlyph = {
  // The footprint outline in the local-centered frame. A wall case's plan
  // glyph inset a glass rect and hatched it; a shelf is opaque timber seen
  // from above, so the outline IS the glyph — there is deliberately nothing
  // else here rather than an invented mark.
  outline: { x0Mm: number; y0Mm: number; x1Mm: number; y1Mm: number };
};

// Top-down shelf glyph: the protruding rect, local-centered. The caller places
// and rotates it (getWallObjectPlanRect gives the world centre/angle) and
// shifts it to the viewer's side of the wall line, exactly as it does for a
// wall case — see getRenderedWallObjectPlanRect.
export function shelfPlanGlyph({
  widthMm,
  depthMm
}: {
  widthMm: number;
  depthMm: number;
}): ShelfPlanGlyph {
  const halfW = widthMm / 2;
  const halfD = depthMm / 2;
  return {
    outline: { x0Mm: -halfW, y0Mm: -halfD, x1Mm: halfW, y1Mm: halfD }
  };
}
