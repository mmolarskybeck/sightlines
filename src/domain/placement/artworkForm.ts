import { WALL_OBJECT_PLAN_DEPTH_MM } from "../geometry/planObjects";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type ArtworkWallObject,
  type Dimensions,
  type WallObject
} from "../project";

// Explicit placement form overrides the depth-based default.
export type PlacementForm = "wall" | "floor";

export function effectivePlacementForm(artwork: Artwork): PlacementForm {
  if (artwork.placementForm) return artwork.placementForm;
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
