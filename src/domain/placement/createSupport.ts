import type { FloorObject, FloorSupportKind, SupportFloorObject } from "../project";
import { getFloorObjectPlanRect } from "../geometry/planObjects";
import {
  PEDESTAL_FALLBACK_HEIGHT_MM,
  PEDESTAL_MARGIN_MM,
  PEDESTAL_MAX_HEIGHT_MM,
  PEDESTAL_MIN_FOOTPRINT_MM,
  PEDESTAL_MIN_HEIGHT_MM,
  PLINTH_DEFAULT_HEIGHT_MM,
  PLINTH_MARGIN_MM,
  PLINTH_MIN_FOOTPRINT_MM
} from "../geometry/supportGlyphs";
import { MONITOR_PEDESTAL_HEIGHT_MM } from "../geometry/monitorGlyphs";
import { newId } from "../id";

// Factories for floor supports (floor-supports spec §5), modelled on
// createCase.ts beside them: apply the curatorial defaults and NO clamping — an
// out-of-bounds default is validatePlacement's to flag, not this constructor's
// to silently fix.
//
// `heightMm` on a support is its TOP FACE height above the floor, which is the
// number a rider's `baseHeightMm` matches. `wallYMm` is written as 0 and
// `baseHeightMm` is never set: a support never hangs, and there is no
// support↔wall conversion for the remembered hang height to serve.

export function createSupport({
  kind,
  xMm,
  yMm,
  rotationDeg = 0,
  widthMm,
  depthMm,
  heightMm
}: {
  kind: FloorSupportKind;
  xMm: number;
  yMm: number;
  rotationDeg?: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}): SupportFloorObject {
  return {
    id: newId(),
    kind: "support",
    supportKind: kind,
    xMm,
    yMm,
    widthMm,
    depthMm,
    rotationDeg,
    heightMm,
    wallYMm: 0
  };
}

export type DefaultSupportForWorkInput = {
  kind: FloorSupportKind;
  // The WORK's footprint and height — the box standing on the support, not the
  // support itself.
  work: { widthMm: number; depthMm: number; heightMm: number };
  // The project's default centerline (eyeline) datum. Absent — a project that
  // never recorded one — falls back to PEDESTAL_FALLBACK_HEIGHT_MM rather than
  // to 0, which would put the work on the floor and read as a bug.
  project?: { defaultCenterlineHeightMm?: number };
};

export type SupportBoxMm = {
  kind: FloorSupportKind;
  widthMm: number;
  depthMm: number;
  heightMm: number;
};

// The support a curator gets the moment they choose "Put on pedestal" or "Put
// on plinth": sized so the work is already CONTAINED (the overhang-off rule),
// and tall enough that it reads as the gallery object it is.
//
// Size and height only — the caller owns the centre, the angle and the id,
// because "put THIS work on a pedestal" and "drop a pedestal here" want the
// same box at different positions. createSupport turns it into an object.
export function defaultSupportForWork(input: DefaultSupportForWorkInput): SupportBoxMm {
  const { kind, work } = input;

  if (kind === "plinth") {
    return {
      kind: "plinth",
      widthMm: Math.max(work.widthMm + PLINTH_MARGIN_MM * 2, PLINTH_MIN_FOOTPRINT_MM),
      depthMm: Math.max(work.depthMm + PLINTH_MARGIN_MM * 2, PLINTH_MIN_FOOTPRINT_MM),
      heightMm: PLINTH_DEFAULT_HEIGHT_MM
    };
  }

  // "Near eye level" means the work's CENTER lands on the centerline, so the
  // pedestal carries the difference: centerline − half the work's height.
  const centerlineHeightMm = input.project?.defaultCenterlineHeightMm;
  const heightMm =
    centerlineHeightMm === undefined
      ? PEDESTAL_FALLBACK_HEIGHT_MM
      : clamp(
          centerlineHeightMm - work.heightMm / 2,
          PEDESTAL_MIN_HEIGHT_MM,
          PEDESTAL_MAX_HEIGHT_MM
        );

  return {
    kind: "pedestal",
    widthMm: Math.max(work.widthMm + PEDESTAL_MARGIN_MM * 2, PEDESTAL_MIN_FOOTPRINT_MM),
    depthMm: Math.max(work.depthMm + PEDESTAL_MARGIN_MM * 2, PEDESTAL_MIN_FOOTPRINT_MM),
    heightMm
  };
}

