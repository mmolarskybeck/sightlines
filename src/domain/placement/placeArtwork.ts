import type { Artwork, ArtworkWallObject, Dimensions } from "../project";
import { imageAspectRatio, type PixelAspect } from "../units/aspectFill";
import { newId } from "../id";

// A plausible mid-size framed work (24in x 30in) — used whenever an axis is
// missing at placement time (docs/plan.md §1.5 point 4: place before real
// dimensions are known, with a clear uncertainty indicator elsewhere).
export const PLACEHOLDER_ARTWORK_WIDTH_MM = 610;
export const PLACEHOLDER_ARTWORK_HEIGHT_MM = 760;

export type EffectivePlacementSize = {
  widthMm: number;
  heightMm: number;
  usedPlaceholder: boolean;
};

// Match applyAspectFill's rounding: 0.01 mm is well below any unit's display
// precision, so a derived axis stays tidy without visible drift.
function roundMm(valueMm: number): number {
  return Math.round(valueMm * 100) / 100;
}

// The size a placement should bake for an artwork whose dimensions may be
// partial or unknown. When an axis is missing, the linked image's aspect ratio
// (widthPx/heightPx, passed as `aspect`) keeps the work at its true proportions
// instead of a placeholder guess — the core "judge how it'll actually look"
// promise still holds before a curator has typed real numbers.
//
// usedPlaceholder stays true whenever any axis was missing from `dimensions`:
// a size derived from the image is still not a real measurement, so the
// uncertainty outline must still show.
export function getEffectivePlacementSizeMm(
  dimensions: Dimensions,
  aspect?: PixelAspect
): EffectivePlacementSize {
  const { widthMm, heightMm } = dimensions;

  // A curator's real numbers always win — even an off-ratio pair, since mats
  // and frames legitimately break the image ratio.
  if (widthMm !== undefined && heightMm !== undefined) {
    return { widthMm, heightMm, usedPlaceholder: false };
  }

  const ratio = aspect ? imageAspectRatio(aspect) : undefined;

  // No usable ratio: each missing axis borrows its placeholder (the original
  // per-axis fallback, unchanged).
  if (ratio === undefined) {
    return {
      widthMm: widthMm ?? PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: heightMm ?? PLACEHOLDER_ARTWORK_HEIGHT_MM,
      usedPlaceholder: true
    };
  }

  // Exactly one axis known: derive the other from the known one (ratio = w/h).
  if (widthMm !== undefined) {
    return { widthMm, heightMm: roundMm(widthMm / ratio), usedPlaceholder: true };
  }
  if (heightMm !== undefined) {
    return { widthMm: roundMm(heightMm * ratio), heightMm, usedPlaceholder: true };
  }

  // Both missing: fit the image ratio INSIDE the placeholder box (contain), so
  // an unknown work lands at a plausible size and a panorama can't blow out the
  // room.
  if (ratio > PLACEHOLDER_ARTWORK_WIDTH_MM / PLACEHOLDER_ARTWORK_HEIGHT_MM) {
    return {
      widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: roundMm(PLACEHOLDER_ARTWORK_WIDTH_MM / ratio),
      usedPlaceholder: true
    };
  }
  return {
    widthMm: roundMm(PLACEHOLDER_ARTWORK_HEIGHT_MM * ratio),
    heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
    usedPlaceholder: true
  };
}

// Center-anchored, per docs/plan.md §2 — no clamping to wall bounds here.
// Out-of-bounds placement is a state to flag (validatePlacement), never to
// silently fix.
export function createArtworkPlacement(
  artwork: Artwork,
  wallId: string,
  xMm: number,
  yMm: number,
  aspect?: PixelAspect
): ArtworkWallObject {
  const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions, aspect);

  return {
    id: newId(),
    kind: "artwork",
    artworkId: artwork.id,
    wallId,
    xMm,
    yMm,
    widthMm,
    heightMm
  };
}
