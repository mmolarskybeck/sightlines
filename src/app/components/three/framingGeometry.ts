import type { ArtworkFrame } from "../../../domain/project";
import { FRAME_DEPTH_MM } from "./tokens";

// Pure band/ring math for a framed + matted wall artwork in the 3D view — the
// three.js analogue of ElevationArtwork's expandRect chain. Given the STORED
// image rect (the wall-object size) plus optional mat/frame bands, it derives
// the frame's inner opening, the outer footprint (what the outline wraps), and
// the off-wall depths every layer sits at. Kept free of three.js imports so it
// unit-tests like artworkFit.ts.
//
// Elevation grows the rect OUTWARD (docs/quick-todos.md): mat sits directly
// around the image, frame outside the mat. We mirror that exactly so the two
// views agree on footprint; the only 3D-specific part is depth.

// Baseline off-wall offset for a plain (unframed, unmatted) work — the small
// gap that keeps the image plane from z-fighting the wall. A matted-but-
// frameless work hangs its mat board at this same baseline. Matches the value
// ArtworkPlane has always used, so legacy records are bit-identical.
export const WALL_OFFSET_MM = 20;

// The mat board sits this far BEHIND the frame's front face — a shallow reveal
// so the frame reads as standing proud of the mat.
export const MAT_RECESS_MM = 8;

// The image plane sits this far proud of the mat board so the two never
// z-fight (and, when framed but matless, proud of the recessed image seat).
export const IMAGE_PROUD_MM = 1;

export type FramingLayout = {
  hasMat: boolean;
  hasFrame: boolean;
  matBandMm: number;
  frameBandMm: number;
  // Frame's inner opening AND the mat board footprint: image + 2·mat.
  openingWidthMm: number;
  openingHeightMm: number;
  // Outer footprint: image + 2·mat + 2·frame — the rect the selection /
  // uncertainty outline wraps (matching elevation's outerRect).
  outerWidthMm: number;
  outerHeightMm: number;
  // Off-wall depths (mm), all measured from the wall surface outward (+z into
  // the room). frame* are undefined when frameless; matZMm is undefined when
  // matless.
  frameDepthMm: number;
  frameCenterZMm: number | undefined;
  frameFrontZMm: number | undefined;
  matZMm: number | undefined;
  imageZMm: number;
  // Depth to seat the outline at: the frame's front face when framed (so it
  // isn't buried inside the ring), else the image plane's depth.
  outlineZMm: number;
};

// Bands: image + mat (inside) + frame (outside), each added twice per axis.
// Missing/zero mat or frame contributes nothing, so a plain work returns its
// image rect unchanged and the plain-work depth baseline — this is exactly
// what legacy (no mat/frame fields) records get.
export function framingLayout(
  imageWidthMm: number,
  imageHeightMm: number,
  matWidthMm: number | undefined,
  frame: ArtworkFrame | undefined
): FramingLayout {
  const matBandMm = matWidthMm && matWidthMm > 0 ? matWidthMm : 0;
  const frameBandMm = frame && frame.widthMm > 0 ? frame.widthMm : 0;
  const hasMat = matBandMm > 0;
  const hasFrame = frameBandMm > 0;

  const openingWidthMm = imageWidthMm + matBandMm * 2;
  const openingHeightMm = imageHeightMm + matBandMm * 2;
  const outerWidthMm = openingWidthMm + frameBandMm * 2;
  const outerHeightMm = openingHeightMm + frameBandMm * 2;

  // Frame ring: back at the wall, front FRAME_DEPTH_MM proud, centered halfway.
  const frameFrontZMm = hasFrame ? FRAME_DEPTH_MM : undefined;
  const frameCenterZMm = hasFrame ? FRAME_DEPTH_MM / 2 : undefined;

  // Mat plane: recessed a step behind the frame front when framed; the plain
  // off-wall baseline when matted but frameless.
  const matZMm = hasMat
    ? hasFrame
      ? FRAME_DEPTH_MM - MAT_RECESS_MM
      : WALL_OFFSET_MM
    : undefined;

  // Image plane: proud of the mat when matted; seated in the frame's reveal
  // when framed-but-matless; the plain baseline otherwise (legacy-identical).
  const imageZMm = hasMat
    ? (matZMm as number) + IMAGE_PROUD_MM
    : hasFrame
      ? FRAME_DEPTH_MM - MAT_RECESS_MM + IMAGE_PROUD_MM
      : WALL_OFFSET_MM;

  // Outline at the frame front when framed so it stays visible; else it rides
  // just at the image plane's depth (the caller adds its small proud offset).
  const outlineZMm = hasFrame ? FRAME_DEPTH_MM : imageZMm;

  return {
    hasMat,
    hasFrame,
    matBandMm,
    frameBandMm,
    openingWidthMm,
    openingHeightMm,
    outerWidthMm,
    outerHeightMm,
    frameDepthMm: FRAME_DEPTH_MM,
    frameCenterZMm,
    frameFrontZMm,
    matZMm,
    imageZMm,
    outlineZMm
  };
}
