import type { ShelfWallObject } from "../project";
import {
  DEFAULT_SHELF_DEPTH_MM,
  DEFAULT_SHELF_THICKNESS_MM,
  DEFAULT_SHELF_TOP_MM,
  DEFAULT_SHELF_WIDTH_MM,
  shelfCenterYMmForTop
} from "../geometry/shelfGlyphs";
import { newId } from "../id";

// Factory for a wall shelf, modeled on createCase.ts beside it: apply the
// curatorial defaults and NO clamping — an out-of-bounds default is
// validatePlacement's to flag, not this constructor's to silently fix.
//
// Authored by its TOP, not its centre: "the shelf's top face is at 1200" is the
// number a curator means (it is the surface a work stands on and the number the
// inspector shows), while `yMm` is the slab's centre because WallObjectBase
// says so. shelfCenterYMmForTop is the one conversion between the two.
export function createShelf({
  wallId,
  xMm,
  topMm = DEFAULT_SHELF_TOP_MM,
  widthMm = DEFAULT_SHELF_WIDTH_MM,
  depthMm = DEFAULT_SHELF_DEPTH_MM,
  thicknessMm = DEFAULT_SHELF_THICKNESS_MM
}: {
  wallId: string;
  xMm: number;
  topMm?: number;
  widthMm?: number;
  depthMm?: number;
  thicknessMm?: number;
}): ShelfWallObject {
  return {
    id: newId(),
    kind: "shelf",
    wallId,
    xMm,
    yMm: shelfCenterYMmForTop(topMm, thicknessMm),
    widthMm,
    heightMm: thicknessMm,
    depthMm
  };
}
