import type { WallWithGeometry } from "../geometry/walls";
import type { Project } from "../project";
import {
  findFreeOpeningCenterXMm,
  getDefaultOpeningCenterYMm,
  getDefaultOpeningSizeMm,
  type OpeningKind
} from "./createOpening";
import { isBlockingKind } from "./overlapPolicy";

// "Is this slot on this wall clear of a forbidden opening×opening overlap?"
//
// Pure domain geometry, deliberately NOT in the store: the shared-opening
// analyzer needs the same test, and domain code must never import from
// `src/app`. `src/app/store/openingEdits.ts` re-exports both functions so the
// store-side call sites are unchanged.

// Whether an opening of the given `size` centered at (`xMm`, `centerYMm`) on
// `wall` would sit clear of a forbidden opening×opening overlap
// (overlapPolicy.ts). Reuses the creation-time free-slot search: the preferred x
// is returned unchanged only when it's already free, so an exact-match result
// means "no overlap here." `ignoreOpeningId` excludes an opening being
// moved/resized (its own current slot) from the blockers.
export function isOpeningSlotFree(
  project: Project,
  wall: WallWithGeometry,
  size: { widthMm: number; heightMm: number },
  centerYMm: number,
  xMm: number,
  ignoreOpeningId: string | null
): boolean {
  // The object being tested is always an architectural opening (door, window
  // or blocked-zone), so per getOverlapRule (overlapPolicy.ts) only other
  // blocking-kind objects can forbid its slot — artwork, wall text and cases
  // never do, even when they physically sit in it.
  const sameWallOpenings = project.wallObjects.filter(
    (object) =>
      object.wallId === wall.id &&
      isBlockingKind(object.kind) &&
      object.id !== ignoreOpeningId
  );
  const freeXMm = findFreeOpeningCenterXMm({
    preferredXMm: xMm,
    sizeMm: size,
    centerYMm,
    wallLengthMm: wall.lengthMm,
    sameWallOpenings
  });
  return freeXMm !== null && Math.abs(freeXMm - xMm) < 1;
}
