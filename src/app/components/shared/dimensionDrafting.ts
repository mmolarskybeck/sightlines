// Shared drafting vocabulary for the app's dimension-line renderers: plan's
// PartitionDimensionLines / PlanGapDimensionLines and elevation's
// GroupDimensionLines / VerticalGapDimensionLines. Each renderer places lines,
// ticks, and labels in its own coordinate space (plan mm scaled off
// handleSizeMm, elevation mm scaled off pixelsPerMm) and keeps its own layout —
// this module only lifts the numbers and tiny pure predicates that are
// IDENTICAL across renderers, so a drafting-convention change (glyph width
// estimate, minimum-segment cutoff, label halo weight) is made once. It does
// not own layout, offsets, or stagger rows — those stay in each renderer
// because their sizing bases and drafting conventions genuinely differ.

// Estimated on-screen glyph width as a fraction of font size — used everywhere
// a renderer must guess whether a label's rendered text fits a given span
// before committing to centering it there vs. staggering/leadering it out.
export const LABEL_GLYPH_WIDTH_RATIO = 0.62;

// SVG halo weight behind label text, as a fraction of font size — every
// renderer's .dimension-label style uses fontSize * this ratio for strokeWidth
// so the halo scales with the constant-on-screen text size trick.
export const LABEL_STROKE_WIDTH_RATIO = 0.3;

// Base label font size (screen px) shared by the elevation-canvas renderers
// (GroupDimensionLines, VerticalGapDimensionLines), which divide by
// pixelsPerMm to hold this constant on screen at any zoom. The plan renderers
// scale off handleSizeMm instead — a different sizing basis, so they keep
// their own font ratio rather than reusing this constant.
export const ELEVATION_LABEL_FONT_PX = 10;

// Gap segments below this (mm) are a hairline: no connecting line is drawn,
// but ticks and the "0" label still print — touching objects/works are real
// information, not noise to hide.
export const MIN_DIMENSION_SEGMENT_MM = 0.5;

// Estimated on-screen width of a formatted label at a given font size, in
// whatever unit `fontSize` is expressed in (mm or px — callers stay consistent
// within their own coordinate space).
export function estimateLabelWidth(label: string, fontSize: number): number {
  return label.length * fontSize * LABEL_GLYPH_WIDTH_RATIO;
}

// Whether a label of the given estimated width fits centered within a span of
// `spanSize`, keeping `slack` of breathing room on top of the raw width.
export function labelFitsInSpan(spanSize: number, labelWidth: number, slack: number): boolean {
  return spanSize >= labelWidth + slack;
}

// The shared inline style for a .dimension-label <text> element: constant
// on-screen size at any zoom (font-size is already scaled by the caller off
// handleSizeMm or pixelsPerMm) plus the matching halo weight.
export function labelTextStyle(fontSize: number): { fontSize: number; strokeWidth: number } {
  return { fontSize, strokeWidth: fontSize * LABEL_STROKE_WIDTH_RATIO };
}
