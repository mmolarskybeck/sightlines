import type { DisplayUnit } from "../project";
import { cmToMm, feetToMm, inchesToMm, mToMm } from "./length";

// One shared precision system (docs/plan.md §5.5): the visual grid, grid
// snap targets, and nudge increments should all read from these same
// unit-aware ladders rather than drifting apart. Each rung is a (minor,
// major) PAIR: the minor is the fine dot lattice spacing, the major is a
// round, human-meaningful landmark that's an exact integer multiple
// (~4-12x) of that minor — so "1ft minor" always draws its major at 5ft,
// never at whatever the next zoom bucket happens to be. Imperial gets its
// own ladder because feet/inches are how people think in the gallery, not a
// relabeled metric spacing.
export type GridIntervalPairMm = {
  minorMm: number;
  majorMm: number;
};

// Sorted finest -> coarsest. Selection walks up from the finest pair, so
// this ordering is load-bearing (see getMinorGridIntervalMm).
export const METRIC_GRID_INTERVAL_PAIRS_MM: readonly GridIntervalPairMm[] = [
  { minorMm: cmToMm(0.5), majorMm: cmToMm(5) },
  { minorMm: cmToMm(1), majorMm: cmToMm(10) },
  { minorMm: cmToMm(2), majorMm: cmToMm(20) },
  { minorMm: cmToMm(5), majorMm: cmToMm(50) },
  { minorMm: cmToMm(10), majorMm: mToMm(1) },
  { minorMm: cmToMm(20), majorMm: mToMm(1) },
  { minorMm: cmToMm(50), majorMm: mToMm(5) },
  { minorMm: mToMm(1), majorMm: mToMm(5) }
];

export const IMPERIAL_GRID_INTERVAL_PAIRS_MM: readonly GridIntervalPairMm[] = [
  { minorMm: inchesToMm(0.5), majorMm: inchesToMm(6) },
  { minorMm: inchesToMm(1), majorMm: inchesToMm(6) },
  { minorMm: inchesToMm(3), majorMm: feetToMm(1) },
  { minorMm: inchesToMm(6), majorMm: feetToMm(2) },
  { minorMm: feetToMm(1), majorMm: feetToMm(5) },
  { minorMm: feetToMm(2), majorMm: feetToMm(10) },
  { minorMm: feetToMm(5), majorMm: feetToMm(20) }
];

function getGridIntervalPairsMm(unit: DisplayUnit): readonly GridIntervalPairMm[] {
  return isMetricUnit(unit)
    ? METRIC_GRID_INTERVAL_PAIRS_MM
    : IMPERIAL_GRID_INTERVAL_PAIRS_MM;
}

// Precision-floor choices offered in the UI: a curated subset of each
// family's own ladder minors, not a separate scale. Deliberately skips the
// finest sub-inch/sub-cm minors — offering those as a "floor" would defeat
// the point of a floor — and skips the coarsest multi-foot/multi-meter
// minors, which are grid-only landmarks nobody would pick as a working
// precision. Every value here must be a minor present in the ladder.
const IMPERIAL_PRECISION_FLOOR_OPTIONS_MM: readonly number[] = [
  inchesToMm(0.5),
  inchesToMm(1),
  inchesToMm(6),
  feetToMm(1)
];

const METRIC_PRECISION_FLOOR_OPTIONS_MM: readonly number[] = [
  cmToMm(0.5),
  cmToMm(1),
  cmToMm(10)
];

export function getGridPrecisionFloorOptionsMm(unit: DisplayUnit): readonly number[] {
  return isMetricUnit(unit)
    ? METRIC_PRECISION_FLOOR_OPTIONS_MM
    : IMPERIAL_PRECISION_FLOOR_OPTIONS_MM;
}