// The pedestal a BOX MONITOR gets: footprint locked to the cabinet, 800mm tall,
// centred on the placement at its angle. NOT defaultSupportForWork with a
// monitor flag — a monitor's pedestal is not a curatorial choice with margins,
// it is the plinth the 2026-08-28 USER DECISION settled, and it reproduces
// exactly the geometry the absent `monitorSupport` field used to resolve to.
//
// Floor-supports spec §5: absent-monitorSupport-means-pedestal survives as
// BEHAVIOUR (every path that puts a cabinet on the floor creates this and seats
// the monitor on it) without the field.
export function monitorPedestalForPlacement(placement: {
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
  rotationDeg: number;
}): SupportFloorObject {
  return createSupport({
    kind: "pedestal",
    xMm: placement.xMm,
    yMm: placement.yMm,
    rotationDeg: placement.rotationDeg,
    widthMm: placement.widthMm,
    depthMm: placement.depthMm,
    heightMm: MONITOR_PEDESTAL_HEIGHT_MM
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

// ─── Footprint growth ──────────────────────────────────────────────────────

// The smallest footprint, in the SUPPORT's own rotated frame, that covers every
// rider's footprint plus `marginMm` on each side — never smaller than the
// support already is.
//
// One helper for the three store rules that all say "grow the box until the
// works fit" with a different margin: turning a bonnet on (glass thickness +
// clearance), turning overhang off (no margin — the works must simply be on the
// top face), and "Fit to works" (the kind's curatorial reveal). They differ only
// in that number, so sharing this keeps them from drifting into three slightly
// different ideas of "fits".
//
// GROWTH IS SYMMETRIC ABOUT THE SUPPORT'S CENTRE, because a floor object's
// centre IS its stored position: growing one edge would move the pedestal, and
// a pedestal that walks across the room when a bonnet goes on is a bug the
// curator has to undo. So the required half-extent is the largest |local
// coordinate| over every rider corner, and the width is twice that.
export function supportFootprintCoveringMm(
  support: {
    xMm: number;
    yMm: number;
    widthMm: number;
    depthMm: number;
    rotationDeg: number;
  },
  riders: readonly FloorObject[],
  marginMm: number
): { widthMm: number; depthMm: number } {
  // Nothing to cover: the support keeps the box it has. Returning the margin
  // alone would make an empty pedestal grow by two clearances the moment a
  // bonnet went on it, which is a size nobody asked for.
  if (riders.length === 0) {
    return { widthMm: support.widthMm, depthMm: support.depthMm };
  }

  const angleRad = (support.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  let halfWidthMm = 0;
  let halfDepthMm = 0;
  for (const rider of riders) {
    const rect = getFloorObjectPlanRect(rider);
    const riderRad = (rect.angleDeg * Math.PI) / 180;
    const riderCos = Math.cos(riderRad);
    const riderSin = Math.sin(riderRad);
    const halfW = rect.widthMm / 2;
    const halfD = rect.depthMm / 2;
    for (const [sx, sy] of CORNER_SIGNS) {
      // Corner in world (floor) space, then expressed in the support's frame.
      const worldXMm = rect.centerXMm + sx * halfW * riderCos - sy * halfD * riderSin;
      const worldYMm = rect.centerYMm + sx * halfW * riderSin + sy * halfD * riderCos;
      const dxMm = worldXMm - support.xMm;
      const dyMm = worldYMm - support.yMm;
      const localXMm = dxMm * cos + dyMm * sin;
      const localYMm = -dxMm * sin + dyMm * cos;
      halfWidthMm = Math.max(halfWidthMm, Math.abs(localXMm));
      halfDepthMm = Math.max(halfDepthMm, Math.abs(localYMm));
    }
  }

  return {
    widthMm: Math.max(support.widthMm, (halfWidthMm + marginMm) * 2),
    depthMm: Math.max(support.depthMm, (halfDepthMm + marginMm) * 2)
  };
}

const CORNER_SIGNS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1]
];

// The per-side reveal "Fit to works" leaves around the riders: the same margin
// defaultSupportForWork applies when it sizes a fresh support for one work, so
// fitting an existing box to its works and creating one from scratch agree.
export function supportMarginMm(kind: FloorSupportKind): number {
  return kind === "plinth" ? PLINTH_MARGIN_MM : PEDESTAL_MARGIN_MM;
}

// The kind's default TOP FACE height — the number setSupportKind compares
// against to decide whether a height is still "the default" and may be
// re-applied, or is the curator's and must survive a relabel.
export function defaultSupportHeightMm(kind: FloorSupportKind): number {
  return kind === "plinth" ? PLINTH_DEFAULT_HEIGHT_MM : PEDESTAL_FALLBACK_HEIGHT_MM;
}
