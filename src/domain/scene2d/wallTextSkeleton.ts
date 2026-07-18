// The shared skeleton-bar layout for a wall text panel. One derivation feeds
// the elevation SVG, the 3D panel, and the PDF/2D exports, so a wall text can
// never look different between the canvas and a page. Coordinates are
// NORMALIZED to the panel's own box: x/y are fractions in [0, 1] measured from
// the TOP-LEFT (y-down, the SVG/export convention); the 3D layer flips y.
//
// All wall texts render the same skeleton (no real text) — only the panel's
// width/height change the bar count and lengths.

export type WallTextSkeletonBar = {
  // Fractions of the panel box, top-left origin, y-down.
  xFrac: number;
  yFrac: number;
  widthFrac: number;
  heightFrac: number;
};

export type WallTextSkeleton = {
  // The padded content box the bars are clipped to (also handy as a subtle
  // inner guide), same normalized frame as the bars.
  padXFrac: number;
  padYFrac: number;
  bars: WallTextSkeletonBar[];
};

// Bar thickness as a fraction of panel height, clamped so bars never get
// hairline-thin on a tall panel or chunky on a short one.
const BAR_HEIGHT_FRAC = 0.07;
const MIN_BAR_HEIGHT_FRAC = 0.04;
const MAX_BAR_HEIGHT_FRAC = 0.11;
// Gap between bars, as a multiple of bar height.
const BAR_GAP_RATIO = 0.9;
// Generous inner margin: a fraction of the SMALLER side so a wide, short panel
// still keeps breathing room top and bottom.
const PADDING_FRAC_OF_MIN_SIDE = 0.14;
const MIN_BARS = 2;
const MAX_BARS = 7;
// The last line reads as an unfinished paragraph — shorter than the rest.
const LAST_BAR_WIDTH_RATIO = 0.6;

export function computeWallTextSkeleton(widthMm: number, heightMm: number): WallTextSkeleton {
  const safeWidthMm = Math.max(widthMm, 1);
  const safeHeightMm = Math.max(heightMm, 1);
  // The same real inset on every side, derived from the smaller side, then
  // expressed as each axis's own fraction (a larger axis gets a smaller
  // fraction). This keeps the margin visually even on non-square panels.
  const insetMm = PADDING_FRAC_OF_MIN_SIDE * Math.min(safeWidthMm, safeHeightMm);
  const insetFracOfWidth = insetMm / safeWidthMm;
  const insetFracOfHeight = insetMm / safeHeightMm;

  const contentTop = insetFracOfHeight;
  const contentHeight = Math.max(0, 1 - insetFracOfHeight * 2);
  const contentLeft = insetFracOfWidth;
  const contentWidth = Math.max(0, 1 - insetFracOfWidth * 2);

  const barHeightFrac = Math.min(
    MAX_BAR_HEIGHT_FRAC,
    Math.max(MIN_BAR_HEIGHT_FRAC, BAR_HEIGHT_FRAC)
  );
  const gapFrac = barHeightFrac * BAR_GAP_RATIO;

  // How many bar+gap rows fit in the content height (a trailing bar needs no
  // trailing gap, hence the + gap in both numerator and denominator).
  const rawCount = Math.floor((contentHeight + gapFrac) / (barHeightFrac + gapFrac));
  const count = Math.max(MIN_BARS, Math.min(MAX_BARS, rawCount));

  const bars: WallTextSkeletonBar[] = [];
  for (let index = 0; index < count; index += 1) {
    const isLast = index === count - 1;
    bars.push({
      xFrac: contentLeft,
      yFrac: contentTop + index * (barHeightFrac + gapFrac),
      widthFrac: contentWidth * (isLast ? LAST_BAR_WIDTH_RATIO : 1),
      heightFrac: barHeightFrac
    });
  }

  return { padXFrac: insetFracOfWidth, padYFrac: insetFracOfHeight, bars };
}
