import { getPlacementFootprintMm } from "../framing";
import {
  PARTITION_NEIGHBOR_MAX_GAP_MM,
  type ElevationScene
} from "../scene2d/elevationScene";
import {
  deriveElevationDimensions,
  type DimensionParticipant,
  type ElevationDimensions,
  type ParticipantKind
} from "./orthogonalNeighbors";

// Thin adapter: an ElevationScene (the same static derivation the canvas paints)
// into the orthogonal-neighbor engine's generic footprint input, then the
// dimension pass. Keeps the engine free of scene2d types so it stays unit-
// testable in isolation (docs/export-spec.md §9.6, §10.1: exports consume the
// same scene primitives the canvas does — no second geometry derivation).
//
// ElevationScene stores each object center-anchored (centerMm) in wall-local
// y-up space. For artworks, sizeMm is the stored IMAGE footprint; the "true
// rendered footprint" §9.6 dimensions between is the mat+frame outer footprint
// (getPlacementFootprintMm — the same expansion the canvas's spacing/barrier
// geometry uses), which grows symmetrically around the same center. Openings
// have no framing; sizeMm is already their rendered footprint. The engine wants
// MIN-corner rects, so we shift each center by half the resolved extent.
//
// Blocked zones: buildElevationScene routes every non-artwork wall object —
// doors, windows AND blocked zones (BlockedZoneWallObject is part of the
// OpeningWallObject union) — through scene.openings, so classifying each
// opening by its object.kind below already covers blocked zones. There is no
// separate blocked-zone channel on ElevationScene today; if one is ever added
// it must be mapped here too so those footprints keep participating (§9.6).
//
// Channels mapped here: artworks, openings (doors/windows/blocked zones) and
// NEARBY partition profiles. The last is the one channel with an admission
// rule of its own — a partition standing further than
// PARTITION_NEIGHBOR_MAX_GAP_MM off the wall still draws as a ghost but does
// not participate in spacing (domain/placement/partitionNeighbors.ts).
// Deliberately NOT mapped: floor-case and suspended-artwork ghosts, which have
// never participated in the document dimension pass.

function centerToMinRect(
  centerXMm: number,
  centerYMm: number,
  widthMm: number,
  heightMm: number
) {
  return {
    xMm: centerXMm - widthMm / 2,
    yMm: centerYMm - heightMm / 2,
    widthMm,
    heightMm
  };
}

export function elevationSceneToDimensionParticipants(
  scene: ElevationScene
): DimensionParticipant[] {
  const participants: DimensionParticipant[] = [];

  for (const artwork of scene.artworks) {
    const footprint = getPlacementFootprintMm(artwork.object, artwork.artwork);
    participants.push({
      id: artwork.object.id,
      kind: "artwork",
      rect: centerToMinRect(
        artwork.centerMm.xMm,
        artwork.centerMm.yMm,
        footprint.widthMm,
        footprint.heightMm
      )
    });
  }

  for (const opening of scene.openings) {
    participants.push({
      id: opening.object.id,
      // door | window | blocked-zone — all valid ParticipantKind values.
      kind: opening.object.kind as ParticipantKind,
      rect: centerToMinRect(
        opening.centerMm.xMm,
        opening.centerMm.yMm,
        opening.sizeMm.widthMm,
        opening.sizeMm.heightMm
      )
    });
  }

  // Partition profiles rise from the floor (y = 0), so they are already
  // min-corner rects — no center shift. Their height is clamped to the wall
  // (the profile's own heightMm is unclamped for drawing) exactly as
  // partitionProfileNeighborShims clamps the canvas-side shims, and the id is
  // the same bare partition wallId, so canvas and document agree on identity.
  for (const profile of scene.partitionProfiles) {
    if (profile.gapMm > PARTITION_NEIGHBOR_MAX_GAP_MM) continue;
    participants.push({
      id: profile.partition.wallId,
      kind: "partition",
      rect: {
        xMm: profile.xMinMm,
        yMm: 0,
        widthMm: profile.xMaxMm - profile.xMinMm,
        heightMm: Math.min(profile.heightMm, scene.wallHeightMm)
      }
    });
  }

  return participants;
}

export function deriveElevationSceneDimensions(scene: ElevationScene): ElevationDimensions {
  return deriveElevationDimensions({
    wallLengthMm: scene.wallLengthMm,
    wallHeightMm: scene.wallHeightMm,
    participants: elevationSceneToDimensionParticipants(scene)
  });
}
