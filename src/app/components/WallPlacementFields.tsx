import { AlignCenterHorizontalSimpleIcon } from "@phosphor-icons/react/dist/csr/AlignCenterHorizontalSimple";
import type { ArtworkWallObject, DisplayUnit, WallObject } from "../../domain/project";
import {
  centerMemberBetweenBoundaries,
  detectBoundary,
  type BoundaryDetection
} from "../../domain/placement/arrangeOnWall";
import { LengthField } from "./LengthField";
import { Button } from "./ui/button";
import { getScopedUnitContext } from "./scopedUnits";

// Label the Center target from its detected boundaries.
const CENTER_BUTTON_LABEL: Record<WallPlacementCenterBoundaryKind, string> = {
  wall: "Center on wall",
  works: "Center between works",
  open: "Center in open space"
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
              label="To work on left"
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
              label="To work on right"
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

// Find inner edges of the nearest same-wall artworks on each side by center.
export function getWallPlacementNeighborEdges(
  self: ArtworkWallObject,
  wallObjects: ArtworkWallObject[]
): { leftNeighborRightEdgeMm?: number; rightNeighborLeftEdgeMm?: number } {
  let leftNeighborRightEdgeMm: number | undefined;
  let rightNeighborLeftEdgeMm: number | undefined;

  // Use centers so a wide, farther work cannot beat a narrower, nearer one.
  let leftBestCenter = -Infinity;
  let rightBestCenter = Infinity;
  for (const other of wallObjects) {
    if (other.id === self.id) continue;
    if (other.wallId !== self.wallId) continue;

    if (other.xMm < self.xMm && other.xMm > leftBestCenter) {
      leftBestCenter = other.xMm;
      leftNeighborRightEdgeMm = other.xMm + other.widthMm / 2;
    } else if (other.xMm > self.xMm && other.xMm < rightBestCenter) {
      rightBestCenter = other.xMm;
      rightNeighborLeftEdgeMm = other.xMm - other.widthMm / 2;
    }
  }

  return { leftNeighborRightEdgeMm, rightNeighborLeftEdgeMm };
}

// "open" covers doors, windows, and blocked zones without mislabeling them as works.
export type WallPlacementCenterBoundaryKind = "wall" | "works" | "open";

// Center within actual open space, including boundaries created by openings.
export function getWallPlacementCenterTarget(
  self: ArtworkWallObject,
  wallObjects: WallObject[],
  wallLengthMm: number
): { xMm: number; boundaryKind: WallPlacementCenterBoundaryKind } {
  const others = wallObjects.filter(
    (wallObject) => wallObject.id !== self.id && wallObject.wallId === self.wallId
  );

  const xMm = centerMemberBetweenBoundaries(self, others, wallLengthMm);

  const kindOf = (detection: BoundaryDetection): WallObject["kind"] | "wall" =>
    detection.type === "wall"
      ? "wall"
      : (others.find((object) => object.id === detection.objectId)?.kind ?? "wall");

  const leftKind = kindOf(detectBoundary("left", [self], others, wallLengthMm));
  const rightKind = kindOf(detectBoundary("right", [self], others, wallLengthMm));
  const isOpeningKind = (kind: WallObject["kind"] | "wall") => kind !== "wall" && kind !== "artwork";

  const boundaryKind: WallPlacementCenterBoundaryKind =
    leftKind === "wall" && rightKind === "wall"
      ? "wall"
      : isOpeningKind(leftKind) || isOpeningKind(rightKind)
        ? "open"
        : "works";

  return { xMm, boundaryKind };
}
