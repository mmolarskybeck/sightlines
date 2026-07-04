import type { WallObjectBase } from "../project";

export type RectBoundsMm = {
  leftMm: number;
  rightMm: number;
  bottomMm: number;
  topMm: number;
};

// Center-anchored (docs/plan.md §2) to axis-aligned bounds. Shared by any
// wall object shape — artwork and openings alike only need the base fields.
export function getWallObjectBoundsMm(wallObject: WallObjectBase): RectBoundsMm {
  return {
    leftMm: wallObject.xMm - wallObject.widthMm / 2,
    rightMm: wallObject.xMm + wallObject.widthMm / 2,
    bottomMm: wallObject.yMm - wallObject.heightMm / 2,
    topMm: wallObject.yMm + wallObject.heightMm / 2
  };
}

// Strict overlap — two rects that merely touch edges (e.g. a placement
// flush against a blocked zone's boundary) do not count as colliding, the
// same "<"/">" convention validateWallObjectBounds already uses for the
// wall's own edges.
export function doWallObjectsOverlap(a: WallObjectBase, b: WallObjectBase): boolean {
  const boundsA = getWallObjectBoundsMm(a);
  const boundsB = getWallObjectBoundsMm(b);

  return (
    boundsA.leftMm < boundsB.rightMm &&
    boundsA.rightMm > boundsB.leftMm &&
    boundsA.bottomMm < boundsB.topMm &&
    boundsA.topMm > boundsB.bottomMm
  );
}
