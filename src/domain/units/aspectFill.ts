import type { Dimensions } from "../project";

// The two 2D "face" axes an image aspect ratio can constrain. Depth (z) is
// never derived from an image — a photograph carries no depth information —
// so aspect fill only ever touches this pair.
export type FaceAxis = "widthMm" | "heightMm";

// Pixel dimensions captured at image intake (Asset.widthPx / heightPx). Either
// may be missing for legacy or non-raster assets, in which case there is no
// usable ratio and no auto-fill happens.
export type PixelAspect = { widthPx?: number; heightPx?: number };

// Relative slack when deciding whether the existing width/height pair already
// "matches" the image ratio. Generous enough to absorb display rounding — a
// curator who typed dims to the nearest 1/16" or 0.1 cm still reads as matching
// — but tight enough that a deliberately off-ratio pair (e.g. a matted work
// wider than its image) is left alone.
const RATIO_MATCH_TOLERANCE = 0.02;

// The image's width ÷ height, or undefined when either pixel dimension is
// missing or non-positive (nothing to derive from).
export function imageAspectRatio(aspect: PixelAspect): number | undefined {
  const { widthPx, heightPx } = aspect;
  if (widthPx === undefined || heightPx === undefined) return undefined;
  if (widthPx <= 0 || heightPx <= 0) return undefined;
  return widthPx / heightPx;
}

// Whether a width/height pair sits within tolerance of the given ratio. Both
// must be present and positive; a pair with a missing axis can't "match" (it's
// handled by the empty-other-axis branch in applyAspectFill instead).
function pairMatchesRatio(
  widthMm: number | undefined,
  heightMm: number | undefined,
  ratio: number
): boolean {
  if (widthMm === undefined || heightMm === undefined) return false;
  if (widthMm <= 0 || heightMm <= 0) return false;
  return Math.abs(widthMm / heightMm - ratio) <= ratio * RATIO_MATCH_TOLERANCE;
}

// Whether committing width/height should currently scale its counterpart to
// track the image. Honors an explicit curator choice (Dimensions.aspectLocked)
// first; legacy records that predate the field fall back to the old
// tolerance-match heuristic so existing data doesn't change behavior until the
// curator actually touches the lock toggle.
export function isAspectLocked(dimensions: Dimensions, aspect: PixelAspect): boolean {
  if (dimensions.aspectLocked !== undefined) return dimensions.aspectLocked;

  const ratio = imageAspectRatio(aspect);
  if (ratio === undefined) return false;
  return pairMatchesRatio(dimensions.widthMm, dimensions.heightMm, ratio);
}

// Returns the next Dimensions after committing `axis` to `valueMm`, auto-
// filling the OTHER face axis from the image's pixel aspect ratio when it
// makes sense to. Never touches depth or status.
//
// The rule: when the other axis is currently empty, derive it and mark the
// pair as locked (a freshly-derived pair naturally tracks the image until the
// curator says otherwise). When the other axis already has a value, only
// re-derive it while the pair is locked (see isAspectLocked) — once
// unlocked, each axis commits independently, so a curator correcting one
// dimension to a real, mismatched value (a mat, a frame, a cropped photo)
// never has it silently overwritten. With no usable ratio, only the
// committed axis changes.
export function applyAspectFill(
  dimensions: Dimensions,
  axis: FaceAxis,
  valueMm: number,
  aspect: PixelAspect
): Dimensions {
  const next: Dimensions = { ...dimensions, [axis]: valueMm };

  const ratio = imageAspectRatio(aspect);
  if (ratio === undefined) return next;

  const otherAxis: FaceAxis = axis === "widthMm" ? "heightMm" : "widthMm";
  const previousOther = dimensions[otherAxis];

  if (previousOther === undefined) {
    next.aspectLocked = true;
  } else if (!isAspectLocked(dimensions, aspect)) {
    return next;
  }

  // width = height × ratio; height = width ÷ ratio. Round to 0.01 mm so the
  // stored value stays tidy — well below any unit's display precision, and the
  // tolerance above keeps a derived pair reading as "matching" next time.
  const derived =
    axis === "widthMm" ? valueMm / ratio : valueMm * ratio;
  next[otherAxis] = Math.round(derived * 100) / 100;

  return next;
}
