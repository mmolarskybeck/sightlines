// Floor-support construction — the single source of truth for the block a
// floor-placed work STANDS ON: a pedestal, a low plinth, and the optional plexi
// bonnet over either. Pure, mm-space, no React/pixel/zoom knowledge, exactly
// like caseGlyphs.ts and monitorGlyphs.ts beside it: plan, elevation, the PDF
// and the 3D mesh all resolve the support here and then apply their own
// coordinate mapping, so the drawing, the print and the model cannot drift.
//
// A support is ATTACHED to the artwork's floor placement (ArtworkFloorObject
// .support), not a floor object of its own: the pair shares one xMm/yMm/
// rotationDeg, so dragging the work in plan moves the assembly for free and no
// view has to keep two objects married. What the curator may adjust is
// HORIZONTAL only — the work's bottom edge is always the support's top face
// (baseHeightMm is ignored under a support, exactly as it is for cases and
// monitors), and only the offset may hang the work over an edge.
//
// Coordinate conventions:
// - Offsets (offsetXMm/offsetYMm) are the SUPPORT's center relative to the
//   WORK's center in the placement's ROTATED LOCAL frame (x along the work's
//   width, y toward its front face), which is the same local frame
//   monitorGlyphs' plan glyph and projectPlanRectOntoWall's corner formula use.
//   The inspector shows the negation ("work position on support") and negates
//   at that one boundary; nothing else in the codebase may.
// - supportPlanRect/assemblyPlanRect return FLOOR-space PlanRects, the same
//   shape getFloorObjectPlanRect returns, so every plan consumer keeps its one
//   rotate() mapping.

import {
  CASE_GLASS_THICKNESS_MM
} from "./caseGlyphs";
import {
  isMonitorArtwork,
  resolveMonitorSupport,
  MONITOR_PEDESTAL_HEIGHT_MM
} from "./monitorGlyphs";
import type { PlanRect } from "./planObjects";
import type { DisplayAsSource } from "../placement/artworkForm";
import type {
  FloorObject,
  FloorObjectBase,
  FloorSupport,
  FloorSupportKind
} from "../project";

// ─── Curatorial defaults ───────────────────────────────────────────────────
//
// First numbers a curator adjusts afterwards, in the same spirit as the
// display-case and monitor defaults: the point is that a support appears at a
// believable gallery size the moment it is switched on, not that these are the
// only legal values.

// Reveal around the work on a pedestal, per side. Smaller than this and the
// pedestal top reads as flush with the work at plan zoom — the pedestal stops
// looking like a pedestal.
export const PEDESTAL_MARGIN_MM = 100;
// The smallest standard gallery pedestal footprint. A tiny object still gets a
// pedestal you could actually build.
export const PEDESTAL_MIN_FOOTPRINT_MM = 300;
// Pedestal height is derived from the project's centerline datum so the work
// lands "near eye level" — the same datum the elevation centerline draws — and
// then clamped to what a pedestal can physically be.
export const PEDESTAL_MIN_HEIGHT_MM = 600;
export const PEDESTAL_MAX_HEIGHT_MM = 1400;
// Used when the caller has no centerline to measure from (a project whose
// default was never set). Mid-range, waist-to-chest.
export const PEDESTAL_FALLBACK_HEIGHT_MM = 1100;

// A plinth is the LOW WIDE member of the pair: a bigger reveal and a bigger
// minimum footprint are the whole distinction, so they are separate constants
// rather than a shared margin with a different height.
export const PLINTH_MARGIN_MM = 150;
export const PLINTH_DEFAULT_HEIGHT_MM = 150;
export const PLINTH_MIN_FOOTPRINT_MM = 600;

// Bonnet (plexi vitrine cover) geometry. Its footprint IS the support's
// (USER DECISION 2026-09-17) — a bonnet is the support's own lid, not a second
// box to size — so only its height and the air inside it are parameters here.
//
// Derived (unlocked) bonnet height = work height + this. Enough headroom to
// read as a cover rather than a lid resting on the work.
export const BONNET_HEADROOM_MM = 75;
// Floor for a LOCKED bonnet height. Below this it is a glass sliver, not a
// cover, and the number is almost certainly a typo.
export const BONNET_MIN_HEIGHT_MM = 150;
// Air between the work's footprint and the glass, per side, on top of the glass
// thickness itself. Reuses CASE_GLASS_THICKNESS_MM so the app has ONE glass
// language: a bonnet and a vitrine lid are the same material.
export const BONNET_CLEARANCE_MM = 25;

// Per-side inset from the support's edge to the largest work footprint a bonnet
// can cover: the glass wall plus its clearance.
function bonnetInsetMm(): number {
  return CASE_GLASS_THICKNESS_MM + BONNET_CLEARANCE_MM;
}

// ─── Resolver ──────────────────────────────────────────────────────────────

