import type {
  Artwork,
  ArtworkWallObject,
  OpeningWallObject,
  WallObject
} from "../project";

// Pure derivation: one wall's object inventory -> the static elevation
// drawing, as plain-data primitives (planScene.ts's twin). ElevationView maps
// these to SVG elements, and the upcoming PNG/PDF exports will draw the SAME
// scene. Static-only, same rule as the plan scene: move drags, ghosts, snap
// guides, marquee, group outlines and dimension lines stay in the view.
//
// The input is the wall-object array rather than a whole Project because the
// interactive view layers live arrange-session previews over the committed
// objects BEFORE any derivation runs — exports simply pass
// project.wallObjects and get the committed state.

// Wall-local coordinates are y-up from the floor (docs/plan.md §2); SVG is
// y-down from the top. Every elevation drawing goes through this one flip.
// (Moved here from app/components/elevationArtworkGeometry.ts so the export
// builders can share it without importing app code; that module re-exports
// it for the existing component imports.)
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

// A local visibility flag only — "make constraints visible" (docs/plan.md
// §1.5), not a constraint enforced here. The store's own validator remains
// the authoritative source of placement warnings; this just lets a renderer
// highlight a placement that visibly extends past the wall's own bounds
// without importing that validator.
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

export type ElevationSceneArtwork = {
  object: ArtworkWallObject;
  // The joined artwork record (undefined for a dangling artworkId) —
  // frame/mat/status/assetId all read from here, matching the neutral
  // fallback the view uses when the record is missing.
  artwork?: Artwork;
  centerMm: ArtworkCenterMm;
  sizeMm: ArtworkSizeMm;
  outOfBounds: boolean;
};

export type ElevationSceneOpening = {
  object: OpeningWallObject;
  centerMm: ArtworkCenterMm;
  sizeMm: ArtworkSizeMm;
  outOfBounds: boolean;
};

export type ElevationScene = {
  wallLengthMm: number;
  wallHeightMm: number;
  // The floor line sits at the bottom wall edge; the centerline (curator
  // eyeline) is the stored wall-local height flipped into SVG space. Both are
  // horizontal rules spanning 0..wallLengthMm. Whether the centerline is
  // VISIBLE is the caller's toggle, not scene data — the position is the
  // derivation.
  floorLineSvgY: number;
  centerlineSvgY: number;
  artworks: ElevationSceneArtwork[];
  openings: ElevationSceneOpening[];
};

export type ElevationSceneOptions = {
  // undefined matches nothing (an unwired view renders a bare wall) — same
  // as the view's own filter semantics.
  wallId: string | undefined;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  artworksById?: ReadonlyMap<string, Artwork>;
};

export function buildElevationScene(
  wallObjects: WallObject[],
  options: ElevationSceneOptions
): ElevationScene {
  const { wallId, wallLengthMm, wallHeightMm, centerlineMm, artworksById } = options;

  const artworks: ElevationSceneArtwork[] = [];
  const openings: ElevationSceneOpening[] = [];

  // One pass, split by kind — preserving each kind's stored order (the view
  // paints artworks then openings, so relative paint order within a kind is
  // exactly the array order).
  for (const object of wallObjects) {
    if (object.wallId !== wallId) continue;
    const centerMm = { xMm: object.xMm, yMm: object.yMm };
    const sizeMm = { widthMm: object.widthMm, heightMm: object.heightMm };
    const outOfBounds = isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, centerMm, sizeMm);

    if (object.kind === "artwork") {
      const artwork = artworksById?.get(object.artworkId);
      artworks.push({
        object,
        ...(artwork ? { artwork } : {}),
        centerMm,
        sizeMm,
        outOfBounds
      });
    } else {
      openings.push({ object, centerMm, sizeMm, outOfBounds });
    }
  }

  return {
    wallLengthMm,
    wallHeightMm,
    floorLineSvgY: wallHeightMm,
    centerlineSvgY: wallLocalYToSvgY(wallHeightMm, centerlineMm),
    artworks,
    openings
  };
}
