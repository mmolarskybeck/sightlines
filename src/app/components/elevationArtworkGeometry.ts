// Wall-local coordinates are y-up from the floor (docs/plan.md §2); SVG is
// y-down from the top. Every elevation drawing goes through this one flip —
// defined here (rather than in ElevationView.tsx, which imports it back)
// so this module and ElevationView.tsx don't import each other.
export function wallLocalYToSvgY(wallHeightMm: number, yMm: number): number {
  return wallHeightMm - yMm;
}

export type ArtworkCenterMm = {
  xMm: number;
  yMm: number;
};

export type ArtworkSizeMm = {
  widthMm: number;
  heightMm: number;
};

export type SvgRectMm = {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

// Center-anchored wall-local coordinates (docs/plan.md §2) to a top-left SVG
// rect: x is a plain offset since SVG x and wall-local x both run left-to-
// right from the wall start, but y needs the one shared flip
// (wallLocalYToSvgY) since SVG is y-down and wall-local is y-up from the
// floor — the rect's *top* edge (higher wall-local y) is what becomes the
// smaller SVG y.
export function getArtworkRectSvg(
  wallHeightMm: number,
  center: ArtworkCenterMm,
  size: ArtworkSizeMm
): SvgRectMm {
  return {
    xMm: center.xMm - size.widthMm / 2,
    yMm: wallLocalYToSvgY(wallHeightMm, center.yMm + size.heightMm / 2),
    widthMm: size.widthMm,
    heightMm: size.heightMm
  };
}

export type SelectedElevationRect = {
  center: ArtworkCenterMm;
  size: ArtworkSizeMm;
};

// Union of every selected object's SVG rect (via getArtworkRectSvg above),
// padded by 20% of the larger union dimension with a 150mm floor — so a
// single small work still frames with a generous, readable margin rather
// than hugging its own edges. Returns null for an empty selection so the
// caller (ElevationView's "Fit selected") can no-op / disable its button.
// Callers pass wall-local centers exactly as stored (openings included —
// getArtworkRectSvg's math is generic over any center+size pair, not
// artwork-specific despite the name).
export function getFitSelectionBoundsSvg(
  wallHeightMm: number,
  selected: SelectedElevationRect[]
): SvgRectMm | null {
  if (selected.length === 0) return null;

  const rects = selected.map((item) => getArtworkRectSvg(wallHeightMm, item.center, item.size));
  const minXMm = Math.min(...rects.map((rect) => rect.xMm));
  const minYMm = Math.min(...rects.map((rect) => rect.yMm));
  const maxXMm = Math.max(...rects.map((rect) => rect.xMm + rect.widthMm));
  const maxYMm = Math.max(...rects.map((rect) => rect.yMm + rect.heightMm));

  const unionWidthMm = maxXMm - minXMm;
  const unionHeightMm = maxYMm - minYMm;
  const padMm = Math.max(Math.max(unionWidthMm, unionHeightMm) * 0.2, 150);

  return {
    xMm: minXMm - padMm,
    yMm: minYMm - padMm,
    widthMm: unionWidthMm + padMm * 2,
    heightMm: unionHeightMm + padMm * 2
  };
}

// A local visibility flag only — "make constraints visible" (docs/plan.md
// §1.5), not a constraint enforced here. The store's own validator remains
// the authoritative source of placement warnings; this just lets the
// renderer highlight a placement that visibly extends past the wall's own
// bounds without importing that validator into a view component.
export function isArtworkOutOfWallBounds(
  wallLengthMm: number,
  wallHeightMm: number,
  center: ArtworkCenterMm,
  size: ArtworkSizeMm
): boolean {
  const leftMm = center.xMm - size.widthMm / 2;
  const rightMm = center.xMm + size.widthMm / 2;
  const bottomMm = center.yMm - size.heightMm / 2;
  const topMm = center.yMm + size.heightMm / 2;

  return leftMm < 0 || rightMm > wallLengthMm || bottomMm < 0 || topMm > wallHeightMm;
}