// A support that is actually there, with WHY it is there attached. The source
// matters to writers, not to renderers: a "monitor-default" support is the
// 2026-08-28 absent-means-pedestal reading resolved at READ time and has no
// stored object behind it, so an edit to it must first materialise an explicit
// support rather than mutate nothing.
export type ResolvedFloorSupport = FloorSupport & {
  source: "explicit" | "monitor-default";
};

// What this placement stands on, resolved once for every renderer.
//
// An explicit `support` always wins, including on a monitor: a curator who has
// put a CRT on a named plinth has overridden the monitor's own pedestal rule,
// and the plinth is what is installed. Only when there is no explicit support
// does the monitor default apply (absent monitorSupport ⇒ pedestal), reproducing
// exactly the geometry CrtMonitorMesh drew before supports existed: footprint
// locked to the cabinet, 800mm tall.
//
// Non-artwork floor objects (blocked zones, display cases) can never carry a
// support — the field does not exist on them — so they resolve to null rather
// than being refused: the param is typed as the whole union so hit-testing and
// scene builders can call this on any floor object without a kind test.
export function resolveFloorSupport(
  object: FloorObject,
  artwork: DisplayAsSource | undefined
): ResolvedFloorSupport | null {
  if (object.kind !== "artwork") return null;
  if (object.support) return { ...object.support, source: "explicit" };
  if (
    isMonitorArtwork(artwork) &&
    resolveMonitorSupport(object.monitorSupport) === "pedestal"
  ) {
    return {
      kind: "pedestal",
      widthMm: object.widthMm,
      depthMm: object.depthMm,
      heightMm: MONITOR_PEDESTAL_HEIGHT_MM,
      source: "monitor-default"
    };
  }
  return null;
}

// The four mutually exclusive vertical states a floor placement can be in, as
// one value — what the inspector's "Stands on" select reads and writes.
//
// Suspension and a support are exclusive by construction, not by a stored flag:
// a support puts the work's bottom edge on the support's top face and
// baseHeightMm is ignored, so a stale suspension height under a support must
// report as the support, never as a floating work. A monitor never suspends
// either (the same rule the elevation ghost and the inspector already apply),
// so its stale baseHeightMm cannot float it here.
export function resolveStandsOn(
  object: FloorObject,
  artwork: DisplayAsSource | undefined
): "floor" | "pedestal" | "plinth" | "suspended" {
  const support = resolveFloorSupport(object, artwork);
  if (support) return support.kind;
  if ((object.baseHeightMm ?? 0) > 0 && !isMonitorArtwork(artwork)) {
    return "suspended";
  }
  return "floor";
}

// ─── Heights ───────────────────────────────────────────────────────────────

// Floor to the top of the whole assembly. The bonnet may be TALLER than the
// work (the derived height always is) or SHORTER (a locked one the curator
// under-typed), so the top is the max of the two rather than "the work" or
// "the bonnet" — this is the number an elevation ghost spans and a dimension
// line measures against.
export function supportedTotalHeightMm(
  object: Pick<FloorObjectBase, "heightMm">,
  support: FloorSupport
): number {
  return support.heightMm + Math.max(object.heightMm, support.bonnetHeightMm ?? 0);
}

// ─── Plan rects ────────────────────────────────────────────────────────────

type SupportedPlacement = Pick<
  FloorObjectBase,
  "xMm" | "yMm" | "widthMm" | "depthMm" | "rotationDeg"
>;

// Rotates a local-frame offset into floor space using the placement's own
// angle. Character-for-character the corner formula in projectPlanRectOntoWall
// and planRectIntersectsRect, which is the point: the support's local frame IS
// the work's plan frame, so a 45° placement carries its support around with it.
function localOffsetToFloorMm(
  object: SupportedPlacement,
  localXMm: number,
  localYMm: number
): { xMm: number; yMm: number } {
  const angleRad = (object.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    xMm: object.xMm + localXMm * cos - localYMm * sin,
    yMm: object.yMm + localXMm * sin + localYMm * cos
  };
}

// The support box's own floor-space footprint: the placement's center shifted
// by the offset in the rotated local frame, at the support's size and the
// placement's angle.
export function supportPlanRect(
  object: SupportedPlacement,
  support: FloorSupport
): PlanRect {
  const center = localOffsetToFloorMm(
    object,
    support.offsetXMm ?? 0,
    support.offsetYMm ?? 0
  );
  return {
    centerXMm: center.xMm,
    centerYMm: center.yMm,
    widthMm: support.widthMm,
    depthMm: support.depthMm,
    angleDeg: object.rotationDeg
  };
}

