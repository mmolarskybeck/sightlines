import {
  SUSPENSION_WIRE_INSET_FRACTION,
  SUSPENSION_WIRE_INSET_MM
} from "../../../domain/project";

// Suspension-wire inset from each end of the projected extent. Same spirit as
// the floor-case ghost's leg inset (CASE_LEG_INSET_MM): the projection is a 1D
// along-wall range, so the real wire positions aren't recoverable here — two
// lines are an honest approximation of "hung from above", not a hardware
// drawing. Capped at a fraction of the span so a narrow projection (a board
// seen nearly edge-on) still gets two distinct wires instead of a crossed X.
//
// Both constants come from domain/project.ts, shared with the 3D wires, so the
// two views cannot drift apart on where a wire meets the board. Importing from
// domain (not from three/) keeps R3F out of the elevation bundle.

// The elevation "shadow" of a SUSPENDED floor artwork — the projection-board
// case: a thin panel hung from ceiling wires, angled to the wall, hovering above
// the floor. Non-interactive, exactly like ElevationFloorCaseGhost: the board
// belongs to no wall, so it carries no selection, no drag, no resize, and paints
// BEHIND the wall objects purely so you can see what volume it occupies in front
// of this wall.
//
// TRAP: unlike the floor-case ghost this does NOT stand on the floor line. Its
// bottom edge is baseHeightMm above the floor and its top is baseHeightMm +
// heightMm — a box floating in the middle of the elevation. Anything that
// assumes "ghost bottom = floor" (dimension participants, a future PDF drawer)
// has to read baseHeightMm rather than deriving the span from heightMm alone.
export function ElevationSuspendedArtworkGhost({
  baseHeightMm,
  heightMm,
  wallHeightMm,
  xMinMm,
  xMaxMm
}: {
  baseHeightMm: number;
  heightMm: number;
  wallHeightMm: number;
  xMinMm: number;
  xMaxMm: number;
}) {
  const widthMm = Math.max(0, xMaxMm - xMinMm);
  // Wall-local y is y-up from the floor; the shared flip puts the board's TOP
  // edge (the larger wall-local y) at the smaller SVG y.
  const topSvgYMm = wallHeightMm - (baseHeightMm + heightMm);

  // Wires run from the board's top up to the wall's top edge (SVG y=0). There
  // is no ceiling geometry in the model — the 3D view hangs its wires to the
  // room's wall height for the same reason, so the two views agree. Suppressed
  // for a board whose top is at or above the wall top: there is no air left to
  // draw a wire in, and a "wire" running downward would read as nonsense.
  const showWires = topSvgYMm > 0;
  const wireInsetMm = Math.min(
    SUSPENSION_WIRE_INSET_MM,
    widthMm * SUSPENSION_WIRE_INSET_FRACTION
  );
  const wireXStartMm = xMinMm + wireInsetMm;
  const wireXEndMm = xMaxMm - wireInsetMm;

  return (
    <g className="elevation-suspended-artwork-ghost">
      {showWires ? (
        <>
          <line
            className="suspended-artwork-ghost-wire"
            vectorEffect="non-scaling-stroke"
            x1={wireXStartMm}
            x2={wireXStartMm}
            y1={0}
            y2={topSvgYMm}
          />
          <line
            className="suspended-artwork-ghost-wire"
            vectorEffect="non-scaling-stroke"
            x1={wireXEndMm}
            x2={wireXEndMm}
            y1={0}
            y2={topSvgYMm}
          />
        </>
      ) : null}
      <rect
        className="suspended-artwork-ghost-board"
        height={heightMm}
        vectorEffect="non-scaling-stroke"
        width={widthMm}
        x={xMinMm}
        y={topSvgYMm}
      />
    </g>
  );
}
