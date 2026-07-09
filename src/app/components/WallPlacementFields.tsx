import type { ArtworkWallObject, DisplayUnit } from "../../domain/project";
import { LengthField } from "./LengthField";
import { getScopedUnitContext } from "./scopedUnits";

// Props-driven "Position on wall" editor for a single wall-placed artwork —
// the numeric twin of dragging the work along its wall in the elevation view.
// Everything arrives as props (App derives the wall length, wall name, and the
// nearest-neighbour edges from the store), so this stays purely presentational
// in the same spirit as FloorPlacementFields / ArtworkInspector.
//
// The curator's physical framing throughout: a work sits some distance from
// each wall edge, and (when it has neighbours) some gap from the work beside
// it — never "x"/"margin"/"inset". "From left edge" and "From right edge" are
// two views of one horizontal position: both are always live, and committing
// either moves the work, so on the next render the other reflects the move.
export function WallPlacementFields({
  placement,
  wallLengthMm,
  wallName,
  leftNeighborRightEdgeMm,
  rightNeighborLeftEdgeMm,
  onCommit,
  unit
}: {
  placement: Pick<ArtworkWallObject, "xMm" | "yMm" | "widthMm" | "heightMm">;
  wallLengthMm: number;
  // The wall the work hangs on, for the section header; null falls back to the
  // generic "Position on wall".
  wallName: string | null;
  // Right edge of the nearest other artwork whose CENTER is left of this work
  // (undefined when there is none) — the "To work on left" field is hidden
  // entirely rather than disabled when absent.
  leftNeighborRightEdgeMm?: number;
  // Left edge of the nearest other artwork whose center is right of this work.
  rightNeighborLeftEdgeMm?: number;
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

  return (
    <div className="artwork-dimensions">
      <div className="artwork-dimensions-heading">
        <h3>Position on {wallName ?? "wall"}</h3>
      </div>

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
    </div>
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
