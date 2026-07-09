import type { Vector2 } from "../../domain/geometry/dragResize";

// A pending marquee (rubber-band) selection — tracked as two pointer samples.
// Both coordinates are in the local view's space (y-down for plan, y-up for
// elevation wall-local), so the min/max rect built from the two samples is
// valid regardless of drag direction.
export type MarqueeState = {
  startMm: Vector2;
  currentMm: Vector2;
};

// Min/max rect from a marquee's two pointer samples — the shape both
// hitTest and the rendered <rect> consume.
export function marqueeRectMm(marquee: MarqueeState): {
  minXMm: number;
  maxXMm: number;
  minYMm: number;
  maxYMm: number;
} {
  return {
    minXMm: Math.min(marquee.startMm.xMm, marquee.currentMm.xMm),
    maxXMm: Math.max(marquee.startMm.xMm, marquee.currentMm.xMm),
    minYMm: Math.min(marquee.startMm.yMm, marquee.currentMm.yMm),
    maxYMm: Math.max(marquee.startMm.yMm, marquee.currentMm.yMm)
  };
}
