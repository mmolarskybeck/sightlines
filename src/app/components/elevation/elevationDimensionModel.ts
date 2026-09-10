import {
  getNeighborAwareSegments,
  getSpacingSegments
} from "../../../domain/placement/arrangeOnWall";
import {
  deriveVerticalNeighborGaps,
  type DimensionParticipant
} from "../../../domain/dimensions/orthogonalNeighbors";
import type { Artwork, WallObject, WallObjectBase } from "../../../domain/project";
import type { buildElevationScene } from "../../../domain/scene2d/elevationScene";
import { getElevationFootprintObjects } from "./elevationArtworkGeometry";

type ElevationScene = ReturnType<typeof buildElevationScene>;

/**
 * Inputs for the elevation dimension-line derivations. Every field is a value
 * ElevationView already has in hand at the point it calls this — extracted
 * verbatim so the canvas keeps deriving its lines exactly as before.
 */
export type ElevationDimensionModelInput = {
  selectedObjectIds: string[];
  selectedMembersOnThisWall: WallObject[];
  selectionAllOnThisWall: boolean;
  // Layers the in-flight move-drag preview onto a wall object (identity when
  // nothing is dragging).
  applyDragPreview: (wallObject: WallObjectBase) => WallObjectBase;
  artworksById?: Map<string, Artwork>;
  wallObjectsOnThisWall: WallObject[];
  visibleFloorCaseGhosts: ElevationScene["floorCaseGhosts"];
  visibleSuspendedArtworkGhosts: ElevationScene["suspendedArtworkGhosts"];
  visibleMonitorGhosts: ElevationScene["monitorGhosts"];
  partitionNeighborShims: WallObjectBase[];
  wallId?: string;
  wallLengthMm: number;
  arrangeSessionMode: "equal" | "inset" | "gap" | null;
};

export type ElevationDimensionModel = {
  isDimensionLinesEligible: boolean;
  effectiveDimensionMembers: WallObjectBase[];
  dimensionSegments: ReturnType<typeof getSpacingSegments>;
  verticalGapDimensions: ReturnType<typeof deriveVerticalNeighborGaps>;
};

