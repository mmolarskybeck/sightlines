import {
  getArtworkRectSvg,
  type ArtworkCenterMm,
  type ArtworkSizeMm,
  type SvgRectMm
} from "../../domain/scene2d/elevationScene";
import {
  getArtworkOuterDimensionsMm,
  withArtworkFootprint
} from "../../domain/framing";
import { getEffectivePlacementSizeMm } from "../../domain/placement/placeArtwork";
import type { Artwork, WallObject } from "../../domain/project";
import type { PixelAspect } from "../../domain/units/aspectFill";

// The pure center/size→SVG-rect math (and the shared y-flip) moved to
// src/domain/scene2d/elevationScene.ts so the elevation scene builder and the
// upcoming PNG/PDF exports can use it without importing app code. Re-exported
// here so existing imports (ElevationArtwork, ElevationOpening,
// GroupDimensionLines, tests) keep working unchanged. What REMAINS defined in
// this module is interactive-only viewport math — "Fit selected" is a camera
// gesture, not part of the drawing, so it stays out of the domain scene.
export {
  getArtworkRectSvg,
  isArtworkOutOfWallBounds,
  wallLocalYToSvgY,
  type ArtworkCenterMm,
  type ArtworkSizeMm,
  type SvgRectMm
} from "../../domain/scene2d/elevationScene";

export type SelectedElevationRect = {
  center: ArtworkCenterMm;
  size: ArtworkSizeMm;
};

// Selection/annotation geometry uses the same framed outer footprint as the
// painted artwork. Openings and unresolved artwork records pass through.
export function getElevationFootprintObjects<T extends WallObject>(
  objects: T[],
  artworksById?: ReadonlyMap<string, Artwork>
): T[] {
  return objects.map((object) =>
    withArtworkFootprint(
      object,
      object.kind === "artwork" ? artworksById?.get(object.artworkId) : undefined
    )
  );
}

// A checklist drop has no placement record yet. Resolve the image size exactly
// as placement creation does, then widen it for the elevation ghost so its
// edges match the framed work that appears after drop.
export function getElevationDropGhostSizeMm(
  artwork: Pick<Artwork, "dimensions" | "matWidthMm" | "frame">,
  aspect?: PixelAspect
): ArtworkSizeMm {
  const imageSize = getEffectivePlacementSizeMm(artwork.dimensions, aspect);
  return getArtworkOuterDimensionsMm(
    imageSize.widthMm,
    imageSize.heightMm,
    artwork.matWidthMm,
    artwork.frame
  );
}

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
