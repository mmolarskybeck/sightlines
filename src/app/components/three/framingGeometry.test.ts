import { describe, expect, it } from "vitest";
import { FRAME_DEPTH_MM } from "./tokens";
import {
  framingLayout,
  IMAGE_PROUD_MM,
  MAT_RECESS_MM,
  WALL_OFFSET_MM
} from "./framingGeometry";

// A 600x400 image; mat 50, frame 30 for the mixed cases.
const IMG_W = 600;
const IMG_H = 400;
const MAT = 50;
const FRAME = { widthMm: 30, finish: "gold" as const };

describe("framingLayout", () => {
  it("framed + matted: opening = image + 2·mat, outer = image + 2·mat + 2·frame", () => {
    const layout = framingLayout(IMG_W, IMG_H, MAT, FRAME);
    expect(layout.hasMat).toBe(true);
    expect(layout.hasFrame).toBe(true);
    expect(layout.matBandMm).toBe(MAT);
    expect(layout.frameBandMm).toBe(FRAME.widthMm);

    // Opening (frame inner / mat board) grows by the mat band on every side.
    expect(layout.openingWidthMm).toBe(IMG_W + MAT * 2);
    expect(layout.openingHeightMm).toBe(IMG_H + MAT * 2);
    // Outer adds the frame band outside the mat.
    expect(layout.outerWidthMm).toBe(IMG_W + MAT * 2 + FRAME.widthMm * 2);
    expect(layout.outerHeightMm).toBe(IMG_H + MAT * 2 + FRAME.widthMm * 2);

    // Depths: frame back at the wall, front FRAME_DEPTH_MM proud, mat recessed,
    // image just proud of the mat, outline at the frame front.
    expect(layout.frameDepthMm).toBe(FRAME_DEPTH_MM);
    expect(layout.frameFrontZMm).toBe(FRAME_DEPTH_MM);
    expect(layout.frameCenterZMm).toBe(FRAME_DEPTH_MM / 2);
    expect(layout.matZMm).toBe(FRAME_DEPTH_MM - MAT_RECESS_MM);
    expect(layout.imageZMm).toBe(FRAME_DEPTH_MM - MAT_RECESS_MM + IMAGE_PROUD_MM);
    expect(layout.outlineZMm).toBe(FRAME_DEPTH_MM);
    // Image sits behind the frame's front face (inside the reveal).
    expect(layout.imageZMm).toBeLessThan(layout.frameFrontZMm as number);
  });

  it("framed only: opening = image (no mat), outer adds only the frame band", () => {
    const layout = framingLayout(IMG_W, IMG_H, undefined, FRAME);
    expect(layout.hasMat).toBe(false);
    expect(layout.hasFrame).toBe(true);
    expect(layout.matZMm).toBeUndefined();

    expect(layout.openingWidthMm).toBe(IMG_W);
    expect(layout.openingHeightMm).toBe(IMG_H);
    expect(layout.outerWidthMm).toBe(IMG_W + FRAME.widthMm * 2);
    expect(layout.outerHeightMm).toBe(IMG_H + FRAME.widthMm * 2);

    // No mat board, but the image is still seated inside the frame reveal.
    expect(layout.imageZMm).toBe(FRAME_DEPTH_MM - MAT_RECESS_MM + IMAGE_PROUD_MM);
    expect(layout.imageZMm).toBeLessThan(FRAME_DEPTH_MM);
    expect(layout.outlineZMm).toBe(FRAME_DEPTH_MM);
  });

  it("matted only: outer = image + 2·mat, mat + image ride the plain baseline", () => {
    const layout = framingLayout(IMG_W, IMG_H, MAT, undefined);
    expect(layout.hasMat).toBe(true);
    expect(layout.hasFrame).toBe(false);
    expect(layout.frameCenterZMm).toBeUndefined();
    expect(layout.frameFrontZMm).toBeUndefined();

    expect(layout.openingWidthMm).toBe(IMG_W + MAT * 2);
    expect(layout.outerWidthMm).toBe(IMG_W + MAT * 2); // no frame band
    expect(layout.outerHeightMm).toBe(IMG_H + MAT * 2);

    // Frameless: mat hangs at the baseline off-wall gap, image just proud.
    expect(layout.matZMm).toBe(WALL_OFFSET_MM);
    expect(layout.imageZMm).toBe(WALL_OFFSET_MM + IMAGE_PROUD_MM);
    // Outline wraps the outer (mat) rect at the image depth.
    expect(layout.outlineZMm).toBe(layout.imageZMm);
  });

  it("neither: image rect unchanged, plain baseline depth (legacy-identical)", () => {
    const layout = framingLayout(IMG_W, IMG_H, undefined, undefined);
    expect(layout.hasMat).toBe(false);
    expect(layout.hasFrame).toBe(false);
    expect(layout.openingWidthMm).toBe(IMG_W);
    expect(layout.openingHeightMm).toBe(IMG_H);
    expect(layout.outerWidthMm).toBe(IMG_W);
    expect(layout.outerHeightMm).toBe(IMG_H);
    expect(layout.matZMm).toBeUndefined();
    expect(layout.frameFrontZMm).toBeUndefined();
    // The historical image depth — a plain work must not move.
    expect(layout.imageZMm).toBe(WALL_OFFSET_MM);
    expect(layout.outlineZMm).toBe(WALL_OFFSET_MM);
  });

  it("treats zero / negative mat and frame bands as absent", () => {
    const layout = framingLayout(IMG_W, IMG_H, 0, { widthMm: 0, finish: "black" });
    expect(layout.hasMat).toBe(false);
    expect(layout.hasFrame).toBe(false);
    expect(layout.outerWidthMm).toBe(IMG_W);
    expect(layout.imageZMm).toBe(WALL_OFFSET_MM);

    const negative = framingLayout(IMG_W, IMG_H, -5, { widthMm: -3, finish: "black" });
    expect(negative.hasMat).toBe(false);
    expect(negative.hasFrame).toBe(false);
  });

  it("emits no body and no z shift for a flat work, at every bodyDepthMm that means 'flat'", () => {
    // The top regression risk: a flat work must be arithmetically identical to
    // what it was before deep works existed, whichever way "flat" is spelled.
    const baseline = framingLayout(IMG_W, IMG_H, MAT, FRAME);
    for (const flat of [undefined, 0, -120]) {
      const layout = framingLayout(IMG_W, IMG_H, MAT, FRAME, flat);
      expect(layout).toEqual(baseline);
      expect("body" in layout).toBe(false);
    }
    // …and the same for the plain (unframed, unmatted) work.
    const plain = framingLayout(IMG_W, IMG_H, undefined, undefined, 0);
    expect(plain).toEqual(framingLayout(IMG_W, IMG_H, undefined, undefined));
    expect(plain.imageZMm).toBe(WALL_OFFSET_MM);
  });

  it("deep + plain: the body stands off the wall and the image rides its front face", () => {
    const DEPTH = 120;
    const layout = framingLayout(IMG_W, IMG_H, undefined, undefined, DEPTH);

    // The body is the WORK's own box (stored rect), never a framed footprint.
    expect(layout.body).toEqual({
      widthMm: IMG_W,
      heightMm: IMG_H,
      depthMm: DEPTH,
      backZMm: WALL_OFFSET_MM,
      frontZMm: WALL_OFFSET_MM + DEPTH
    });
    // Its back face never sits ON the wall plane (z-fight with the wall panel
    // and with a shared wall's coincident twin).
    expect(layout.body!.backZMm).toBeGreaterThan(0);
    // The image is mounted ON the body's front face — just proud enough not to
    // z-fight it, NOT the wall standoff (that would float the picture 20mm in
    // front of its own box, a visible air gap edge-on).
    expect(layout.imageZMm).toBe(WALL_OFFSET_MM + DEPTH + IMAGE_PROUD_MM);
    expect(layout.imageZMm - layout.body!.frontZMm).toBe(IMAGE_PROUD_MM);
    expect(layout.outlineZMm).toBe(layout.imageZMm);
  });

  it("deep + framed + matted: the frame ring sits on the body's front face, spacing unchanged", () => {
    const DEPTH = 90;
    const flat = framingLayout(IMG_W, IMG_H, MAT, FRAME);
    const deep = framingLayout(IMG_W, IMG_H, MAT, FRAME, DEPTH);
    const shiftMm = deep.body!.frontZMm;

    // The frame's BACK lands exactly on the body's front face — a frame mounted
    // on a deep stretcher, not floating off it.
    expect(deep.frameFrontZMm).toBe(shiftMm + FRAME_DEPTH_MM);
    expect(deep.frameCenterZMm).toBe(shiftMm + FRAME_DEPTH_MM / 2);
    // Every layer moved by the SAME shift, so the internal stack is untouched.
    expect(deep.matZMm! - flat.matZMm!).toBe(shiftMm);
    expect(deep.imageZMm - flat.imageZMm).toBe(shiftMm);
    expect(deep.outlineZMm - flat.outlineZMm).toBe(shiftMm);
    expect(deep.imageZMm).toBeLessThan(deep.frameFrontZMm as number);

    // Bands are unaffected by depth — the frame may overhang the body's edges.
    expect(deep.outerWidthMm).toBe(flat.outerWidthMm);
    expect(deep.openingWidthMm).toBe(flat.openingWidthMm);
    expect(deep.body!.widthMm).toBeLessThan(deep.outerWidthMm);
  });

  it("bands wrap the STORED rect: a placeholder-square rect still grows outward", () => {
    // Unknown-dims works carry a placeholder rect; the letterboxed image lives
    // INSIDE the opening, but the bands are computed off the stored rect here.
    const stored = framingLayout(1000, 1000, MAT, FRAME);
    expect(stored.openingWidthMm).toBe(1000 + MAT * 2);
    expect(stored.outerWidthMm).toBe(1000 + MAT * 2 + FRAME.widthMm * 2);
    // The opening is strictly larger than the stored image on every side.
    expect(stored.openingWidthMm).toBeGreaterThan(1000);
    expect(stored.openingHeightMm).toBeGreaterThan(1000);
  });
});
