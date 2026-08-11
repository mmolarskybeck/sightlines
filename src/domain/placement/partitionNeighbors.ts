import {
  getFloorPartitions,
  parseFaceWallId,
  type FloorPartition
} from "../geometry/freestandingWalls";
import { getFloorWalls } from "../geometry/planObjects";
import type { Point } from "../geometry/polygon";
import type { Floor, WallObjectBase } from "../project";
import {
  buildPartitionProfiles,
  PARTITION_NEIGHBOR_MAX_GAP_MM,
  type ElevationScenePartitionProfile
} from "../scene2d/elevationScene";

// Free-standing partitions as ELEVATION SPACING NEIGHBORS.
//
// A partition standing in front of a wall already draws a profile on that
// wall's elevation (buildElevationScene). This module is the second half of
// that idea: once a partition is close enough to the wall, it is not just a
// drawing but a boundary of the hanging zone — gap dimensions should stop at
// it, centering should treat it as an edge, and a work should be able to snap
// to it. The rule is one threshold, PARTITION_NEIGHBOR_MAX_GAP_MM
// (elevationScene.ts), applied to the profile's perpendicular gapMm.
//
// Everything here is pure plain-data — no store access — so the canvas, the
// PDF page and the export preview can share one answer.

// Which partitions may project onto one wall's elevation at all. TWO gates,
// previously copy-pasted at three call sites (ElevationView's floorGhostInputs,
// createDocumentPdf, ExportPdfPreview):
//  - room ownership: partitions are room-OWNED, so they filter by roomId
//    rather than by the point-in-polygon test the floor objects need — a
//    partition may legally run right along the room boundary, where
//    point-in-polygon is a coin toss;
//  - own face: when the viewed wall is itself a partition FACE, that
//    partition must not project its own thickness onto its own elevation.
// The projection itself (wall extent, viewer side) is buildElevationScene's
// job, not this filter's.
export function selectElevationPartitions(
  partitions: readonly FloorPartition[],
  target: { roomId: string; wallId: string }
): FloorPartition[] {
  const ownFreestandingWallId = parseFaceWallId(target.wallId)?.freestandingWallId;
  return partitions.filter(
    (partition) =>
      partition.roomId === target.roomId &&
      partition.wallId !== ownFreestandingWallId
  );
}

// Projected partition profiles as neighbor "shims": bare WallObjectBase shapes
// (center-anchored xMm/yMm plus extent) that the spacing engines — dimension
// segments, the orthogonal-neighbor corridor pass, snap-target collection —
// already know how to read off an "other". They are NOT wall objects: nothing
// selects, drags or persists them.
//
// The id is the partition's own wallId (bare, NOT a face id): the profile is
// the whole slab seen from this wall, not one of its two faces, and existing
// behavior keys — dimension-line identity in ElevationView — already use it.
//
// Two rules live here:
//  - only profiles within PARTITION_NEIGHBOR_MAX_GAP_MM of the wall become
//    shims; a partition further out in the room still DRAWS as a ghost but
//    stops bounding measurements;
//  - the shim's height is clamped to the wall (profile.heightMm is
//    deliberately unclamped so the drawing can show a slab taller than the
//    wall it stands in front of, but a spacing participant that overshoots
//    the wall would distort every corridor it takes part in).
//
// The two extra fields are what makes a shim recognisable AFTER it has flowed
// through a spacing engine: detectBoundary reports only an `objectId`, and the
// UI has to be able to say "this boundary is a partition edge" (the "Center in
// bay" button label, the arrange readout's neighbour noun) without a reverse
// lookup into the floor. Structural typing keeps them invisible to every engine
// that only reads the WallObjectBase fields.
export type PartitionNeighborShim = WallObjectBase & {
  partitionNeighbor: true;
  // The partition's display name ("Partition 1"), for readouts.
  partitionName: string;
};

// Given a boundary/neighbor objectId reported by a spacing engine, the shim it
// came from — or undefined when the id is a real wall object. Keeps the "shim
// id === partition wallId" convention in one place.
export function findPartitionNeighborShim(
  shims: readonly PartitionNeighborShim[],
  objectId: string | undefined
): PartitionNeighborShim | undefined {
  if (objectId === undefined) return undefined;
  return shims.find((shim) => shim.id === objectId);
}

