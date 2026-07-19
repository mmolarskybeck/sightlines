import type { PDFImage } from "pdf-lib";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import type {
  DocumentBoundsMm,
  FitToPageResult
} from "../../../domain/export/pageComposition";

export type PlanTransform = {
  scalePtPerMm: number;
  point: (point: { xMm: number; yMm: number }) => { x: number; y: number };
};

export type ElevationTransform = {
  scalePtPerMm: number;
  point: (point: { xMm: number; yMm: number }) => { x: number; y: number };
};

export function createPlanTransform(
  bounds: DocumentBoundsMm,
  fit: FitToPageResult
): PlanTransform {
  return {
    scalePtPerMm: fit.scalePtPerMm,
    point: ({ xMm, yMm }) => ({
      x: fit.xPt + (xMm - bounds.minXMm) * fit.scalePtPerMm,
      y: fit.yPt + (bounds.maxYMm - yMm) * fit.scalePtPerMm
    })
  };
}

export function createElevationTransform(
  bounds: DocumentBoundsMm,
  fit: FitToPageResult
): ElevationTransform {
  return {
    scalePtPerMm: fit.scalePtPerMm,
    point: ({ xMm, yMm }) => ({
      x: fit.xPt + (xMm - bounds.minXMm) * fit.scalePtPerMm,
      y: fit.yPt + (yMm - bounds.minYMm) * fit.scalePtPerMm
    })
  };
}

// pdf-lib's drawSvgPath interprets the path in SVG y-DOWN space relative to
// the (x, y) origin option (default 0,0), so page-space y must be negated or
// the shape lands below the page and never prints. Inputs here are page
// coordinates (y-up); the negation makes drawSvgPath render them in place.
export function polygonPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return [
    `M ${points[0]!.x} ${-points[0]!.y}`,
    ...points.slice(1).map((point) => `L ${point.x} ${-point.y}`),
    "Z"
  ].join(" ");
}

export function planRectWorldPoint(
  rect: PlanRect,
  local: { xMm: number; yMm: number }
): { xMm: number; yMm: number } {
  const angle = (rect.angleDeg * Math.PI) / 180;
  return {
    xMm:
      rect.centerXMm +
      local.xMm * Math.cos(angle) -
      local.yMm * Math.sin(angle),
    yMm:
      rect.centerYMm +
      local.xMm * Math.sin(angle) +
      local.yMm * Math.cos(angle)
  };
}

export function imageRectInside(
  container: { x: number; y: number; width: number; height: number },
  image: PDFImage
) {
  const scale = Math.min(
    container.width / image.width,
    container.height / image.height
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
    width,
    height
  };
}

export function elevationRect(
  transform: ElevationTransform,
  xMm: number,
  yMm: number,
  widthMm: number,
  heightMm: number
) {
  const bottomLeft = transform.point({ xMm, yMm });
  return {
    x: bottomLeft.x,
    y: bottomLeft.y,
    width: widthMm * transform.scalePtPerMm,
    height: heightMm * transform.scalePtPerMm
  };
}
