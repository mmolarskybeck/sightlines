import type { Dimensions } from "../../../domain/project";

export type SizeMm = { widthMm: number; heightMm: number };

// The size to render a wall artwork's image plane at, given its authored
// placement rect and — when known — the texture's native aspect ratio.
//
// A "known" or "approximate" placement keeps its authored rect: the rect
// already carries the work's true proportions, so stretching the texture to
// fill it is correct (and matches the prior behaviour exactly).
//
// An "unknown"-dimension placement has a placeholder rect whose aspect is
// arbitrary, so stretching the texture to fill it squishes the image. Instead
// we mirror the elevation view (ElevationArtwork's `preserveAspectRatio=
// "xMidYMid meet"`): the native image is *contained* (letterboxed) inside the
// placement rect and centered, so it never distorts. The placement rect itself
// (and the uncertainty/selection outline drawn on it) is unchanged — only the
// image plane shrinks to the contained size.
//
// Falls back to the rect unchanged whenever the native aspect isn't usable yet
// (texture still loading, degenerate size), so an unknown-dimension work first
// paints at rect size and snaps to its contained size once the texture reports
// its dimensions.
export function fitArtworkImageSizeMm(
  rect: SizeMm,
  status: Dimensions["status"] | undefined,
  textureNativeAspect: number | undefined
): SizeMm {
  if (status !== "unknown") return rect;
  if (
    textureNativeAspect === undefined ||
    !Number.isFinite(textureNativeAspect) ||
    textureNativeAspect <= 0 ||
    rect.widthMm <= 0 ||
    rect.heightMm <= 0
  ) {
    return rect;
  }

  const rectAspect = rect.widthMm / rect.heightMm;
  if (textureNativeAspect > rectAspect) {
    // Image is wider than the rect → width-bound; letterbox top and bottom.
    return { widthMm: rect.widthMm, heightMm: rect.widthMm / textureNativeAspect };
  }
  // Image is taller/narrower than the rect → height-bound; pillarbox sides.
  return { widthMm: rect.heightMm * textureNativeAspect, heightMm: rect.heightMm };
}

// Native aspect (width / height) of a loaded texture's image, or undefined when
// the texture hasn't reported a usable size yet. THREE loads wall textures from
// an HTMLImageElement, whose width/height are the natural pixel dimensions.
export function textureNativeAspect(
  image: { width?: number; height?: number } | undefined | null
): number | undefined {
  if (!image || !image.width || !image.height) return undefined;
  return image.width / image.height;
}
