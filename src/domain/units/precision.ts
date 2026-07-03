import type { DisplayUnit } from "../project";
import { cmToMm, feetToMm, inchesToMm, mToMm } from "./length";

// One shared precision system (docs/plan.md §5.5): the visual grid, grid
// snap targets, and nudge increments should all read from these same
// unit-aware interval tables rather than drifting apart. Metric follows the
// normal 1-2-5 sequence; imperial gets its own table because feet/inches
// are how people think in the gallery, not a relabeled metric spacing.
export const METRIC_GRID_INTERVALS_MM: readonly number[] = [
  cmToMm(0.5),
  cmToMm(1),
  cmToMm(2),
  cmToMm(5),
  cmToMm(10),
  cmToMm(20),
  cmToMm(50),
  mToMm(1),
  mToMm(2)
];

export const IMPERIAL_GRID_INTERVALS_MM: readonly number[] = [
  inchesToMm(0.5),
  inchesToMm(1),
  inchesToMm(2),
  inchesToMm(3),
  inchesToMm(6),
  feetToMm(1),
  feetToMm(2),
  feetToMm(3),
  feetToMm(5),
  feetToMm(10)
];

const DEFAULT_TARGET_MINOR_PX = 32;
const DEFAULT_MAJOR_STEP_FACTOR = 4;

function isMetricUnit(unit: DisplayUnit): boolean {
  return unit === "cm" || unit === "m";
}

export function getGridIntervalTableMm(unit: DisplayUnit): readonly number[] {
  return isMetricUnit(unit) ? METRIC_GRID_INTERVALS_MM : IMPERIAL_GRID_INTERVALS_MM;
}

// Zoom-adaptive: pick the smallest table interval whose on-screen spacing
// is still at least the target pixel spacing, so a wide-open floor plan
// doesn't render thousands of hairline-close minor lines. Falls back to the
// coarsest interval once even the largest table entry would render denser
// than the target (deeply zoomed out), and to the finest interval once
// pixelsPerMm isn't known yet (initial render, before layout measurement).
export function getMinorGridIntervalMm(
  unit: DisplayUnit,
  pixelsPerMm: number,
  targetMinorPx: number = DEFAULT_TARGET_MINOR_PX
): number {
  const table = getGridIntervalTableMm(unit);

  if (!Number.isFinite(pixelsPerMm) || pixelsPerMm <= 0) {
    return table[0];
  }

  const targetIntervalMm = targetMinorPx / pixelsPerMm;
  const smallestThatFits = table.find((interval) => interval >= targetIntervalMm);

  return smallestThatFits ?? table[table.length - 1];
}

// The major (readable landmark) line: the next table entry that's at least
// a few multiples past the minor interval, e.g. 1" minor -> 6" major,
// 2' minor -> 10' major. Falls back to a plain 5x multiple once the minor
// interval is already the coarsest the table offers.
export function getMajorGridIntervalMm(
  unit: DisplayUnit,
  minorIntervalMm: number
): number {
  const table = getGridIntervalTableMm(unit);
  const minorIndex = table.indexOf(minorIntervalMm);
  const searchFrom = minorIndex === -1 ? 0 : minorIndex + 1;
  const landmark = table
    .slice(searchFrom)
    .find((interval) => interval >= minorIntervalMm * DEFAULT_MAJOR_STEP_FACTOR);

  return landmark ?? minorIntervalMm * 5;
}

// Effective on-screen scale for an SVG using the default "xMidYMid meet"
// preserveAspectRatio: the axis that's more constrained sets the scale for
// both, since the drawing is uniformly scaled to fit, never stretched.
export function getPixelsPerMm(
  containerPx: { width: number; height: number },
  viewBoxMm: { width: number; height: number }
): number {
  if (viewBoxMm.width <= 0 || viewBoxMm.height <= 0) return 0;
  if (containerPx.width <= 0 || containerPx.height <= 0) return 0;

  return Math.min(
    containerPx.width / viewBoxMm.width,
    containerPx.height / viewBoxMm.height
  );
}

// SVG `<pattern patternUnits="userSpaceOnUse">` tiles are periodic in
// user-space starting at (0,0), so an arbitrary anchor point (e.g. a wall's
// floor line, which is rarely at y=0) only lands on a tile boundary by
// coincidence. Reducing the anchor mod the tile spacing gives the pattern's
// `x`/`y` attribute the phase offset that puts a line through the anchor
// itself, since shifting by any whole number of tiles is a no-op — this is
// what lets GridOverlay be told "anchor at the floor" instead of always
// counting from the coordinate-space origin.
export function getGridPatternPhaseMm(originMm: number, spacingMm: number): number {
  if (!Number.isFinite(originMm) || !Number.isFinite(spacingMm) || spacingMm <= 0) {
    return 0;
  }

  return ((originMm % spacingMm) + spacingMm) % spacingMm;
}
