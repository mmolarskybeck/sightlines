import type { Vector2 } from "./dragResize";
import {
  DEFAULT_FREESTANDING_THICKNESS_MM,
  roomIdContainingPoint
} from "./freestandingWalls";
import {
  getPartitionDimensionChains,
  type ChainSegment,
  type PartitionDimensionChains
} from "./partitionSpacing";
import type { Point } from "./polygon";
import type { FreestandingWall, Project } from "../project";

export function midpointOf(a: Point, b: Point): Point {
  return { xMm: (a.xMm + b.xMm) / 2, yMm: (a.yMm + b.yMm) / 2 };
}

function liftPartitionChains(
  chains: PartitionDimensionChains,
  offset: Vector2
): PartitionDimensionChains {
  const liftSegment = (segment: ChainSegment): ChainSegment => ({
    ...segment,
    aMm: { xMm: segment.aMm.xMm + offset.xMm, yMm: segment.aMm.yMm + offset.yMm },
    bMm: { xMm: segment.bMm.xMm + offset.xMm, yMm: segment.bMm.yMm + offset.yMm }
  });
  return {
    normal: chains.normal.map(liftSegment),
    span: chains.span.map(liftSegment)
  };
}

// Build complete gap/solid chains in room-local space, then lift them once
// for the plan overlay. A valid draw preview participates too, so its live
// feedback uses the exact geometry that will be committed.
export function computePartitionChainsFloor(args: {
  project: Project;
  partitionDraw: { startMm: Point; endMm: Point | null; invalid: boolean } | null;
  partitionDuplicateGhost: { startMm: Point; endMm: Point; invalid: boolean } | null;
  duplicatePartitionSourceWallId: string | null;
  partitionDrag: {
    wallId: string;
    previewStartFloorMm: Point;
    previewEndFloorMm: Point;
  } | null;
  selectedFreestandingWallId: string | null;
}): { chains: PartitionDimensionChains; partition: FreestandingWall } | null {
  const {
    project,
    partitionDraw,
    partitionDuplicateGhost,
    duplicatePartitionSourceWallId,
    partitionDrag,
    selectedFreestandingWallId
  } = args;
  const rooms = project.floor.rooms;

  // Resolves the room a not-yet-committed partition segment sits in (by its
  // midpoint) and hand-builds the synthetic FreestandingWall the chain
  // functions need — shared by the draw preview and the duplicate-ghost
  // preview below, the two cases where there's no committed wall yet to read
  // a room id off of. `overrides` carries fields a caller wants copied from a
  // source wall instead of defaulted off the destination room.
  function previewPartitionChains(
    startFloorMm: Point,
    endFloorMm: Point,
    thicknessMm: number,
    id: string,
    overrides: Partial<Pick<FreestandingWall, "heightMm" | "defaultCenterlineHeightMm">> = {}
  ): { chains: PartitionDimensionChains; partition: FreestandingWall } | null {
    const roomId = roomIdContainingPoint(project, midpointOf(startFloorMm, endFloorMm));
    const placement = roomId ? rooms.find((candidate) => candidate.roomId === roomId) ?? null : null;
    if (!placement) return null;
    const offset = { xMm: placement.offsetXMm, yMm: placement.offsetYMm };
    const partition: FreestandingWall = {
      id,
      roomId: placement.roomId,
      name: "Partition preview",
      startXMm: startFloorMm.xMm - offset.xMm,
      startYMm: startFloorMm.yMm - offset.yMm,
      endXMm: endFloorMm.xMm - offset.xMm,
      endYMm: endFloorMm.yMm - offset.yMm,
      thicknessMm,
      heightMm: overrides.heightMm ?? placement.room.heightMm,
      ...(overrides.defaultCenterlineHeightMm !== undefined
        ? { defaultCenterlineHeightMm: overrides.defaultCenterlineHeightMm }
        : {})
    };
    return {
      chains: liftPartitionChains(getPartitionDimensionChains(placement.room, partition), offset),
      partition
    };
  }

  if (partitionDraw?.endMm && !partitionDraw.invalid) {
    const result = previewPartitionChains(
      partitionDraw.startMm,
      partitionDraw.endMm,
      DEFAULT_FREESTANDING_THICKNESS_MM,
      "partition-draw-preview"
    );
    if (result) return result;
  }

  if (partitionDuplicateGhost && !partitionDuplicateGhost.invalid) {
    const source = rooms
      .flatMap((candidate) => candidate.room.freestandingWalls)
      .find((wall) => wall.id === duplicatePartitionSourceWallId);
    if (source) {
      const result = previewPartitionChains(
        partitionDuplicateGhost.startMm,
        partitionDuplicateGhost.endMm,
        source.thicknessMm,
        "partition-duplicate-preview",
        { heightMm: source.heightMm, defaultCenterlineHeightMm: source.defaultCenterlineHeightMm }
      );
      if (result) return result;
    }
  }

  // The selected/dragged case keeps its room fixed to the committed wall's
  // own placement rather than re-resolving by midpoint — an in-flight drag
  // can pass outside the room polygon mid-gesture (near a boundary), and the
  // dimension chain should keep reading against the room it actually belongs
  // to, not flicker off when that happens.
  const activeWallId = partitionDrag?.wallId ?? selectedFreestandingWallId;
  if (!activeWallId) return null;

  const placement = rooms.find((candidate) =>
    candidate.room.freestandingWalls.some((wall) => wall.id === activeWallId)
  );
  const committed = placement?.room.freestandingWalls.find((wall) => wall.id === activeWallId);
  if (!placement || !committed) return null;

  const offset = { xMm: placement.offsetXMm, yMm: placement.offsetYMm };
  const partition =
    partitionDrag && partitionDrag.wallId === activeWallId
      ? {
          ...committed,
          startXMm: partitionDrag.previewStartFloorMm.xMm - offset.xMm,
          startYMm: partitionDrag.previewStartFloorMm.yMm - offset.yMm,
          endXMm: partitionDrag.previewEndFloorMm.xMm - offset.xMm,
          endYMm: partitionDrag.previewEndFloorMm.yMm - offset.yMm
        }
      : committed;

  return {
    chains: liftPartitionChains(getPartitionDimensionChains(placement.room, partition), offset),
    partition
  };
}
