// ── Stroke widths / colors (SVG user units == points, matching the PDF) ──────
// Colors are CSS custom properties so the card stays theme-aware; geometry and
// stroke weights echo the PDF writer's so the look-ahead reads like the export.
export const INK = "var(--ink)";
export const MUTED = "var(--muted)";
export const SUBTLE = "var(--subtle)";
export const GRID = "var(--line)";
export const FILL_WEAK = "var(--surface-strong)";

// Ghost vocabulary (floor-case, suspended-artwork, non-abutting partition):
// hardcoded here rather than reused from CSS classes because these marks are
// plain SVG attributes, not classed elements — this card intentionally
// avoids className-based styling so it never silently drifts from what's
// literally drawn. Mirrors the PDF writer's boldened GHOST_BORDER_WIDTH_PT /
// dash / wire constants (elevationPage.ts) so the preview never disagrees
// with the artifact it previews. Opacity nudged up alongside the width bump,
// same reasoning as the CSS pass (global.css .elevation-*-ghost).
export const GHOST_STROKE_WIDTH = 0.6;
export const GHOST_DASH = "3 2";
export const GHOST_OPACITY = 0.82;
export const GHOST_WIRE_WIDTH = 0.45;
export const GHOST_WIRE_DASH = "2 2";
export const GHOST_WIRE_OPACITY = 0.9;

export type XY = { x: number; y: number };
export type Transform = {
  scalePtPerMm: number;
  point: (p: { xMm: number; yMm: number }) => XY;
};

// A small inset inside the page's drawing rect, so content doesn't butt the
// header/footer/margin bands — the analog of the PDF writer's DRAWING_INSET_PT.
export const DRAWING_INSET_PT = 14;
