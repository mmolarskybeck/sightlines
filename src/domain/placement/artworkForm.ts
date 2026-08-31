import { WALL_OBJECT_PLAN_DEPTH_MM } from "../geometry/planObjects";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type ArtworkDisplayAs,
  type ArtworkWallObject,
  type Dimensions,
  type WallObject
} from "../project";
import { defaultDisplayAsForCategory, mediumCategory } from "./mediumCategory";

// Explicit placement form overrides the depth-based default.
export type PlacementForm = "wall" | "floor";

// How far apart two mm lengths may sit and still count as "the same size".
// Both sides are curator-entered lengths already rounded to whole millimetres
// by LengthField, so anything under half a millimetre is float dust from a
// unit round-trip, not a difference anyone typed.
//
// Lives here, beside the placement resolvers, because two very different
// consumers must agree on it: the inspector's "Match size to work" hint (which
// appears only once a placement has DIVERGED from the work) and the store's
// dimension-edit rebake (which follows a placement only while it has NOT). One
// tolerance, or a placement could be simultaneously too far from the work to
// rebake and too close to admit it.
export const SIZE_MATCH_TOLERANCE_MM = 0.5;

// Everything effectiveDisplayAs reads. Typed as a shape rather than
// `Pick<Artwork, …>` so callers holding a partial record (a test fixture, a
// scene entry, a bulk-edit row) can ask the question without inventing an id
// and a schemaVersion.
export type DisplayAsSource = {
  displayAs?: ArtworkDisplayAs;
  matWidthMm?: number;
  frame?: Artwork["frame"];
  metadata?: Artwork["metadata"];
};

// The medium string a record carries, if it carries one. Medium is VIRTUAL —
// stored at metadata.medium, the slot the spreadsheet importer writes and every
// export reads — so this is the only correct way to read it.
export function artworkMedium(artwork: DisplayAsSource | undefined): string | undefined {
  const value = artwork?.metadata?.medium;
  return typeof value === "string" ? value : undefined;
}

// How a work is displayed, resolving the AUTO case. PRECEDENCE:
//
//   1. an explicit `displayAs` — the curator answered the Display dropdown, and
//      that answer is final.
//   2. a stored mat or frame ⇒ "framed". THE GUARD: an explicitly framed work
//      must never silently restage itself because its medium string happens to
//      match a category. A curator who typed "Sculpture" into Medium on a work
//      they already matted and framed gets to keep the frame; they can still
//      say "Sculpture" in the dropdown, which is step 1.
//   3. the medium's own default (mediumCategory → defaultDisplayAsForCategory),
//      which is undefined for prose and for an unrecorded medium.
//   4. "framed" — the reading every record had before this field existed.
//
// Note what steps 2–4 have in common: they are DERIVED, and the derivation is
// visible in the dropdown (it shows the resolved value, not "Auto"). Picking
// anything there writes it explicitly and lands on step 1.
export function effectiveDisplayAs(artwork: DisplayAsSource): ArtworkDisplayAs {
  if (artwork.displayAs) return artwork.displayAs;
  if (artwork.matWidthMm !== undefined || artwork.frame !== undefined) return "framed";
  return defaultDisplayAsForCategory(mediumCategory(artworkMedium(artwork))) ?? "framed";
}

// PRECEDENCE, in the order the reads happen below:
//   1. `placementForm` — the curator's own explicit answer, from the Type row.
//      It wins over everything, including a display type: the row exists to say
//      "no, hang this", and a display type must not be able to overrule the one
//      control whose entire job is this question.
//   2. the EFFECTIVE display type, for the three types that state a surface:
//      "monitor" and "sculpture" stand on something (a monitor is equipment on
//      a pedestal or the floor; a sculpture is an object in the room), and
//      "projection" is thrown at a wall. These beat the depth heuristic below
//      because that heuristic is a guess about the work and this is a stated
//      (or medium-derived) fact about how it is displayed.
//   3. an EXPLICIT `displayAs === "framed"` — the curator picked "Wall work" in
//      the dropdown, which pins the work to the wall even when it records a
//      real depth (a deep stretcher, a shadow box).
//   4. the depth heuristic — a recorded depth means it stands up.
//
// STEP 3 IS DELIBERATELY EXPLICIT-ONLY. A merely-DERIVED "framed" (a mat, a
// medium of "Painting", or the bare default) falls through to step 4, so every
// record that predates display types and medium categories resolves exactly as
// it always did: a 450mm-deep painting with no stored displayAs still stands on
// the floor. Widening step 3 to the derived case would silently re-place works
// in existing projects.
//
// (Intent-wins still applies at drop time: dropping a monitor work on a wall
// places it on the wall, as a plain image. This resolves the DEFAULT — what the
// inspector reads back and what an unplaced work is understood to be — not what
// a deliberate gesture is allowed to do. See dropTarget.ts.)
export function effectivePlacementForm(artwork: Artwork): PlacementForm {
  if (artwork.placementForm) return artwork.placementForm;

  const displayAs = effectiveDisplayAs(artwork);
  if (displayAs === "monitor" || displayAs === "sculpture") return "floor";
  if (displayAs === "projection") return "wall";
  if (artwork.displayAs === "framed") return "wall";

  const depthMm = artwork.dimensions.depthMm;
  return typeof depthMm === "number" && depthMm > 0 ? "floor" : "wall";
}

