// The elevation "shadow" of a PEDESTAL OR PLINTH standing in front of this
// wall, with its plexi bonnet when it has one. Non-interactive, dashed, painted
// BEHIND the wall objects, exactly like ElevationFloorCaseGhost and
// ElevationMonitorGhost beside it: the support belongs to no wall, so it
// carries no selection, no drag and no resize. It exists so a curator can see
// whether the volume standing in front of the wall lines up with what is hung
// on it.
//
// Geometry comes straight from the scene (ElevationSceneSupportGhost, built by
// buildElevationScene's projectFloorObjectOntoWall) through the shared mm-space
// glyph (supportElevationGlyph), so this and the PDF draw the same marks.
//
// The works standing on it are NOT drawn here: a rider is an ordinary floor
// artwork at its own baseHeightMm and ghosts through
// ElevationSuspendedArtworkGhost (or ElevationMonitorGhost), which is literally
// where it is. That is the whole point of schema v8.
//
// TRAP: a LOCKED bonnet may be SHORTER than the work it covers (USER DECISION
// 2026-09-17 — the inspector warns rather than growing it). The rider's own
// ghost is therefore drawn in full, straight through and past the bonnet's top:
// the drawing has to show the collision.
import { supportElevationGlyph } from "../../../domain/geometry/supportGlyphs";

export function ElevationSupportGhost({
  wallHeightMm,
  xMinMm,
  xMaxMm,
  heightMm,
  bonnetHeightMm
}: {
  wallHeightMm: number;
  xMinMm: number;
  xMaxMm: number;
  heightMm: number;
  bonnetHeightMm?: number;
}) {
  const glyph = supportElevationGlyph({ xMinMm, xMaxMm, heightMm, bonnetHeightMm });
  // Wall-local y is y-up from the floor while SVG y runs down from the wall's
  // top edge, so one subtraction maps each box's TOP onto its SVG y.
  const svgY = (topYMm: number) => wallHeightMm - topYMm;
  const widthMm = Math.max(0, xMaxMm - xMinMm);

  return (
    <g className="elevation-support-ghost">
      <rect
        className="support-ghost-block"
        height={Math.max(0, glyph.block.topYMm - glyph.block.bottomYMm)}
        vectorEffect="non-scaling-stroke"
        width={widthMm}
        x={glyph.block.xMinMm}
        y={svgY(glyph.block.topYMm)}
      />
      {/* The plexi bonnet: rising from the top face at the support's own
          footprint, in the finer dash the monitor ghost's screen and the
          suspension wires use — glass explains itself without competing with
          the volumes a curator is aligning against. */}
      {glyph.bonnet ? (
        <rect
          className="support-ghost-bonnet"
          height={Math.max(0, glyph.bonnet.topYMm - glyph.bonnet.bottomYMm)}
          vectorEffect="non-scaling-stroke"
          width={widthMm}
          x={glyph.bonnet.xMinMm}
          y={svgY(glyph.bonnet.topYMm)}
        />
      ) : null}
    </g>
  );
}
