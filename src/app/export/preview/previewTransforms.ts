import {
  DOCUMENT_FOOTER_HEIGHT_PT,
  DOCUMENT_HEADER_HEIGHT_PT,
  DOCUMENT_PAGE_MARGIN_PT,
  fitBoundsToRect,
  getPageSizePt,
  type DocumentBoundsMm,
  type DocumentOrientation
} from "../../../domain/export/pageComposition";
import type { EffectiveDocumentSettings } from "../../../domain/export/documentSettings";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import { DRAWING_INSET_PT, type Transform } from "./previewStyle";

// The page's content rect in SVG (y-DOWN) point space: full margins on all
// sides, header band reserved at the TOP (SVG-natural) and footer at the
// bottom — the same bands getPageDrawingRectPt carves out, so content sits
// where it will on the real page.
export function drawingRectPt(
  paperSize: EffectiveDocumentSettings["paperSize"],
  orientation: DocumentOrientation
) {
  const page = getPageSizePt(paperSize, orientation);
  return {
    xPt: DOCUMENT_PAGE_MARGIN_PT + DRAWING_INSET_PT,
    yPt: DOCUMENT_PAGE_MARGIN_PT + DOCUMENT_HEADER_HEIGHT_PT + DRAWING_INSET_PT,
    widthPt: page.widthPt - (DOCUMENT_PAGE_MARGIN_PT + DRAWING_INSET_PT) * 2,
    heightPt:
      page.heightPt -
      (DOCUMENT_PAGE_MARGIN_PT + DRAWING_INSET_PT) * 2 -
      DOCUMENT_HEADER_HEIGHT_PT -
      DOCUMENT_FOOTER_HEIGHT_PT
  };
}

// Plan transform: floor mm (y-DOWN, the same sense the plan canvas draws in) →
// SVG points (y-DOWN). A plain shift and scale, with NO flip.
//
// This deliberately does NOT copy createPlanTransform's formula, and copying it
// is exactly the bug this comment exists to prevent. That function ends in
// `(bounds.maxYMm - yMm)`, which looks like the thing to match — but its
// destination is pdf-lib page space, where y runs UP from the bottom-left, so
// the subtraction is what puts north at the TOP of the sheet. Here the
// destination is SVG, where y runs DOWN. The identical expression against the
// opposite axis mirrors the whole page: north renders at the bottom, and every
// room, artwork and door sits on the wrong side of the plan.
//
// It was invisible for as long as plan pages held only symmetric marks. The
// hinged-door swing arc is the first strongly HANDED plan glyph, and it made a
// preview that had been upside-down since the preview shipped (cec13cba) read
// as a door hinged on the wrong jamb.
//
// So this is now identical to elevationTransform. They are kept separate
// anyway: they answer different questions (floor space vs. wall-local space),
// and collapsing them would invite re-deriving one from the other's page
// conventions — which is how this went wrong in the first place.
export function planTransform(
  bounds: DocumentBoundsMm,
  fit: ReturnType<typeof fitBoundsToRect>
): Transform {
  return {
    scalePtPerMm: fit.scalePtPerMm,
    point: ({ xMm, yMm }) => ({
      x: fit.xPt + (xMm - bounds.minXMm) * fit.scalePtPerMm,
      y: fit.yPt + (yMm - bounds.minYMm) * fit.scalePtPerMm
    })
  };
}

// Elevation transform: wall-local SVG (already y-DOWN, top = 0) → SVG points.
export function elevationTransform(
  bounds: DocumentBoundsMm,
  fit: ReturnType<typeof fitBoundsToRect>
): Transform {
  return {
    scalePtPerMm: fit.scalePtPerMm,
    point: ({ xMm, yMm }) => ({
      x: fit.xPt + (xMm - bounds.minXMm) * fit.scalePtPerMm,
      y: fit.yPt + (yMm - bounds.minYMm) * fit.scalePtPerMm
    })
  };
}

// Rotate a rect-local (center-origin) point into world mm — the plan glyphs are
// authored in a local-centered frame, same as planRectWorldPoint.
export function localToWorld(rect: PlanRect, xMm: number, yMm: number) {
  const angle = (rect.angleDeg * Math.PI) / 180;
  return {
    xMm: rect.centerXMm + xMm * Math.cos(angle) - yMm * Math.sin(angle),
    yMm: rect.centerYMm + xMm * Math.sin(angle) + yMm * Math.cos(angle)
  };
}

// A coarse grid interval near bounds/10 — legible without the per-unit
// precision math the real export uses (a faint hint, not a measuring grid).
export const NICE_STEPS_MM = [
  50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 50_000
];
export function coarseGridStepMm(spanMm: number): number {
  const target = spanMm / 10;
  return (
    NICE_STEPS_MM.find((step) => step >= target) ??
    NICE_STEPS_MM[NICE_STEPS_MM.length - 1]
  );
}