// The whole assembly's footprint: the union of the work's rect and the
// support's, taken AXIS-ALIGNED IN THE LOCAL ROTATED FRAME (both boxes share
// the placement's angle, so their union is a rectangle at that same angle —
// a floor-space axis-aligned union would be a strictly larger, wrong box for
// any rotated placement). This is what the selection outline, the rotate
// handle and plan hit-testing use, so grabbing the pedestal grabs the work.
export function assemblyPlanRect(
  object: SupportedPlacement,
  support: FloorSupport
): PlanRect {
  const offsetXMm = support.offsetXMm ?? 0;
  const offsetYMm = support.offsetYMm ?? 0;

  const minXMm = Math.min(-object.widthMm / 2, offsetXMm - support.widthMm / 2);
  const maxXMm = Math.max(object.widthMm / 2, offsetXMm + support.widthMm / 2);
  const minYMm = Math.min(-object.depthMm / 2, offsetYMm - support.depthMm / 2);
  const maxYMm = Math.max(object.depthMm / 2, offsetYMm + support.depthMm / 2);

  const center = localOffsetToFloorMm(
    object,
    (minXMm + maxXMm) / 2,
    (minYMm + maxYMm) / 2
  );
  return {
    centerXMm: center.xMm,
    centerYMm: center.yMm,
    widthMm: maxXMm - minXMm,
    depthMm: maxYMm - minYMm,
    angleDeg: object.rotationDeg
  };
}

// ─── Defaults ──────────────────────────────────────────────────────────────

export type DefaultFloorSupportInput = {
  kind: FloorSupportKind;
  objectWidthMm: number;
  objectDepthMm: number;
  objectHeightMm: number;
  // Whether the work is displayed as a box monitor (isMonitorArtwork). A
  // monitor's pedestal is not a curatorial choice with margins — it is the
  // 800mm cabinet-width plinth the 2026-08-28 USER DECISION settled, and
  // switching a monitor to "Pedestal" must reproduce exactly what the absent
  // monitorSupport already drew, not grow a 100mm reveal around it.
  isMonitor: boolean;
  // The project's default centerline (eyeline) datum. Absent — a project that
  // never recorded one — falls back to PEDESTAL_FALLBACK_HEIGHT_MM rather than
  // to 0, which would put the work on the floor and read as a bug.
  centerlineHeightMm?: number;
};

// The support a curator gets the moment they choose Pedestal or Plinth. Sized
// so the work is already CONTAINED (see normalizeFloorSupport's overhang-off
// rule) — nothing here can produce a support the normaliser would have to grow.
export function defaultFloorSupport(input: DefaultFloorSupportInput): FloorSupport {
  if (input.kind === "pedestal" && input.isMonitor) {
    return {
      kind: "pedestal",
      widthMm: input.objectWidthMm,
      depthMm: input.objectDepthMm,
      heightMm: MONITOR_PEDESTAL_HEIGHT_MM
    };
  }

  if (input.kind === "plinth") {
    return {
      kind: "plinth",
      widthMm: Math.max(
        input.objectWidthMm + PLINTH_MARGIN_MM * 2,
        PLINTH_MIN_FOOTPRINT_MM
      ),
      depthMm: Math.max(
        input.objectDepthMm + PLINTH_MARGIN_MM * 2,
        PLINTH_MIN_FOOTPRINT_MM
      ),
      heightMm: PLINTH_DEFAULT_HEIGHT_MM
    };
  }

  // "Near eye level" means the work's CENTER lands on the centerline, so the
  // pedestal carries the difference: centerline − half the work's height.
  const heightMm =
    input.centerlineHeightMm === undefined
      ? PEDESTAL_FALLBACK_HEIGHT_MM
      : clamp(
          input.centerlineHeightMm - input.objectHeightMm / 2,
          PEDESTAL_MIN_HEIGHT_MM,
          PEDESTAL_MAX_HEIGHT_MM
        );

  return {
    kind: "pedestal",
    widthMm: Math.max(
      input.objectWidthMm + PEDESTAL_MARGIN_MM * 2,
      PEDESTAL_MIN_FOOTPRINT_MM
    ),
    depthMm: Math.max(
      input.objectDepthMm + PEDESTAL_MARGIN_MM * 2,
      PEDESTAL_MIN_FOOTPRINT_MM
    ),
    heightMm
  };
}

// ─── Normaliser ────────────────────────────────────────────────────────────

export type NormalizedFloorSupport = {
  support: FloorSupport;
  // True when the returned support differs from the one passed in — the signal
  // a load report counts and a store write uses to decide whether anything
  // actually moved.
  changed: boolean;
  // How much TALLER the work is than a LOCKED bonnet, or 0 when there is no
  // problem. A locked bonnet is the curator's number and is never grown (USER
  // DECISION 2026-09-17); the inspector warns instead.
  bonnetTooShortByMm: number;
};

type SupportedWork = Pick<FloorObjectBase, "widthMm" | "depthMm" | "heightMm">;

