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

// Returns the next Dimensions after committing `axis` to `valueMm`, auto-
// filling the OTHER face axis from the image's pixel aspect ratio when it
// makes sense to. Never touches depth or status.
//
// The rule (chosen to be least surprising): the counterpart axis is (re)derived
// only when it is currently empty, OR when the pre-commit width/height pair
// already matched the image ratio — i.e. the curator hadn't deliberately
// entered an off-ratio value. If they had (a mat, a frame, a sculpture photo
// cropped tight), their number is preserved. With no usable ratio, only the
// committed axis changes, matching the prior no-auto-fill behavior.
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

  const shouldDerive =
    previousOther === undefined ||
    pairMatchesRatio(dimensions.widthMm, dimensions.heightMm, ratio);

  if (!shouldDerive) return next;

  // width = height × ratio; height = width ÷ ratio. Round to 0.01 mm so the
  // stored value stays tidy — well below any unit's display precision, and the
  // tolerance above keeps a derived pair reading as "matching" next time.
  const derived =
    axis === "widthMm" ? valueMm / ratio : valueMm * ratio;
  next[otherAxis] = Math.round(derived * 100) / 100;

  return next;
}