// The minor dot lattice is quiet and dense by design (docs/plan.md §5.5), so
// the "still readable" target is small — as long as minor dots stay ~8px
// apart on screen they read as a lattice rather than a smear. This is tuned
// against the imperial ladder's two anchor zooms: a wide plan view
// (pixelsPerMm ~= 0.05) lands on the (1ft, 5ft) pair, and a close elevation
// view (pixelsPerMm ~= 0.13) lands on the (3in, 1ft) pair.
const DEFAULT_TARGET_MINOR_PX = 8;
// Fallback major multiple used only when a minor isn't a ladder rung (i.e.
// a floor-clamped minor that somehow escaped the ladder). Every ladder minor
// already carries its own round major.
const MAJOR_FALLBACK_FACTOR = 5;

function isMetricUnit(unit: DisplayUnit): boolean {
  return unit === "cm" || unit === "m";
}

// The ladder's minor spacings, finest -> coarsest. Kept as the "interval
// table" export name so grid snap targets and useViewPreferences keep
// reading the same shared list of working spacings.
export function getGridIntervalTableMm(unit: DisplayUnit): readonly number[] {
  return getGridIntervalPairsMm(unit).map((pair) => pair.minorMm);
}

export type MinorGridIntervalOptions = {
  targetMinorPx?: number;
  // The user's chosen precision floor (§5.5: "as they zoom in, step
  // downward until hitting the user's chosen precision floor"), in mm.
  // Non-finite or <=0 means no floor — the null/"auto" preference state.
  minIntervalMm?: number | null;
};

// Zoom-adaptive: pick the finest ladder pair whose minor spacing is still at
// least the target pixel spacing on screen, so a wide-open floor plan doesn't
// render thousands of hairline-close minor dots. Falls back to the coarsest
// pair once even its minor would render denser than the target (deeply zoomed
// out), and to the finest pair once pixelsPerMm isn't known yet (initial
// render, before layout measurement).
//
// When a precision floor is set, zooming in further stops shrinking the
// interval once it would go below the floor — the same floor also bounds
// grid snap targets (§5.4), since PlanView derives its snap candidates from
// this same minor interval, so this is the one place that needs to enforce it.
export function getMinorGridIntervalMm(
  unit: DisplayUnit,
  pixelsPerMm: number,
  options: MinorGridIntervalOptions = {}
): number {
  const targetMinorPx = options.targetMinorPx ?? DEFAULT_TARGET_MINOR_PX;
  const minors = getGridIntervalTableMm(unit);

  const zoomMinor = (): number => {
    if (!Number.isFinite(pixelsPerMm) || pixelsPerMm <= 0) {
      return minors[0];
    }

    const targetIntervalMm = targetMinorPx / pixelsPerMm;
    const finestThatFits = minors.find((minor) => minor >= targetIntervalMm);

    return finestThatFits ?? minors[minors.length - 1];
  };

  const minor = zoomMinor();
  const floorMm = options.minIntervalMm;

  if (!Number.isFinite(floorMm) || (floorMm as number) <= 0) {
    return minor;
  }

  if (minor >= (floorMm as number)) {
    return minor;
  }

  // Zoom would otherwise go finer than the floor — clamp up to the finest
  // ladder minor that still respects it, falling back to the coarsest minor
  // if the floor itself is coarser than the whole ladder.
  const finestAtOrAboveFloor = minors.find((candidate) => candidate >= (floorMm as number));
  return finestAtOrAboveFloor ?? minors[minors.length - 1];
}

// The major (readable landmark) line: the round value paired with this minor
// in the ladder, e.g. 1" minor -> 6" major, 1' minor -> 5' major. If the
// minor isn't a ladder rung (only reachable when a precision floor lands off
// the ladder), fall back to a plain 5x multiple so the caller still gets a
// sane landmark.
export function getMajorGridIntervalMm(
  unit: DisplayUnit,
  minorIntervalMm: number
): number {
  const pair = getGridIntervalPairsMm(unit).find(
    (candidate) => candidate.minorMm === minorIntervalMm
  );

  return pair ? pair.majorMm : minorIntervalMm * MAJOR_FALLBACK_FACTOR;
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
