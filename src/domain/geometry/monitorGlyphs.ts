// CRT / box-monitor construction — the single source of truth for how a
// monitor placement's real geometry (a black 4:3-faced box, optionally on a
// white pedestal) is sized and echoed as 2D marks in plan and elevation. Pure,
// mm-space, no React/pixel/zoom knowledge, exactly like caseGlyphs.ts next to
// it: callers (screen SVG, PDF export, the 3D mesh) apply their own coordinate
// mapping on top of the RAW mm structure returned here, so the drawing, the
// print and the model can never drift.
//
// Coordinate conventions, matching caseGlyphs.ts:
// - Elevation glyphs are returned in a LOCAL frame with origin at the WHOLE
//   assembly's top-left (the monitor's top-left when there is a pedestal
//   beneath it), x rightward, y DOWNWARD (SVG-natural). The PDF, whose model
//   space is y-up, flips y itself.
// - Plan glyphs are returned in a LOCAL-CENTERED frame (origin at the
//   footprint center), x rightward, y downward — the frame both the screen
//   <g transform="rotate(...)"> and the PDF planRectWorldPoint expect. Plan +y
//   is the object's FRONT (see PlanObject.tsx's FRONT-FACE CONVENTION), which
//   is the face the screen is on.

import { isPositive } from "./isPositive";
import type { Dimensions, MonitorSupport } from "../project";
import {
  effectiveDisplayAs,
  type DisplayAsSource
} from "../placement/artworkForm";

// Curatorial defaults for a work displayed on a CRT box monitor
// (Artwork.displayAs === "monitor"), in the same spirit as the display-case
// defaults in caseGlyphs.ts: a first placement a curator adjusts numerically
// afterwards. Shared by the 3D mesh (three/CrtMonitorMesh.tsx) and the store's
// placement seeding, so no view can invent its own monitor.

// The monitor face's aspect — 4:3, the whole point of the type. Width drives
// height (and vice versa) through this one ratio; nothing else may hard-code it.
export const MONITOR_ASPECT_RATIO = 4 / 3;
// Face width when the work records no usable dimension at all — roughly a
// 25-inch gallery CRT, giving a 375mm-tall face at 4:3.
export const MONITOR_DEFAULT_WIDTH_MM = 500;
// Front-to-back depth of the box. A CRT is deep — deeper than it is tall — and
// drawing it shallow is what makes a plan read as a flatscreen instead.
// Constant, not derived: tube depth doesn't scale with screen size the way the
// face does.
export const MONITOR_DEPTH_MM = 450;
// The black surround between the box's front face and the picture, on every
// side. The screen area is the face inset by this; the image is then CONTAINED
// inside that area, so letterboxing costs nothing extra — it is just more of
// the same black box.
export const MONITOR_BEZEL_MM = 30;
// Pedestal height, floor to the monitor's underside. Standard plinth height:
// puts a seated 375mm face's centre near a standing eyeline.
export const MONITOR_PEDESTAL_HEIGHT_MM = 800;

// Whether a work is displayed as a box monitor. One predicate, so no renderer
// has to remember the field name or the auto-resolution rule; tolerant of an
// undefined record (a placement whose artwork failed to join reads as a plain
// box, never as a monitor with no image).
//
// Routed through effectiveDisplayAs for consistency with every other display
// question, not for a behavior change: no medium resolves to "monitor", so
// this is true for exactly the records `displayAs === "monitor"` was true for.
// A monitor is equipment the curator states they have; it is never inferred.
export function isMonitorArtwork(artwork: DisplayAsSource | undefined): boolean {
  return artwork !== undefined && effectiveDisplayAs(artwork) === "monitor";
}

// ABSENT MEANS PEDESTAL. Resolved here, at read time, rather than baked in at
// write time — see ArtworkFloorObject.monitorSupport for why. Every renderer
// goes through this rather than testing the field, so "never chosen" and an
// explicit "pedestal" can never diverge.
export function resolveMonitorSupport(
  monitorSupport: MonitorSupport | undefined
): MonitorSupport {
  return monitorSupport ?? "pedestal";
}

