// px → mm at the current zoom, or 0 with no zoom context (pixelsPerMm
// absent/0) — callers then skip the floor/ceiling clamp entirely and use the
// real mm value, which is what export/test rendering (no live zoom) wants.
export function mmForPx(pixelsPerMm: number, px: number): number {
  return pixelsPerMm > 0 ? px / pixelsPerMm : 0;
}

// Clamp a real-world mm construction constant to stay legible on screen: at
// least `minPx` screen pixels, but never past `maxMm` (so a tiny case's
// "20mm wall" doesn't balloon to look like a thick frame).
export function clampMm(pixelsPerMm: number, realMm: number, minPx: number, maxMm: number): number {
  return Math.min(Math.max(realMm, mmForPx(pixelsPerMm, minPx)), maxMm);
}
