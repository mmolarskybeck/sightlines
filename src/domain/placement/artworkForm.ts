import { DEFAULT_FLOOR_OBJECT_DEPTH_MM, type Artwork, type Dimensions } from "../project";

// Whether a work hangs on a wall or sits on the floor. DERIVED WITH OVERRIDE
// (user decision): the artwork's explicit `placementForm` wins when present,
// otherwise it's inferred from whether the work has a real depth. Every
// consumer — placement gating, the inspector toggle, plan/3D floor rendering —
// goes through the two helpers here so the rule lives in exactly one place.
export type PlacementForm = "wall" | "floor";

// The effective form: the curator's explicit override if set, else inferred —
// a work with a real (positive) depth reads as a floor-standing piece, anything
// else as a wall-hung one. Editing depth on a work WITHOUT an override naturally
// flips this; a work WITH an override never flips (the override short-circuits
// the inference before depth is ever consulted).
export function effectivePlacementForm(artwork: Artwork): PlacementForm {
  if (artwork.placementForm) return artwork.placementForm;
  const depthMm = artwork.dimensions.depthMm;
  return typeof depthMm === "number" && depthMm > 0 ? "floor" : "wall";
}

// The depth of a floor work's plan/3D footprint: its real depthMm when known,
// else the WIDTH (a squarish footprint reads far better than a thin sliver for
// a work whose depth was never measured), else the editable default. Shared by
// the store's floor-placement path, plan rendering, and the 3D scene so all
// three agree on the same box.
export function effectiveFloorDepthMm(dimensions: Dimensions): number {
  const { depthMm, widthMm } = dimensions;
  if (typeof depthMm === "number" && depthMm > 0) return depthMm;
  if (typeof widthMm === "number" && widthMm > 0) return widthMm;
  return DEFAULT_FLOOR_OBJECT_DEPTH_MM;
}
