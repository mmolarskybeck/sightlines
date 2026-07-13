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

// The "Center" button's phrasing, keyed by what getWallPlacementCenterTarget
// found on the two detected boundaries — the button never says "works" when
// a boundary is actually a door/window/blocked zone (see that function's
// comment for the exact classification rule).
const CENTER_BUTTON_LABEL: Record<WallPlacementCenterBoundaryKind, string> = {
  wall: "Center on wall",
  works: "Center between works",
  open: "Center in open space"
};

// Props-driven "Position on wall" editor for a single wall-placed artwork —
// the numeric twin of dragging the work along its wall in the elevation view.
// Everything arrives as props (App derives the wall length, wall name, the
// nearest-neighbour edges, and the Center button's target from the store), so
// this stays purely presentational in the same spirit as FloorPlacementFields
// / ArtworkInspector.
//
// The curator's physical framing throughout: a work sits some distance from
// each wall edge, and (when it has neighbours) some gap from the work beside
// it — never "x"/"margin"/"inset". "From left edge" and "From right edge" are
// two views of one horizontal position: both are always live, and committing
// either moves the work, so on the next render the other reflects the move.
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
  // Right edge of the nearest other artwork whose CENTER is left of this work
  // (undefined when there is none) — the "To work on left" field is hidden
  // entirely rather than disabled when absent.
  leftNeighborRightEdgeMm?: number;
  // Left edge of the nearest other artwork whose center is right of this work.
  rightNeighborLeftEdgeMm?: number;
  // Where the Center button sends the work — see getWallPlacementCenterTarget.
  // Unlike leftNeighborRightEdgeMm/rightNeighborLeftEdgeMm above (artworks
  // only), the detection behind this counts every wall object beside the
  // work, openings included, matching the arrange panel's own boundary rule.
  centerTargetXMm: number;
  centerBoundaryKind: WallPlacementCenterBoundaryKind;
  // Every commit is a direct move (one undo entry), same as the other
  // inspector fields — App wires this to moveArtworkPlacement.
  onCommit: (xMm: number, yMm: number) => void;
  unit: DisplayUnit;
}) {
  // A hang distance along the wall is the same natural unit as an opening's X
  // position (docs/plan.md's openingPosition scope) — it's an offset along the
  // wall, matching the arrange panel's inset/gap fields.
  const { displayUnit, parseUnit, placeholder, stepMm } = getScopedUnitContext(unit, "openingPosition");

  const halfWidthMm = placement.widthMm / 2;
  const leftEdgeMm = placement.xMm - halfWidthMm;
  const rightEdgeMm = placement.xMm + halfWidthMm;

  // Bare fields, no wrapper or heading — the caller supplies the section
  // chrome (ArtworkInspector wraps these in an InspectorSection whose title
  // App builds from the wall name, e.g. "Position on North wall").
  return (
    <>
      {/* The two edge distances are symmetric views of ONE position, so they
          share a row — the pairing says "move either, the other follows"
          better than a stack of two full-width fields ever did. */}
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

      {/* Neighbour gaps pair up when both sides have a work; a lone gap keeps
          the full width rather than sitting beside an empty cell. */}
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

      {/* Horizontal-only, so it sits with the horizontal fields above rather
          than after "Center height" below. Always enabled: there is always a
          wall (worst case, its edges) to center against. */}
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

// The nearest same-wall artwork neighbours on each side of a work, by CENTER
// position — only artwork-kind wall objects count ("works"); openings and
// blocked zones are not works. Returns each neighbour's INNER edge (the right
// edge of the left neighbour, the left edge of the right neighbour), the values
// the edge-to-edge gap fields measure against. `undefined` on a side means no
// neighbour there, which hides that field entirely.
export function getWallPlacementNeighborEdges(
  self: ArtworkWallObject,
  wallObjects: ArtworkWallObject[]
): { leftNeighborRightEdgeMm?: number; rightNeighborLeftEdgeMm?: number } {
  let leftNeighborRightEdgeMm: number | undefined;
  let rightNeighborLeftEdgeMm: number | undefined;

  // "Nearest" is decided by CENTER (not edge) so a wide far work can never beat
  // a narrow near one — leftBestCenter is the largest center still left of this
  // work, rightBestCenter the smallest center still right of it.
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

// What the Center button's label should call the thing it's centering
// against: "wall" when neither detected boundary is an object, "works" when
// every object boundary is an artwork (so "between works" is literally true),
// "open" once EITHER boundary is a door/window/blocked zone — "works" would
// misname that side, and the arrange panel has no single-object noun that
// reads well in a two-word button, so "open space" covers every non-wall,
// non-artwork case uniformly.
export type WallPlacementCenterBoundaryKind = "wall" | "works" | "open";

// The Center button's target (see centerMemberBetweenBoundaries) plus the
// classification CENTER_BUTTON_LABEL turns into copy. Deliberately NOT
// getWallPlacementNeighborEdges' `others` (artworks only): centering treats
// every same-wall object as something to center beside, doors and windows
// included, matching detectBoundary/the arrange panel's own rule that a work
// centers in whatever open space it actually has, not just the space between
// other art.
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