// THE relational invariant for supports. Every store write and the load
// boundary run this; the zod schema stays purely structural, so there is
// exactly one place where "does this support actually hold this work" is
// decided and an imported file, an undo replay and a live edit cannot disagree.
//
// The rules, in the order they interact:
//  1. A bonnet CLEARS overhangAllowed — you cannot hang a work over the edge of
//     a box you have also put glass around. The key is deleted, not set false,
//     so turning the bonnet back off restores "never chosen".
//  2. Footprint: grow the SUPPORT, never shrink the work. Overhang off means
//     the support must contain the work; a bonnet means it must contain the
//     work plus glass and clearance on every side. Overhang on imposes no
//     minimum size at all.
//  3. Offsets are clamped to whatever bound rule 2 leaves. With overhang ON the
//     bound is positive-overlap-minus-1mm: extreme overhang is a legitimate
//     sculptural choice, but a pedestal standing entirely BESIDE its sculpture
//     is not a support, it is two objects.
//  4. Bonnet height is DERIVED from the work while unlocked and re-derived on
//     every pass, so a stale imported number can never survive; locked, it is
//     the curator's, floored at BONNET_MIN_HEIGHT_MM and reported when short.
export function normalizeFloorSupport(
  object: SupportedWork,
  support: FloorSupport
): NormalizedFloorSupport {
  const hasBonnet = support.bonnetHeightMm !== undefined;

  // Rule 1. Absent and explicit-false are otherwise both preserved verbatim:
  // this codebase never normalises between "never chosen" and "chosen off".
  const overhangAllowed = hasBonnet ? undefined : support.overhangAllowed;
  const overhangOn = overhangAllowed === true;

  // Rule 2.
  const marginMm = hasBonnet ? bonnetInsetMm() : 0;
  const minWidthMm = overhangOn ? 0 : object.widthMm + marginMm * 2;
  const minDepthMm = overhangOn ? 0 : object.depthMm + marginMm * 2;
  const widthMm = Math.max(support.widthMm, minWidthMm);
  const depthMm = Math.max(support.depthMm, minDepthMm);

  // Rule 3. Overhang off (and the bonnet's tighter inner box) keeps the work
  // inside the support top; overhang on only demands a positive overlap.
  const boundXMm = overhangOn
    ? Math.max(0, (widthMm + object.widthMm) / 2 - 1)
    : Math.max(0, (widthMm - marginMm * 2 - object.widthMm) / 2);
  const boundYMm = overhangOn
    ? Math.max(0, (depthMm + object.depthMm) / 2 - 1)
    : Math.max(0, (depthMm - marginMm * 2 - object.depthMm) / 2);
  const offsetXMm = clamp(support.offsetXMm ?? 0, -boundXMm, boundXMm);
  const offsetYMm = clamp(support.offsetYMm ?? 0, -boundYMm, boundYMm);

  // Rule 4.
  const locked = hasBonnet && support.bonnetHeightLocked === true;
  const bonnetHeightMm = !hasBonnet
    ? undefined
    : locked
      ? Math.max(BONNET_MIN_HEIGHT_MM, support.bonnetHeightMm as number)
      : object.heightMm + BONNET_HEADROOM_MM;
  const bonnetHeightLocked = hasBonnet ? support.bonnetHeightLocked : undefined;
  const bonnetTooShortByMm =
    locked && bonnetHeightMm !== undefined
      ? Math.max(0, object.heightMm - bonnetHeightMm)
      : 0;

  const next: FloorSupport = {
    kind: support.kind,
    widthMm,
    depthMm,
    heightMm: support.heightMm,
    // A clamped-to-zero offset is written ABSENT, not 0: absence is how this
    // codebase records "not displaced", and a spurious 0 key makes a clean
    // project hash dirty for the cloud backup check.
    ...(offsetXMm !== 0 ? { offsetXMm } : {}),
    ...(offsetYMm !== 0 ? { offsetYMm } : {}),
    ...(overhangAllowed !== undefined ? { overhangAllowed } : {}),
    ...(bonnetHeightMm !== undefined ? { bonnetHeightMm } : {}),
    ...(bonnetHeightLocked !== undefined ? { bonnetHeightLocked } : {})
  };

  return { support: next, changed: !sameSupport(support, next), bonnetTooShortByMm };
}

function sameSupport(a: FloorSupport, b: FloorSupport): boolean {
  return (
    a.kind === b.kind &&
    a.widthMm === b.widthMm &&
    a.depthMm === b.depthMm &&
    a.heightMm === b.heightMm &&
    a.offsetXMm === b.offsetXMm &&
    a.offsetYMm === b.offsetYMm &&
    a.overhangAllowed === b.overhangAllowed &&
    a.bonnetHeightMm === b.bonnetHeightMm &&
    a.bonnetHeightLocked === b.bonnetHeightLocked
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