export type MonitorBoxSizeMm = {
  widthMm: number;
  heightMm: number;
  depthMm: number;
};

// The monitor BOX's own size, from whatever the work records.
//
// The box is a piece of equipment, not the work, so its face is always 4:3 —
// the recorded dimensions only ever choose its SCALE:
//   - a known width is taken as the monitor's width (height follows at 4:3);
//   - a known height alone drives the width the same way;
//   - width and height both known still uses the WIDTH, because an off-ratio
//     pair describes the video's picture, not the cabinet it plays on, and a
//     4:3 cabinet is the thing being drawn;
//   - nothing usable falls back to MONITOR_DEFAULT_WIDTH_MM.
// Depth is always MONITOR_DEPTH_MM: a tube's depth doesn't scale with the face,
// and a work's own depthMm (if any) describes the work, not the monitor.
export function monitorBoxSizeMm(
  dimensions: Pick<Dimensions, "widthMm" | "heightMm"> | undefined
): MonitorBoxSizeMm {
  const widthMm = isPositive(dimensions?.widthMm)
    ? dimensions.widthMm
    : isPositive(dimensions?.heightMm)
      ? dimensions.heightMm * MONITOR_ASPECT_RATIO
      : MONITOR_DEFAULT_WIDTH_MM;

  return {
    widthMm,
    heightMm: widthMm / MONITOR_ASPECT_RATIO,
    depthMm: MONITOR_DEPTH_MM
  };
}

// How tall the pedestal under a monitor is: its real height, or 0 when the
// curator stood the monitor on the floor. A single resolver so plan, elevation,
// 3D and the PDF agree on whether there is anything under the box at all.
export function monitorPedestalHeightMm(
  monitorSupport: MonitorSupport | undefined
): number {
  return resolveMonitorSupport(monitorSupport) === "pedestal"
    ? MONITOR_PEDESTAL_HEIGHT_MM
    : 0;
}

// ─── Screen rect (shared by 3D and elevation) ──────────────────────────────

