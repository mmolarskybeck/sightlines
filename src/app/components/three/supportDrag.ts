// Floor-support arithmetic for the 3D pointer-drag gesture: pure geometry, no
// three.js, so both halves are unit-testable without a canvas — the same
// split objectDrag.ts and dropTarget.ts already take, and the floor twin of
// what shelfSeating.ts does for a wall shelf's slab.
//
// Two unrelated jobs live here because both are one small pure step inside
// ThreeDView's onMove handler (objectDrag.ts's resolveDragMove calls both):
//   * a dragged SUPPORT carries its riders rigidly (translateSupportRiders);
//   * a dragged floor ARTWORK clamps onto the support it started standing on
//     and/or reports the support it now overlaps (resolveFloorArtworkDragSeat).

import {
  clampRiderOntoSupport,
  seatOnAnyOverlappingSupport,
  type SupportSeatMover
} from "../../../domain/placement/floorRiders";
import type { FloorObject, SupportFloorObject } from "../../../domain/project";

// A support's riders travel by the SAME translation as the support (the
// rigid-assembly rule, floor-supports spec §4): each rider's new absolute
// position is the support's just-resolved centre plus the offset it was
// carrying at gesture start (ThreeDragSource.riders).
export function translateSupportRiders(
  resolvedXMm: number,
  resolvedYMm: number,
  riders: readonly { id: string; offsetMm: { xMm: number; yMm: number } }[]
): { id: string; xMm: number; yMm: number }[] {
  return riders.map((rider) => ({
    id: rider.id,
    xMm: resolvedXMm + rider.offsetMm.xMm,
    yMm: resolvedYMm + rider.offsetMm.yMm
  }));
}

// Where a dragged floor ARTWORK's candidate position ends up once the rider
// clamp (only when it started the gesture standing on a support) and the
// seat lookup (any support its footprint now overlaps, widest-overlap wins)
// have both run. `bypassSeating` is the ⌘/Ctrl precision bypass: held,
// neither the clamp nor the seat lookup apply and the work drags free, exactly
// as the drop already skips grid/neighbour snapping under the same modifier.
export function resolveFloorArtworkDragSeat(args: {
  objectId: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
  rotationDeg: number;
  // The support this artwork was already standing on when the gesture began
  // (resolveFloorStandsOn at drag start) — absent when it started on the bare
  // floor or suspended.
  startingSupportId?: string;
  floorObjects: readonly FloorObject[];
  bypassSeating: boolean;
}): { xMm: number; yMm: number; supportId?: string; baseHeightMm?: number } {
  const { floorObjects, bypassSeating } = args;
  let xMm = args.xMm;
  let yMm = args.yMm;

  if (!bypassSeating && args.startingSupportId) {
    const support = floorObjects.find(
      (object): object is SupportFloorObject =>
        object.kind === "support" && object.id === args.startingSupportId
    );
    if (support) {
      const clamped = clampRiderOntoSupport(
        {
          id: args.objectId,
          centerMm: { xMm, yMm },
          widthMm: args.widthMm,
          depthMm: args.depthMm,
          rotationDeg: args.rotationDeg
        },
        support
      );
      xMm = clamped.xMm;
      yMm = clamped.yMm;
    }
  }

  if (bypassSeating) {
    return { xMm, yMm };
  }

  const mover: SupportSeatMover = {
    id: args.objectId,
    centerMm: { xMm, yMm },
    widthMm: args.widthMm,
    depthMm: args.depthMm,
    rotationDeg: args.rotationDeg
  };
  const seat = seatOnAnyOverlappingSupport(mover, floorObjects);
  return {
    xMm,
    yMm,
    supportId: seat?.supportId,
    baseHeightMm: seat?.baseHeightMm
  };
}
