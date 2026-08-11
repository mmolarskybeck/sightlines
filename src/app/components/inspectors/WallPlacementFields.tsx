import { AlignCenterHorizontalSimpleIcon } from "@phosphor-icons/react/dist/csr/AlignCenterHorizontalSimple";
import type {
  ArtworkWallObject,
  DisplayUnit,
  WallObject,
  WallObjectBase
} from "../../../domain/project";
import {
  centerMemberBetweenBoundaries,
  detectBoundary,
  type BoundaryDetection
} from "../../../domain/placement/arrangeOnWall";
import {
  findPartitionNeighborShim,
  type PartitionNeighborShim
} from "../../../domain/placement/partitionNeighbors";
import { LengthField } from "../shared/LengthField";
import { Button } from "../ui/button";
import { getScopedUnitContext } from "../shared/scopedUnits";

// Label the Center target from its detected boundaries. Exported because the
// multi-selection panel centers a whole GROUP against the same boundary kinds
// and must name the target with the same words.
export const CENTER_BUTTON_LABEL: Record<WallPlacementCenterBoundaryKind, string> = {
  wall: "Center on wall",
  works: "Center between works",
  open: "Center in open space",
  // A partition standing at this wall carves the run into bays; centering
  // between one and whatever bounds the other side is centering IN a bay, and
  // the label has to say so — otherwise the button silently stops meaning
  // "center on the wall" the moment a partition goes up.
  bay: "Center in bay"
};

export function getWallPlacementEdges(
  placement: Pick<ArtworkWallObject, "xMm" | "widthMm">
): { halfWidthMm: number; leftEdgeMm: number; rightEdgeMm: number } {
  const halfWidthMm = placement.widthMm / 2;
  return {
    halfWidthMm,
    leftEdgeMm: placement.xMm - halfWidthMm,
    rightEdgeMm: placement.xMm + halfWidthMm
  };
}