export type MonitorScreenRectMm = {
  // Local to the monitor face, origin at its TOP-LEFT, y downward.
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

// The picture area on the monitor's front face: the face inset by the bezel on
// every side. Returns null when the face is too small to hold a bezel on both
// sides of either axis — then the caller draws the bare black face rather than
// a degenerate or inverted screen.
//
// The bezel is a parameter (defaulting to the real constant) for the same
// reason caseGlyphs takes clamped insets: the screen may clamp it for
// legibility at low zoom, while 3D and the PDF pass nothing and get true mm.
export function monitorScreenRectMm({
  widthMm,
  heightMm,
  bezelMm = MONITOR_BEZEL_MM
}: {
  widthMm: number;
  heightMm: number;
  bezelMm?: number;
}): MonitorScreenRectMm | null {
  const screenWidthMm = widthMm - bezelMm * 2;
  const screenHeightMm = heightMm - bezelMm * 2;
  if (screenWidthMm <= 0 || screenHeightMm <= 0) return null;
  return {
    xMm: bezelMm,
    yMm: bezelMm,
    widthMm: screenWidthMm,
    heightMm: screenHeightMm
  };
}

// The size to draw the work's image at inside the screen area: CONTAINED
// (letterboxed/pillarboxed), always — never stretched, and never cropped.
//
// Unconditional, unlike fitArtworkImageSizeMm's status-gated rule for wall
// works, and that is the point of the type: a 4:3 cabinet is equipment, and a
// 16:9 video shown on one really does letterbox. The bars cost nothing to draw
// because the surround is already the black box.
//
// Returns the screen area unchanged while the aspect is unusable (texture still
// loading), so the picture first paints full-screen and settles once the image
// reports its dimensions.
export function monitorImageSizeMm(
  screenWidthMm: number,
  screenHeightMm: number,
  nativeAspect: number | undefined
): { widthMm: number; heightMm: number } {
  if (
    !isPositive(nativeAspect) ||
    screenWidthMm <= 0 ||
    screenHeightMm <= 0
  ) {
    return { widthMm: screenWidthMm, heightMm: screenHeightMm };
  }
  const screenAspect = screenWidthMm / screenHeightMm;
  return nativeAspect > screenAspect
    ? { widthMm: screenWidthMm, heightMm: screenWidthMm / nativeAspect }
    : { widthMm: screenHeightMm * nativeAspect, heightMm: screenHeightMm };
}

// ─── Plan glyph ────────────────────────────────────────────────────────────

export type MonitorPlanGlyph = {
  // The screen's along-wall extent, drawn as a line just inside the FRONT edge
  // (local +y) — the top-down reading of "the glass is on this face". Null when
  // the bezel leaves no screen span, matching monitorScreenRectMm.
  //
  // Deliberately the only mark: the footprint rect the caller already draws is
  // the monitor (and, at the same width and depth, the pedestal under it), and
  // the floor-artwork front-face marker already thickens this same edge. One
  // more inset line is what turns "a box facing this way" into "a screen facing
  // this way" without inventing geometry the object doesn't have.
  screen: { x1Mm: number; x2Mm: number; yMm: number } | null;
};

export function monitorPlanGlyph({
  widthMm,
  depthMm,
  bezelMm = MONITOR_BEZEL_MM
}: {
  widthMm: number;
  depthMm: number;
  bezelMm?: number;
}): MonitorPlanGlyph {
  const halfWidthMm = widthMm / 2;
  const halfDepthMm = depthMm / 2;
  const spanMm = widthMm - bezelMm * 2;
  // The inset also has to fit on the DEPTH axis, or the "just inside the front
  // face" line lands behind the box's own centre and reads as a shelf.
  if (spanMm <= 0 || bezelMm >= halfDepthMm) return { screen: null };
  return {
    screen: {
      x1Mm: -halfWidthMm + bezelMm,
      x2Mm: halfWidthMm - bezelMm,
      yMm: halfDepthMm - bezelMm
    }
  };
}

// ─── Elevation glyph ───────────────────────────────────────────────────────

export type MonitorElevationGlyph = {
  // The black box, at the top of the assembly (local origin).
  monitor: { xMm: number; yMm: number; widthMm: number; heightMm: number };
  // The picture area inside it, already offset into the assembly's local frame
  // (not the face's) so a caller only ever adds the assembly origin. Null when
  // the face is too small for a bezel — the caller then draws the box alone.
  screen: MonitorScreenRectMm | null;
  // The plinth beneath, same footprint width as the monitor. Null when the
  // placement stands on the bare floor.
  pedestal: { xMm: number; yMm: number; widthMm: number; heightMm: number } | null;
  // The assembly's full vertical extent, floor to the top of the monitor. The
  // number an elevation ghost spans and a dimension line measures against.
  totalHeightMm: number;
};

// The front projection of a monitor placement: a box, its screen, and the
// plinth under it. `widthMm` is the projected along-wall extent (which for a
// rotated monitor is wider than its own width — the caller projects, this
// module only ever draws what it is given), `monitorHeightMm` the box's own
// height, `pedestalHeightMm` what monitorPedestalHeightMm resolved.
export function monitorElevationGlyph({
  widthMm,
  monitorHeightMm,
  pedestalHeightMm,
  bezelMm = MONITOR_BEZEL_MM
}: {
  widthMm: number;
  monitorHeightMm: number;
  pedestalHeightMm: number;
  bezelMm?: number;
}): MonitorElevationGlyph {
  const screen = monitorScreenRectMm({
    widthMm,
    heightMm: monitorHeightMm,
    bezelMm
  });
  const hasPedestal = pedestalHeightMm > 0;
  return {
    monitor: { xMm: 0, yMm: 0, widthMm, heightMm: monitorHeightMm },
    screen,
    pedestal: hasPedestal
      ? {
          xMm: 0,
          yMm: monitorHeightMm,
          widthMm,
          heightMm: pedestalHeightMm
        }
      : null,
    totalHeightMm: monitorHeightMm + Math.max(0, pedestalHeightMm)
  };
}