// The canvas "Ghosts" toggle, as a rule rather than an inline filter. Hiding
// ghosts hides the DASHED tier only: an abutting slab is architecture standing
// against this wall, not a projection, so it survives in every state. Extracted
// here (rather than left inline in ElevationView) because the toggle decides
// more than what is painted — the surviving profiles are exactly the ones that
// bound a dimension line and capture a drag, and a ghost the curator has
// switched off must not silently do either.
export function selectVisiblePartitionProfiles(
  profiles: readonly ElevationScenePartitionProfile[],
  ghostsVisible: boolean
): ElevationScenePartitionProfile[] {
  return ghostsVisible ? [...profiles] : profiles.filter((profile) => profile.abutting);
}

export function partitionProfileNeighborShims(
  profiles: readonly ElevationScenePartitionProfile[],
  wallHeightMm: number,
  wallId = ""
): PartitionNeighborShim[] {
  const shims: PartitionNeighborShim[] = [];
  for (const profile of profiles) {
    if (profile.gapMm > PARTITION_NEIGHBOR_MAX_GAP_MM) continue;
    const heightMm = Math.min(profile.heightMm, wallHeightMm);
    shims.push({
      id: profile.partition.wallId,
      wallId,
      xMm: (profile.xMinMm + profile.xMaxMm) / 2,
      yMm: heightMm / 2,
      widthMm: profile.xMaxMm - profile.xMinMm,
      heightMm,
      partitionNeighbor: true,
      partitionName: profile.partition.name
    });
  }
  return shims;
}

export type PartitionNeighborWallInput = {
  // The viewed wall (a perimeter wall id, or a partition face id — the own-face
  // gate reads it).
  wallId: string;
  // The room the viewed wall bounds; partitions gate on this.
  roomId: string;
  wallHeightMm: number;
  // Floor-space endpoints of the viewed wall, as getFloorWalls yields them
  // (room geometry lifted by the placement offset).
  wallStartFloorMm: Point;
  wallEndFloorMm: Point;
  // Every partition on the floor (getFloorPartitions) — UNFILTERED; both gates
  // are applied here so a caller can never apply just one of them.
  partitions: readonly FloorPartition[];
};

// Project state + a wall -> its partition neighbor shims, without building a
// whole ElevationScene. The path in one call: room/own-face gates, plan-slab
// projection onto the wall, the 1200 mm proximity rule, shim conversion. For
// callers that DO have a scene, partitionProfileNeighborShims(scene.
// partitionProfiles, scene.wallHeightMm) is the same answer for free.
export function derivePartitionNeighborShimsForWall(
  input: PartitionNeighborWallInput
): PartitionNeighborShim[] {
  const partitions = selectElevationPartitions(input.partitions, {
    roomId: input.roomId,
    wallId: input.wallId
  });
  const profiles = buildPartitionProfiles(
    partitions,
    input.wallStartFloorMm,
    input.wallEndFloorMm
  );
  return partitionProfileNeighborShims(profiles, input.wallHeightMm, input.wallId);
}

// The same answer from nothing but project state: a Floor and a wall id. This is
// the entry point for every caller OUTSIDE the elevation canvas (the inspector's
// Center button and neighbor-distance fields, arrange sessions, the arrange
// readout) — none of them holds wall endpoints or a room, and all of them would
// otherwise re-derive the room gate by hand. Works for a partition FACE id too:
// getFloorWalls yields faces, and a face carries its owning roomId, so the
// own-face exclusion inside derivePartitionNeighborShimsForWall still fires.
// An unknown wall id yields no shims rather than throwing.
//
// NOTE: this path has no visibility gate — the "Ghosts" toggle is a canvas
// affordance, and an explicit action (centering, arranging, a numeric readout)
// must give the same answer whether or not ghosts are painted.
export function derivePartitionNeighborShimsForFloorWall(
  floor: Floor,
  wallId: string
): PartitionNeighborShim[] {
  const floorWall = getFloorWalls(floor).find((wall) => wall.id === wallId);
  if (!floorWall) return [];
  return derivePartitionNeighborShimsForWall({
    wallId,
    roomId: floorWall.roomId,
    wallHeightMm: floorWall.heightMm,
    wallStartFloorMm: floorWall.startFloorMm,
    wallEndFloorMm: floorWall.endFloorMm,
    partitions: getFloorPartitions(floor)
  });
}