// Missing floor depth falls back to width, then the default footprint depth.
// The width handed in must always be the IMAGE width, never a mat/frame outer
// width: this fallback would otherwise give a depth-less floor work a plan depth
// of image + 2·(mat + frame), putting the frame band on an axis it has no
// physical relationship to. This is why floor geometry is framing-agnostic
// (docs/framing-dimension-contract.md §3, Phase 6b).
export function effectiveFloorDepthMm(dimensions: Dimensions): number {
  const { depthMm, widthMm } = dimensions;
  if (typeof depthMm === "number" && depthMm > 0) return depthMm;
  if (typeof widthMm === "number" && widthMm > 0) return widthMm;
  return DEFAULT_FLOOR_OBJECT_DEPTH_MM;
}

// How far a WALL-placed work physically stands off the wall face — a deep
// canvas on a stretcher, a shadow box, a relief — or undefined when the work is
// flat and every view must draw exactly what it drew before depth existed.
//
// Deliberately the SAME source order as the store's floorDepthForWallArtwork
// (override, then the record) MINUS its DEFAULT_FLOOR_OBJECT_DEPTH_MM tail: a
// hung work with no recorded depth is flat, not 400mm proud of the wall. The two
// must not drift — one is what the work protrudes while hanging, the other what
// its footprint becomes once it stands on the floor, and the override is the
// curator's single answer to "how deep is this thing" in both.
//
// TRAP: undefined and 0 are the SAME answer here (flat), which is why the return
// is `number | undefined` rather than a number with 0 for flat. Consumers key
// the whole deep/flat branch off presence, so "0mm deep" must never reach a
// renderer and produce a degenerate zero-thickness box or a viewer-side offset
// of zero — the same absent-≠-present discipline WallArtwork3d.depthMm relies on.
//
// The `displayDimensionsOverride` read is narrower than it looks and does not
// contradict that field's "geometry never resolves this" note (project.ts): the
// stored placement carries widthMm/heightMm, so those stay the geometry of
// record, but there is no stored depth slot on a wall object at all — the
// override and the library record are the only two places the number can live.
export function effectiveWallArtworkDepthMm(
  wallObject: Pick<ArtworkWallObject, "displayDimensionsOverride">,
  artwork: Pick<Artwork, "dimensions"> | undefined
): number | undefined {
  const depthMm = wallObject.displayDimensionsOverride?.depthMm ?? artwork?.dimensions.depthMm;
  return typeof depthMm === "number" && depthMm > 0 ? depthMm : undefined;
}

// The off-wall depth a wall object's PLAN rect should be drawn (and dragged,
// and snapped) at. One resolver so the plan scene, the live drag preview, the
// group-move members and the keyboard nudge can never disagree about how far a
// thing protrudes — they used to each carry their own `kind === "case"` test,
// and the group paths simply forgot, collapsing a real vitrine to the thin
// nominal band the moment it was dragged as part of a selection.
//
// Cases and deep artwork protrude their real depth; everything else (doors,
// windows, blocked zones, wall text, and flat works) keeps the fixed nominal
// band — those pass THROUGH the wall or lie flat on it and have no protrusion to
// draw (see WALL_OBJECT_PLAN_DEPTH_MM).
//
// `artwork` is consulted only for the artwork kind; callers that already know
// the object is something else may pass undefined.
export function effectiveWallObjectPlanDepthMm(
  object: WallObject,
  artwork: Pick<Artwork, "dimensions"> | undefined
): number {
  if (object.kind === "case") return object.depthMm;
  if (object.kind === "artwork") {
    return effectiveWallArtworkDepthMm(object, artwork) ?? WALL_OBJECT_PLAN_DEPTH_MM;
  }
  return WALL_OBJECT_PLAN_DEPTH_MM;
}
