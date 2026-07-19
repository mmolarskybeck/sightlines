import type {
  Artwork,
  ArtworkFrame,
  FrameFinish,
  WallObject,
  WallObjectBase
} from "./project";

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
  { value: "silver", label: "Silver" },
  { value: "wood", label: "Wood" }
];

// Off-white mat board fill and the thin bevel hairline delineating the mat's
// window against the image opening — both fixed (a mat's own color isn't
// curator-editable in this schematic pass).
export const MAT_FILL_HEX = "#F5F5F2";
export const MAT_BEVEL_HAIRLINE_HEX = "#B8B8B4";

// Hairline delineating a frame band's edges, per finish. Light finishes share
// the mat-bevel grey; the dark finishes (black, wood) get a quieter mid-grey —
// the near-white bevel line reads too loud against them.
export const FRAME_EDGE_HAIRLINE_HEX: Record<FrameFinish, string> = {
  gold: MAT_BEVEL_HAIRLINE_HEX,
  white: MAT_BEVEL_HAIRLINE_HEX,
  black: "#6B6B68",
  silver: MAT_BEVEL_HAIRLINE_HEX,
  wood: "#6B6B68"
};

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

// The mat/frame that geometry and the renderer should actually use. When the
// work's dimensions already include the frame (frameIncludedInImage), there is
// nothing to add or draw: the frame is part of the photo/size as given, so both
// bands read as absent. Legacy/unflagged records return their own mat/frame
// unchanged. This is the ONLY place the flag is interpreted — geometry, render,
// tooltip, and inspector all route through here, so a flagged work can never
// double-count (footprint == image size) or draw a schematic band over a photo
// that already shows a frame. A missing artwork (dangling id) contributes no
// bands, same as today.
export function effectiveFraming(
  artwork?: Pick<Artwork, "matWidthMm" | "frame" | "frameIncludedInImage">
): { matWidthMm?: number; frame?: ArtworkFrame } {
  if (!artwork || artwork.frameIncludedInImage) {
    return {};
  }
  return { matWidthMm: artwork.matWidthMm, frame: artwork.frame };
}

// Placement width/height are always the persisted image footprint. Framing is
// a read-time expansion; displayDimensionsOverride is provenance/display
// metadata and is deliberately not consulted here. The wallId requirement is
// intentional: a floor object's heightMm is its remembered hang height, not a
// footprint axis.
//
// Framing is WALL-ONLY geometry: floor objects have no footprint helper here and
// are deliberately framing-agnostic (docs/framing-dimension-contract.md §3, Phase
// 6b). A floor work's physical orientation is unknown — flat, leaning, crated —
// so an outer height cannot be mapped onto plan depth. Do not add a floor variant
// until artworks carry an explicit orientation.
export function getPlacementFootprintMm(
  placement: Pick<WallObjectBase, "widthMm" | "heightMm"> & { wallId: string },
  artwork?: Pick<Artwork, "matWidthMm" | "frame" | "frameIncludedInImage">
): OuterDimensionsMm {
  const { matWidthMm, frame } = effectiveFraming(artwork);
  return getArtworkOuterDimensionsMm(
    placement.widthMm,
    placement.heightMm,
    matWidthMm,
    frame
  );
}

// Canonical adapter for geometry boundaries. Domain geometry remains pure over
// WallObjectBase, while callers widen only resolved wall artwork placements. A
// missing artwork record (including a dangling artworkId) and non-artwork wall
// objects pass through by identity.
export function withArtworkFootprint<T extends WallObject>(
  object: T,
  artwork?: Pick<Artwork, "matWidthMm" | "frame" | "frameIncludedInImage">
): T {
  if (object.kind !== "artwork" || !artwork) {
    return object;
  }

  const footprint = getPlacementFootprintMm(object, artwork);
  if (footprint.widthMm === object.widthMm && footprint.heightMm === object.heightMm) {
    return object;
  }

  return { ...object, ...footprint };
}

// Callers that hold an id→Artwork lookup rather than an already-resolved
// artwork record collapse onto this instead of repeating the kind guard +
// map lookup inline. The guard stays here (not just inside
// withArtworkFootprint) because artworkId only exists on the artwork member
// of the WallObject union — narrowing before the lookup is what makes the
// `.get` call type-check, not merely an optimization. A missing map (some
// callers hold it as optional) behaves like a missing entry: identity.
export function withArtworkFootprintFromMap<T extends WallObject>(
  object: T,
  artworksById: Map<string, Artwork> | undefined
): T {
  return withArtworkFootprint(
    object,
    object.kind === "artwork" ? artworksById?.get(object.artworkId) : undefined
  );
}

// Below this, a derived frame band counts as "exactly zero" rather than
// negative — absorbs unit-conversion float dust (cm/in entries round-trip
// through mm).
const DERIVE_EPSILON_MM = 0.001;

// A rect in millimeters, in whatever mm coordinate space the caller is
// already working in (elevation SVG mm, or the PDF exporter's y-up mm before
// its own pt scaling). getArtworkRingRectsMm is coordinate-space agnostic —
// it only adds/subtracts bands — so both callers can hand it their native mm
// rect without translating axes first.
export type RingRectMm = {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

// Grow a mm rect outward by an equal band on every side. A non-positive band
// returns the rect unchanged (by identity), matching the "absent band adds
// nothing" contract used throughout this module.
function expandRingRectMm(rect: RingRectMm, bandMm: number): RingRectMm {
  if (bandMm <= 0) return rect;
  return {
    xMm: rect.xMm - bandMm,
    yMm: rect.yMm - bandMm,
    widthMm: rect.widthMm + bandMm * 2,
    heightMm: rect.heightMm + bandMm * 2
  };
}

// The mat/frame ring nesting shared by both renderers of an artwork's
// schematic framing (ElevationArtwork.tsx and createDocumentPdf.ts): the mat
// sits directly around the image, the frame sits outside the mat, and each
// band is a uniform width on every side. Bands ≤0 contribute nothing, so an
// unmatted/unframed image's matRect and outerRect both equal imageRect.
//
// Coordinate-space agnostic and unscaled (pure mm in, pure mm out) so a
// caller working in points (the PDF path) can apply its own scale/transform
// to the returned mm rects afterward — for an affine transform with a single
// scale factor, expanding in mm then scaling gives the identical result as
// expanding in already-scaled units (scale · (a − band) = scale · a − scale ·
// band), so the two calls sites cannot visually diverge.
export function getArtworkRingRectsMm(
  imageRectMm: RingRectMm,
  matWidthMm: number,
  frameWidthMm: number
): { matRect: RingRectMm; outerRect: RingRectMm } {
  const matRect = expandRingRectMm(imageRectMm, matWidthMm);
  const outerRect = expandRingRectMm(matRect, frameWidthMm);
  return { matRect, outerRect };
}

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
