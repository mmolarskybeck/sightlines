import type { Artwork, ArtworkWallObject, Dimensions } from "../project";

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

// Per-axis fallback: an artwork with a known width but unknown height still
// uses its real width, only the missing axis borrows the placeholder.
export function getEffectivePlacementSizeMm(dimensions: Dimensions): EffectivePlacementSize {
  const widthMm = dimensions.widthMm ?? PLACEHOLDER_ARTWORK_WIDTH_MM;
  const heightMm = dimensions.heightMm ?? PLACEHOLDER_ARTWORK_HEIGHT_MM;

  return {
    widthMm,
    heightMm,
    usedPlaceholder: dimensions.widthMm === undefined || dimensions.heightMm === undefined
  };
}

// Center-anchored, per docs/plan.md §2 — no clamping to wall bounds here.
// Out-of-bounds placement is a state to flag (validatePlacement), never to
// silently fix.
export function createArtworkPlacement(
  artwork: Artwork,
  wallId: string,
  xMm: number,
  yMm: number
): ArtworkWallObject {
  const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions);

  return {
    id: crypto.randomUUID(),
    kind: "artwork",
    artworkId: artwork.id,
    wallId,
    xMm,
    yMm,
    widthMm,
    heightMm
  };
}
