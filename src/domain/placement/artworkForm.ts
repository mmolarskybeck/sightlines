import { DEFAULT_FLOOR_OBJECT_DEPTH_MM, type Artwork, type Dimensions } from "../project";

// Explicit placement form overrides the depth-based default.
export type PlacementForm = "wall" | "floor";

export function effectivePlacementForm(artwork: Artwork): PlacementForm {
  if (artwork.placementForm) return artwork.placementForm;
  const depthMm = artwork.dimensions.depthMm;
  return typeof depthMm === "number" && depthMm > 0 ? "floor" : "wall";
}

// Missing floor depth falls back to width, then the default footprint depth.
export function effectiveFloorDepthMm(dimensions: Dimensions): number {
  const { depthMm, widthMm } = dimensions;
  if (typeof depthMm === "number" && depthMm > 0) return depthMm;
  if (typeof widthMm === "number" && widthMm > 0) return widthMm;
  return DEFAULT_FLOOR_OBJECT_DEPTH_MM;
}
