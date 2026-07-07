import { getPixelsPerMm } from "../units/precision";

export type Viewport2D = {
  mode: "fit" | "manual";
  centerXMm: number; // SVG-userspace mm (y-down); meaningful only in manual mode
  centerYMm: number;
  zoom: number; // relative to fit; 1 = fit scale; meaningful only in manual mode
};

export const FIT_VIEWPORT: Viewport2D = { mode: "fit", centerXMm: 0, centerYMm: 0, zoom: 1 };

export type ViewBox = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

export type ZoomLimits = {
  minZoom: number; // relative to fit
  maxZoom: number; // relative to fit
  minViewBoxWidthMm: number; // world-space cap on zooming in
};
export const PLAN_ZOOM_LIMITS: ZoomLimits = { minZoom: 0.25, maxZoom: 12, minViewBoxWidthMm: 250 };
export const ELEVATION_ZOOM_LIMITS: ZoomLimits = { minZoom: 0.25, maxZoom: 24, minViewBoxWidthMm: 250 };
export const ZOOM_STEP = 1.25; // [+]/[-] buttons
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // factor = exp(-normalizedDeltaY * s)

// contentBounds = padded fit bounds each view already computes
// (plan: floor bounds + padding; elevation: wall rect + 6% pad).
export function getViewBox2D(
  viewport: Viewport2D,
  contentBounds: ViewBox,
  containerPx: Size
): { viewBox: ViewBox; pixelsPerMm: number } {
  const fitPpm = getPixelsPerMm(containerPx, contentBounds);
  if (fitPpm <= 0) return { viewBox: contentBounds, pixelsPerMm: 0 }; // pre-measure fallback

  const zoom = viewport.mode === "fit" ? 1 : viewport.zoom;
  const centerX = viewport.mode === "fit" ? contentBounds.x + contentBounds.width / 2 : viewport.centerXMm;
  const centerY = viewport.mode === "fit" ? contentBounds.y + contentBounds.height / 2 : viewport.centerYMm;

  const pixelsPerMm = fitPpm * zoom;
  const width = containerPx.width / pixelsPerMm; // viewBox aspect === container aspect
  const height = containerPx.height / pixelsPerMm; // -> zero letterboxing, ppm exact
  return {
    viewBox: { x: centerX - width / 2, y: centerY - height / 2, width, height },
    pixelsPerMm
  };
}

export function clampZoom(
  zoom: number,
  contentBounds: ViewBox,
  containerPx: Size,
  limits: ZoomLimits
): number {
  const fitPpm = getPixelsPerMm(containerPx, contentBounds);
  if (fitPpm <= 0) return Math.min(Math.max(zoom, limits.minZoom), limits.maxZoom);
  // viewBoxWidth = containerPx.width / (fitPpm * zoom) >= minViewBoxWidthMm
  const widthCap = containerPx.width / (fitPpm * limits.minViewBoxWidthMm);
  const max = Math.min(limits.maxZoom, Math.max(widthCap, limits.minZoom));
  return Math.min(Math.max(zoom, limits.minZoom), max);
}

// Keeps the world point under the cursor fixed. Derivation: the point's fractional
// position inside the viewBox must be invariant; since viewBox size ∝ 1/zoom,
// the vector from point to center scales by oldZoom / newZoom.
export function zoomAtPoint(
  viewport: Viewport2D,
  pointMm: { xMm: number; yMm: number }, // SVG-userspace, from getScreenCTM().inverse()
  zoomFactor: number,
  contentBounds: ViewBox,
  containerPx: Size,
  limits: ZoomLimits
): Viewport2D {
  const { viewBox } = getViewBox2D(viewport, contentBounds, containerPx);
  const oldZoom = viewport.mode === "fit" ? 1 : viewport.zoom;
  const newZoom = clampZoom(oldZoom * zoomFactor, contentBounds, containerPx, limits);
  if (newZoom === oldZoom && viewport.mode === "manual") return viewport;
  const ratio = oldZoom / newZoom;
  const oldCx = viewBox.x + viewBox.width / 2;
  const oldCy = viewBox.y + viewBox.height / 2;
  return {
    mode: "manual",
    centerXMm: pointMm.xMm + (oldCx - pointMm.xMm) * ratio,
    centerYMm: pointMm.yMm + (oldCy - pointMm.yMm) * ratio,
    zoom: newZoom
  };
}

// centerDeltaPx: signed movement of the viewport CENTER in px.
// Drag-pan callers pass the NEGATED pointer delta (content follows the pointer);
// wheel-pan callers pass the wheel delta directly.
export function panBy(
  viewport: Viewport2D,
  centerDeltaPx: { x: number; y: number },
  contentBounds: ViewBox,
  containerPx: Size
): Viewport2D {
  const { viewBox, pixelsPerMm } = getViewBox2D(viewport, contentBounds, containerPx);
  if (pixelsPerMm <= 0) return viewport;
  return {
    mode: "manual",
    centerXMm: viewBox.x + viewBox.width / 2 + centerDeltaPx.x / pixelsPerMm,
    centerYMm: viewBox.y + viewBox.height / 2 + centerDeltaPx.y / pixelsPerMm,
    zoom: viewport.mode === "fit" ? 1 : viewport.zoom
  };
}

// Frame an arbitrary world-space target (powers elevation "Fit selected").
// targetBounds: SVG-userspace mm, padding already applied by the caller.
export function getFitBoundsViewport(
  targetBounds: ViewBox,
  contentBounds: ViewBox,
  containerPx: Size,
  limits: ZoomLimits
): Viewport2D {
  const fitPpm = getPixelsPerMm(containerPx, contentBounds);
  const targetPpm = getPixelsPerMm(containerPx, targetBounds);
  if (fitPpm <= 0 || targetPpm <= 0) return FIT_VIEWPORT;
  return {
    mode: "manual",
    centerXMm: targetBounds.x + targetBounds.width / 2,
    centerYMm: targetBounds.y + targetBounds.height / 2,
    zoom: clampZoom(targetPpm / fitPpm, contentBounds, containerPx, limits)
  };
}

export function getEffectiveZoom(viewport: Viewport2D): number {
  return viewport.mode === "fit" ? 1 : viewport.zoom;
}