// Numeric counterpart to dragging an artwork along its wall.
export function WallPlacementFields({
  placement,
  wallLengthMm,
  leftNeighborRightEdgeMm,
  rightNeighborLeftEdgeMm,
  leftNeighborIsPartition = false,
  rightNeighborIsPartition = false,
  centerTargetXMm,
  centerBoundaryKind,
  onCommit,
  unit
}: {
  placement: Pick<ArtworkWallObject, "xMm" | "yMm" | "widthMm" | "heightMm">;
  wallLengthMm: number;
  // Inner edge of the nearest artwork to the left; absent hides the field.
  leftNeighborRightEdgeMm?: number;
  // Left edge of the nearest other artwork whose center is right of this work.
  rightNeighborLeftEdgeMm?: number;
  // A partition slab, not a work, is what that side measures to — the field
  // says "edge" instead of "work" so the number is never read as a gap to art.
  leftNeighborIsPartition?: boolean;
  rightNeighborIsPartition?: boolean;
  // Centering treats openings as boundaries; neighbor gap fields do not.
  centerTargetXMm: number;
  centerBoundaryKind: WallPlacementCenterBoundaryKind;
  onCommit: (xMm: number, yMm: number) => void;
  unit: DisplayUnit;
}) {
  const { displayUnit, parseUnit, placeholder, stepMm } = getScopedUnitContext(unit, "openingPosition");

  const { halfWidthMm, leftEdgeMm, rightEdgeMm } = getWallPlacementEdges(placement);

  return (
    <>
      {/* Both fields edit the same horizontal position. */}
      <div className="field-pair-grid">
        <LengthField
          compact
          label="From left edge"
          valueMm={leftEdgeMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={placeholder}
          stepMm={stepMm}
          onCommit={(v) => onCommit(v + halfWidthMm, placement.yMm)}
        />
        <LengthField
          compact
          label="From right edge"
          valueMm={wallLengthMm - rightEdgeMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={placeholder}
          stepMm={stepMm}
          onCommit={(v) => onCommit(wallLengthMm - v - halfWidthMm, placement.yMm)}
        />
      </div>

      {leftNeighborRightEdgeMm !== undefined || rightNeighborLeftEdgeMm !== undefined ? (
        <div
          className={
            leftNeighborRightEdgeMm !== undefined && rightNeighborLeftEdgeMm !== undefined
              ? "field-pair-grid"
              : undefined
          }
        >
          {leftNeighborRightEdgeMm !== undefined ? (
            <LengthField
              compact
              label={leftNeighborIsPartition ? "To edge on left" : "To work on left"}
              valueMm={leftEdgeMm - leftNeighborRightEdgeMm}
              displayUnit={displayUnit}
              parseUnit={parseUnit}
              placeholder={placeholder}
              stepMm={stepMm}
              onCommit={(v) =>
                onCommit(leftNeighborRightEdgeMm + v + halfWidthMm, placement.yMm)
              }
            />
          ) : null}
          {rightNeighborLeftEdgeMm !== undefined ? (
            <LengthField
              compact
              label={rightNeighborIsPartition ? "To edge on right" : "To work on right"}
              valueMm={rightNeighborLeftEdgeMm - rightEdgeMm}
              displayUnit={displayUnit}
              parseUnit={parseUnit}
              placeholder={placeholder}
              stepMm={stepMm}
              onCommit={(v) =>
                onCommit(rightNeighborLeftEdgeMm - v - halfWidthMm, placement.yMm)
              }
            />
          ) : null}
        </div>
      ) : null}

      <Button
        className="inspector-action"
        size="sm"
        variant="inspector"
        onClick={() => onCommit(centerTargetXMm, placement.yMm)}
      >
        <AlignCenterHorizontalSimpleIcon aria-hidden="true" size={15} />
        {CENTER_BUTTON_LABEL[centerBoundaryKind]}
      </Button>

      <LengthField
        compact
        label="Center height"
        valueMm={placement.yMm}
        displayUnit={displayUnit}
        parseUnit={parseUnit}
        placeholder={placeholder}
        stepMm={stepMm}
        onCommit={(v) => onCommit(placement.xMm, v)}
      />
    </>
  );
}

// Find inner edges of the nearest same-wall neighbors on each side by center.
// Projected partitions (`partitionNeighbors`, shims from
// derivePartitionNeighborShimsForFloorWall) join the artwork pool: the edge of a
// slab abutting this wall is exactly the kind of distance a curator types, and
// leaving it out made the field jump to the far side of the partition. Which
// side found a partition is reported back so the label can stop saying "work".
export function getWallPlacementNeighborEdges(
  self: ArtworkWallObject,
  wallObjects: ArtworkWallObject[],
  partitionNeighbors: readonly PartitionNeighborShim[] = []
): {
  leftNeighborRightEdgeMm?: number;
  rightNeighborLeftEdgeMm?: number;
  leftNeighborIsPartition?: boolean;
  rightNeighborIsPartition?: boolean;
} {
  let leftNeighborRightEdgeMm: number | undefined;
  let rightNeighborLeftEdgeMm: number | undefined;
  let leftNeighborIsPartition = false;
  let rightNeighborIsPartition = false;

  // Use centers so a wide, farther work cannot beat a narrower, nearer one.
  let leftBestCenter = -Infinity;
  let rightBestCenter = Infinity;
  const candidates: readonly WallObjectBase[] = [...wallObjects, ...partitionNeighbors];
  for (const other of candidates) {
    if (other.id === self.id) continue;
    if (other.wallId !== self.wallId) continue;
    const isPartition = findPartitionNeighborShim(partitionNeighbors, other.id) !== undefined;

    if (other.xMm < self.xMm && other.xMm > leftBestCenter) {
      leftBestCenter = other.xMm;
      leftNeighborRightEdgeMm = other.xMm + other.widthMm / 2;
      leftNeighborIsPartition = isPartition;
    } else if (other.xMm > self.xMm && other.xMm < rightBestCenter) {
      rightBestCenter = other.xMm;
      rightNeighborLeftEdgeMm = other.xMm - other.widthMm / 2;
      rightNeighborIsPartition = isPartition;
    }
  }

  return {
    leftNeighborRightEdgeMm,
    rightNeighborLeftEdgeMm,
    leftNeighborIsPartition,
    rightNeighborIsPartition
  };
}

// "open" covers doors, windows, and blocked zones without mislabeling them as
// works; "bay" covers the run a projected partition closes off.
export type WallPlacementCenterBoundaryKind = "wall" | "works" | "open" | "bay";

// What the two detected boundaries make the Center button MEAN. Kept apart from
// the geometry below so both callers — the single placement and the
// multi-selection group — resolve the label from one rule instead of two.
// Precedence: a partition ("bay") outranks everything, because it is the
// boundary that changes what "center" means most; then the bare wall; then
// openings ("open space"); otherwise neighbouring works.
export type WallPlacementBoundaryObjectKind = WallObject["kind"] | "wall" | "partition";

export function getWallPlacementCenterBoundaryKind(
  leftKind: WallPlacementBoundaryObjectKind,
  rightKind: WallPlacementBoundaryObjectKind
): WallPlacementCenterBoundaryKind {
  const isOpeningKind = (kind: WallPlacementBoundaryObjectKind) =>
    kind !== "wall" && kind !== "artwork" && kind !== "partition";

  if (leftKind === "partition" || rightKind === "partition") return "bay";
  if (leftKind === "wall" && rightKind === "wall") return "wall";
  if (isOpeningKind(leftKind) || isOpeningKind(rightKind)) return "open";
  return "works";
}

// Center within actual open space, including boundaries created by openings and
// by partitions standing at this wall (`partitionNeighbors`). A partition
// boundary outranks the other kinds in the label: it is the one that changes
// what "center" means most, and it names itself ("Center in bay").
//
// `self` is only ever read as a footprint (id, wall, center, extent), so a
// synthetic group footprint may stand in for a real placement — that is what
// lets the multi-selection panel ask the same question about a whole group.
export function getWallPlacementCenterTarget(
  self: WallObjectBase,
  wallObjects: WallObject[],
  wallLengthMm: number,
  partitionNeighbors: readonly PartitionNeighborShim[] = []
): { xMm: number; boundaryKind: WallPlacementCenterBoundaryKind } {
  const others: WallObjectBase[] = [
    ...wallObjects.filter(
      (wallObject) => wallObject.id !== self.id && wallObject.wallId === self.wallId
    ),
    ...partitionNeighbors
  ];

  const xMm = centerMemberBetweenBoundaries(self, others, wallLengthMm);

  // A partition shim carries no `kind`, so it resolves to its own sentinel
  // rather than falling through to "wall".
  const kindOf = (detection: BoundaryDetection): WallPlacementBoundaryObjectKind => {
    if (detection.type === "wall") return "wall";
    if (findPartitionNeighborShim(partitionNeighbors, detection.objectId)) return "partition";
    const object = wallObjects.find((candidate) => candidate.id === detection.objectId);
    return object?.kind ?? "wall";
  };

  const boundaryKind = getWallPlacementCenterBoundaryKind(
    kindOf(detectBoundary("left", [self], others, wallLengthMm)),
    kindOf(detectBoundary("right", [self], others, wallLengthMm))
  );

  return { xMm, boundaryKind };
}
