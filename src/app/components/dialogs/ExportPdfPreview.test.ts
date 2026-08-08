import { describe, expect, it } from "vitest";
import { fitBoundsToRect, type DocumentBoundsMm } from "../../../domain/export/pageComposition";
import type { PlanSceneRoom } from "../../../domain/scene2d/planScene";
import { createPlanTransform } from "../../export/pdf/transforms";
import { planDimensionMarks, planTransform } from "./ExportPdfPreview";

// The preview card and the PDF writer draw the same plan into two page spaces
// whose y axes run OPPOSITE ways: pdf-lib's page origin is bottom-left (y UP),
// the preview's <svg> origin is top-left (y DOWN). So the two transforms must
// NOT share a formula — and for a long time they did, which silently mirrored
// every preview plan page top-to-bottom.
//
// These tests pin the ORIENTATION rather than the arithmetic: whatever the two
// implementations look like, a point at the north edge of the floor has to end
// up on the same physical edge of the sheet in both.
const BOUNDS: DocumentBoundsMm = {
  minXMm: 0,
  minYMm: 0,
  maxXMm: 4000,
  maxYMm: 3000,
  widthMm: 4000,
  heightMm: 3000
};

const RECT = { xPt: 40, yPt: 60, widthPt: 400, heightPt: 300 };

// Floor space is y-DOWN (the plan canvas draws model mm straight into SVG with
// no flip), so the SMALLER yMm is the north edge.
const NORTH = { xMm: 2000, yMm: BOUNDS.minYMm };
const SOUTH = { xMm: 2000, yMm: BOUNDS.maxYMm };

describe("plan page orientation: preview vs PDF", () => {
  const fit = fitBoundsToRect(BOUNDS, RECT);
  const preview = planTransform(BOUNDS, fit);
  const pdf = createPlanTransform(BOUNDS, fit);

  it("puts north at the top of the preview's y-DOWN SVG space", () => {
    expect(preview.point(NORTH).y).toBeLessThan(preview.point(SOUTH).y);
  });

  it("puts north at the top of the PDF's y-UP page space", () => {
    expect(pdf.point(NORTH).y).toBeGreaterThan(pdf.point(SOUTH).y);
  });

  // The regression itself. Reading each transform's output as "distance down
  // from the top of the sheet" collapses the two axis conventions into one
  // comparable number: for SVG that is y as-is, for a PDF page it is the
  // page height minus y. Sharing a formula between the two makes exactly this
  // assertion fail while both of the tests above still look plausible on their
  // own — which is how the mirror survived review.
  it("agrees on which physical edge of the sheet north lands on", () => {
    // The notional page these two share: the fitted content band plus an equal
    // margin above and below it. Derived from `fit`, not from RECT, because
    // only `fit` knows where the content actually landed after centering.
    const pageHeightPt = fit.yPt * 2 + fit.heightPt;
    const downFromTop = {
      preview: (p: { xMm: number; yMm: number }) => preview.point(p).y,
      pdf: (p: { xMm: number; yMm: number }) => pageHeightPt - pdf.point(p).y
    };

    expect(downFromTop.preview(NORTH)).toBeLessThan(downFromTop.preview(SOUTH));
    expect(downFromTop.pdf(NORTH)).toBeLessThan(downFromTop.pdf(SOUTH));

    // Not just the same order — the same fraction of the way down the fitted
    // content box, so a future change that flips one and rescales the other
    // cannot slip through on ordering alone.
    const fraction = (yPt: number) => (yPt - fit.yPt) / fit.heightPt;
    expect(fraction(downFromTop.preview(NORTH))).toBeCloseTo(
      fraction(downFromTop.pdf(NORTH)),
      6
    );
    expect(fraction(downFromTop.preview(SOUTH))).toBeCloseTo(
      fraction(downFromTop.pdf(SOUTH)),
      6
    );
  });

  it("shares the x mapping, which was never in question", () => {
    expect(preview.point(NORTH).x).toBeCloseTo(pdf.point(NORTH).x, 6);
  });
});

// The dimension hints sit OUTSIDE the room on every wall. They are the one
// piece of preview drawing that decides a direction for itself rather than
// just mapping points, so they are the one piece that a change of page
// orientation can silently invert — which is exactly what happened when the
// mirror above was fixed: north and south flipped inward while east and west
// stayed put, because the hand-written correction only touched the y term.
describe("plan dimension hints", () => {
  const fit = fitBoundsToRect(BOUNDS, RECT);
  const xf = planTransform(BOUNDS, fit);

  // Only polygonMm and walls are read; the rest of PlanSceneRoom is irrelevant
  // here and expensive to build honestly.
  const corners = [
    { xMm: 0, yMm: 0 },
    { xMm: 4000, yMm: 0 },
    { xMm: 4000, yMm: 3000 },
    { xMm: 0, yMm: 3000 }
  ];
  const room = {
    polygonMm: corners,
    walls: corners.map((startMm, i) => ({
      wallId: `wall-${i}`,
      startMm,
      endMm: corners[(i + 1) % corners.length]
    }))
  } as unknown as PlanSceneRoom;

  it("offsets every wall's hint away from the room, on all four sides", () => {
    const marks = planDimensionMarks(room, xf);
    expect(marks).toHaveLength(4);

    const box = {
      minX: xf.point({ xMm: 0, yMm: 0 }).x,
      maxX: xf.point({ xMm: 4000, yMm: 0 }).x,
      minY: xf.point({ xMm: 0, yMm: 0 }).y,
      maxY: xf.point({ xMm: 0, yMm: 3000 }).y
    };
    // Where each hint's midpoint sits relative to the room box. A hint runs
    // parallel to its own wall, so it clears the box on the perpendicular axis
    // only — one of these four buckets each, never "inside".
    const sides = marks.map((mark) => {
      const { x1, y1, x2, y2 } = mark.props as Record<string, number>;
      const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      if (mid.x < box.minX) return "left";
      if (mid.x > box.maxX) return "right";
      if (mid.y < box.minY) return "above";
      if (mid.y > box.maxY) return "below";
      return "inside";
    });

    // The bug drew north and south INSIDE while east and west stayed correct,
    // so asserting the full set — not merely "none inside" — is what pins it.
    expect(sides.slice().sort()).toEqual(["above", "below", "left", "right"]);
  });
});
