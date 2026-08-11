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

// The work's own physical volume, for a WALL-placed work whose recorded depth
// makes it a solid object rather than a plane (a deep canvas on a stretcher, a
// shadow box, a relief). Present only when the work is genuinely deep — a flat
// work's layout has no `body` key at all, and every z below is then exactly the
// number it has always been.
//
// width/height are the WORK's own box, i.e. the stored placement rect — NOT the
// framed outer footprint. A frame/mat is mounted ON the front face and may
// legitimately overhang the body's edges, which is what a real frame on a deep
// stretcher does.
export type FramingBody = {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  // The box's own z span, wall surface = 0, +z into the room. The back face sits
  // one WALL_OFFSET_MM standoff off the wall rather than flush on it — the same
  // fix WallCaseMesh applies to its own box, and for the same reason: a back
  // face at z = 0 is coplanar with the wall panel AND with the coincident twin
  // panel a shared wall carries on its other side, and the two fight for the
  // depth buffer.
  backZMm: number;
  frontZMm: number;
};

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
  // The work's own volume, absent for a flat work (see FramingBody). Every z
  // above is measured from `body.frontZMm` instead of from the wall when this is
  // present, so the frame/mat/image stack rides the FRONT of the box exactly as
  // it rides the wall when there is no box.
  body?: FramingBody;
};

// Bands: image + mat (inside) + frame (outside), each added twice per axis.
// Missing/zero mat or frame contributes nothing, so a plain work returns its
// image rect unchanged and the plain-work depth baseline — this is exactly
// what legacy (no mat/frame fields) records get.
//
// bodyDepthMm is the work's own protrusion off the wall (effectiveWallArtwork-
// DepthMm — absent/0 for the flat works that are the overwhelming majority).
// When it is present the WHOLE stack slides forward to sit on the box's front
// face: the body becomes the surface everything is measured from, in place of
// the wall. That is one shift applied to every z rather than per-layer special
// cases, so a deep work's framing keeps exactly the internal spacing (reveal,
// mat recess, image proud) a flat work has — only its distance from the wall
// changes. Absent, every z is arithmetically untouched, which is what makes a
// flat work bit-for-bit identical to before deep works existed.
export function framingLayout(
  imageWidthMm: number,
  imageHeightMm: number,
  matWidthMm: number | undefined,
  frame: ArtworkFrame | undefined,
  bodyDepthMm?: number
): FramingLayout {
  const body: FramingBody | undefined =
    bodyDepthMm !== undefined && bodyDepthMm > 0
      ? {
          widthMm: imageWidthMm,
          heightMm: imageHeightMm,
          depthMm: bodyDepthMm,
          backZMm: WALL_OFFSET_MM,
          frontZMm: WALL_OFFSET_MM + bodyDepthMm
        }
      : undefined;
  // The datum every layer below measures from: the box's front face, or the
  // wall itself when the work is flat.
  const surfaceZMm = body ? body.frontZMm : 0;
  // Frameless standoff from that datum. A flat work hangs WALL_OFFSET_MM off
  // the wall (a plane this module does not draw, so it needs both the visual
  // standoff and the z-fight clearance); a DEEP work's image/mat is mounted ON
  // the body's own front face and seats there the way the image seats on a mat
  // — reusing the wall standoff here would float the picture 20mm in front of
  // its own box, a visible air gap edge-on.
  const surfaceStandoffMm = body ? IMAGE_PROUD_MM : WALL_OFFSET_MM;

  const matBandMm = matWidthMm && matWidthMm > 0 ? matWidthMm : 0;
  const frameBandMm = frame && frame.widthMm > 0 ? frame.widthMm : 0;
  const hasMat = matBandMm > 0;
  const hasFrame = frameBandMm > 0;

  const openingWidthMm = imageWidthMm + matBandMm * 2;
  const openingHeightMm = imageHeightMm + matBandMm * 2;
  const outerWidthMm = openingWidthMm + frameBandMm * 2;
  const outerHeightMm = openingHeightMm + frameBandMm * 2;

  // Frame ring: back on the surface (wall, or the body's front face), front
  // FRAME_DEPTH_MM proud of it, centered halfway.
  const frameFrontZMm = hasFrame ? surfaceZMm + FRAME_DEPTH_MM : undefined;
  const frameCenterZMm = hasFrame ? surfaceZMm + FRAME_DEPTH_MM / 2 : undefined;

  // Mat plane: recessed a step behind the frame front when framed; the plain
  // off-wall baseline when matted but frameless.
  const matZMm = hasMat
    ? hasFrame
      ? surfaceZMm + FRAME_DEPTH_MM - MAT_RECESS_MM
      : surfaceZMm + surfaceStandoffMm
    : undefined;

  // Image plane: proud of the mat when matted; seated in the frame's reveal
  // when framed-but-matless; the plain baseline otherwise (legacy-identical).
  const imageZMm = hasMat
    ? (matZMm as number) + IMAGE_PROUD_MM
    : hasFrame
      ? surfaceZMm + FRAME_DEPTH_MM - MAT_RECESS_MM + IMAGE_PROUD_MM
      : surfaceZMm + surfaceStandoffMm;

  // Outline at the frame front when framed so it stays visible; else it rides
  // just at the image plane's depth (the caller adds its small proud offset).
  const outlineZMm = hasFrame ? surfaceZMm + FRAME_DEPTH_MM : imageZMm;

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
    outlineZMm,
    // Spread, not `body: undefined`: a flat work's layout must carry no `body`
    // key at all, so "is this deep?" is one presence test everywhere.
    ...(body ? { body } : {})
  };
}
