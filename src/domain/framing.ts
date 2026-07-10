import type { ArtworkFrame, FrameFinish } from "./project";

// Schematic, flat mockup colors — deliberately NOT photoreal frame textures
// (docs/quick-todos.md). One tasteful flat value per finish, shared by the
// elevation renderer's frame fill AND the inspector's finish-dropdown swatch
// so the two never disagree about what "gold" looks like.
export const FRAME_FINISH_HEX: Record<FrameFinish, string> = {
  gold: "#C9A227",
  white: "#F5F5F2",
  black: "#1A1A1A",
  silver: "#C0C3C7",
  wood: "#8B5A2B"
};

// Ordered for the inspector dropdown; labels carry the human-facing wording
// (e.g. silver reads as "Silver / brushed aluminum" per the task).
export const FRAME_FINISHES: { value: FrameFinish; label: string }[] = [
  { value: "gold", label: "Gold" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "silver", label: "Silver / brushed aluminum" },
  { value: "wood", label: "Wood" }
];

// Off-white mat board fill and the thin bevel hairline delineating the mat's
// window against the image opening — both fixed (a mat's own color isn't
// curator-editable in this schematic pass).
export const MAT_FILL_HEX = "#F5F5F2";
export const MAT_BEVEL_HAIRLINE_HEX = "#B8B8B4";

export type OuterDimensionsMm = {
  widthMm: number;
  heightMm: number;
};

// The physical footprint an artwork actually occupies on the wall: the image
// plus a mat band (matWidthMm) on every side, plus a frame band
// (frame.widthMm) outside the mat on every side. Each band is added twice per
// axis (once per side). Missing/zero mat or frame contributes nothing, so an
// unframed, unmatted work returns its image size unchanged — this is what old
// projects (no mat/frame fields) get.
export function getArtworkOuterDimensionsMm(
  imageWidthMm: number,
  imageHeightMm: number,
  matWidthMm?: number,
  frame?: ArtworkFrame
): OuterDimensionsMm {
  const matBand = matWidthMm && matWidthMm > 0 ? matWidthMm : 0;
  const frameBand = frame && frame.widthMm > 0 ? frame.widthMm : 0;
  const bandPerSide = matBand + frameBand;

  return {
    widthMm: imageWidthMm + bandPerSide * 2,
    heightMm: imageHeightMm + bandPerSide * 2
  };
}

// Below this, a derived frame band counts as "exactly zero" rather than
// negative — absorbs unit-conversion float dust (cm/in entries round-trip
// through mm).
const DERIVE_EPSILON_MM = 0.001;

export type OverallFrameDerivation =
  // frameWidthMm === undefined means the overall equals image + 2·mat
  // exactly: clear the frame. Typing the matted size back is the natural way
  // to say "no frame", so a zero-width derivation removes it instead of
  // erroring or storing a degenerate zero-width frame.
  | { ok: true; frameWidthMm: number | undefined }
  // The entered overall is smaller than image + 2·mat; minOverallMm is the
  // smallest legal entry (frame width 0) for the caller's error message.
  | { ok: false; minOverallMm: number };

// Inverse of getArtworkOuterDimensionsMm along ONE axis, solving only for the
// frame band: frameWidthMm = (overall − image − 2·mat) / 2. Bands are uniform
// on all sides, so an overall entered on either axis derives the same frame —
// callers apply the result to the whole frame and the other axis follows,
// same spirit as the aspect-ratio autofill on the image dims. The mat is
// never adjusted; it stays exactly as the curator entered it.
export function deriveFrameWidthFromOverallMm(
  overallMm: number,
  imageMm: number,
  matWidthMm?: number
): OverallFrameDerivation {
  const matBand = matWidthMm && matWidthMm > 0 ? matWidthMm : 0;
  const frameWidthMm = (overallMm - imageMm - matBand * 2) / 2;

  if (frameWidthMm < -DERIVE_EPSILON_MM) {
    return { ok: false, minOverallMm: imageMm + matBand * 2 };
  }

  if (frameWidthMm <= DERIVE_EPSILON_MM) {
    return { ok: true, frameWidthMm: undefined };
  }

  return { ok: true, frameWidthMm };
}