export function buildElevationDimensionModel({
  selectedObjectIds,
  selectedMembersOnThisWall,
  selectionAllOnThisWall,
  applyDragPreview,
  artworksById,
  wallObjectsOnThisWall,
  visibleFloorCaseGhosts,
  visibleSuspendedArtworkGhosts,
  visibleMonitorGhosts,
  partitionNeighborShims,
  wallId,
  wallLengthMm,
  arrangeSessionMode
}: ElevationDimensionModelInput): ElevationDimensionModel {
  // The dimension lines describe what ARRANGE affects. For a multi-selection
  // that's the ARTWORK members only (openings are architecture — arrange never
  // moves them, so they don't get gap lines). A single selection of ANY kind
  // gets its own outer margins (useful to read a lone door/window/work's space
  // on the wall too). "others" for the neighbour-aware outer segments is every
  // effective wall object on this wall that isn't a dimension member.
  const dimensionMemberSource =
    selectedObjectIds.length === 1
      ? selectedMembersOnThisWall
      : selectedMembersOnThisWall.filter((wallObject) => wallObject.kind === "artwork");
  const isDimensionLinesEligible =
    dimensionMemberSource.length >= 1 && selectionAllOnThisWall;
  const effectiveDimensionMembers: WallObjectBase[] = getElevationFootprintObjects(
    dimensionMemberSource.map((wallObject) => applyDragPreview(wallObject) as WallObject),
    artworksById
  );
  const dimensionMemberIds = new Set(dimensionMemberSource.map((wallObject) => wallObject.id));
  const dimensionOthers: WallObject[] = wallObjectsOnThisWall
    .filter((wallObject) => !dimensionMemberIds.has(wallObject.id))
    .map((wallObject) => applyDragPreview(wallObject) as WallObject);
  // Projected floor-object ghosts (freestanding cases, suspended artwork) are
  // alignment aids projected onto this wall — never selectable, never
  // dimension MEMBERS (they aren't wall objects at all) — but a gap line
  // should still stop at one exactly like it would at a real neighbor, so a
  // hung work reads as "close to the case below it" rather than "open to the
  // wall". Synthesized as bare WallObjectBase shapes (no `kind`, since
  // getNeighborAwareSegments/deriveVerticalNeighborGaps below only ever read
  // xMm/yMm/widthMm/heightMm off an "other").
  const dimensionOtherGhosts: WallObjectBase[] = [
    ...visibleFloorCaseGhosts.map((ghost) => ({
      id: ghost.object.id,
      wallId: wallId ?? "",
      xMm: (ghost.xMinMm + ghost.xMaxMm) / 2,
      yMm: ghost.heightMm / 2,
      widthMm: ghost.xMaxMm - ghost.xMinMm,
      heightMm: ghost.heightMm
    })),
    // Suspended boards join the same pool for the same reason — but their
    // center is baseHeightMm ABOVE the floor, not heightMm/2 off it. Getting
    // that wrong would silently drop a vertical gap line onto the floor.
    ...visibleSuspendedArtworkGhosts.map((ghost) => ({
      id: ghost.object.id,
      wallId: wallId ?? "",
      xMm: (ghost.xMinMm + ghost.xMaxMm) / 2,
      yMm: ghost.baseHeightMm + ghost.heightMm / 2,
      widthMm: ghost.xMaxMm - ghost.xMinMm,
      heightMm: ghost.heightMm
    })),
    // A monitor bounds a gap line for the floor case's exact reason — it is
    // waist-to-eye-height equipment a curator hangs work above and beside. Its
    // extent is the WHOLE assembly (pedestal + cabinet), standing on the floor,
    // because that is the volume a dimension has to stop at.
    ...visibleMonitorGhosts.map((ghost) => {
      const totalHeightMm = ghost.pedestalHeightMm + ghost.monitorHeightMm;
      return {
        id: ghost.object.id,
        wallId: wallId ?? "",
        xMm: (ghost.xMinMm + ghost.xMaxMm) / 2,
        yMm: totalHeightMm / 2,
        widthMm: ghost.xMaxMm - ghost.xMinMm,
        heightMm: totalHeightMm
      };
    }),
    // Projected partitions bound a gap line for exactly the same reason — more
    // strongly, in fact, for an abutting one: the hanging zone it creates ENDS
    // at the slab, and a dimension running past it would describe wall the
    // curator can't use. Both tiers participate while ghosts are shown; with
    // ghosts hidden only the abutting tier survives (see visiblePartitionProfiles).
    // partitionProfileNeighborShims adds the proximity rule on top: a partition
    // standing more than PARTITION_NEIGHBOR_MAX_GAP_MM out in the room still
    // ghosts, but is too far off the wall to bound a measurement on it.
    ...partitionNeighborShims
  ];
  const effectiveDimensionOthers: WallObjectBase[] = [
    ...getElevationFootprintObjects(dimensionOthers, artworksById),
    ...dimensionOtherGhosts
  ];
  // Idle, or an active "From edges"/"Between works" session → neighbour-aware
  // (stop at the nearest window/door/work — "From edges" measures to that same
  // detected boundary, and "Between works" re-spaces about a fixed centre so
  // its outer edges close on the neighbours; either way the lines should show
  // the space actually beside the works, per-side falling back to the wall
  // edge when nothing is there — see getNeighborAwareSegments). Only an active
  // "Space evenly" session → wall-edge segments, matching that mode's still
  // wall-only Calculated readout (it solves the whole-wall/open-zone spread).
  const dimensionSegments =
    arrangeSessionMode === "equal"
      ? getSpacingSegments(effectiveDimensionMembers, wallLengthMm)
      : getNeighborAwareSegments(
          effectiveDimensionMembers,
          effectiveDimensionOthers,
          wallLengthMm
        );
  // Vertical spacing for stacked works — the same §9.6 corridor engine the
  // document PDF uses. Every wall object participates (an unselected neighbor
  // above/below still bounds and blocks, exactly like the horizontal
  // neighbour-aware segments), then only gaps touching a dimension member
  // render, keeping the display selection-driven. `kind` is irrelevant to the
  // vertical pass (it only drives boundary margins and center heights, which
  // this caller never derives), so all participants pass as "artwork".
  const verticalGapDimensions = isDimensionLinesEligible
    ? deriveVerticalNeighborGaps(
        [...effectiveDimensionMembers, ...effectiveDimensionOthers].map(
          (wallObject): DimensionParticipant => ({
            id: wallObject.id,
            kind: "artwork",
            rect: {
              xMm: wallObject.xMm - wallObject.widthMm / 2,
              yMm: wallObject.yMm - wallObject.heightMm / 2,
              widthMm: wallObject.widthMm,
              heightMm: wallObject.heightMm
            }
          })
        )
      ).filter(
        (gap) => dimensionMemberIds.has(gap.aId) || dimensionMemberIds.has(gap.bId)
      )
    : [];

  return {
    isDimensionLinesEligible,
    effectiveDimensionMembers,
    dimensionSegments,
    verticalGapDimensions
  };
}
