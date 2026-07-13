import { DEFAULT_FLOOR_OBJECT_DEPTH_MM, type Artwork, type Dimensions } from "../project";

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
