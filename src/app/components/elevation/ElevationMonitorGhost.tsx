import { monitorElevationGlyph } from "../../../domain/geometry/monitorGlyphs";

// The elevation "shadow" of a floor-standing BOX MONITOR in front of this wall:
// a plinth rising from the floor line with the cabinet on top of it and the
// screen marked inside — non-interactive, dashed, painted BEHIND the wall
// objects, exactly like ElevationFloorCaseGhost next to it. Purely an alignment
// aid: it exists so a curator can see whether the screen's centre lines up with
// the work hung beside it.
//
// Geometry comes straight from the scene's projectFloorObjectOntoWall (the
// along-wall x-range, shared with the case and suspended-board ghosts) and the
// construction from the shared mm-space glyph module, so the drawing, the PDF
// and the 3D cabinet cannot drift.
export function ElevationMonitorGhost({
  wallHeightMm,
  xMinMm,
  xMaxMm,
  monitorHeightMm,
  pedestalHeightMm
}: {
  wallHeightMm: number;
  xMinMm: number;
  xMaxMm: number;
  monitorHeightMm: number;
  pedestalHeightMm: number;
}) {
  const widthMm = Math.max(0, xMaxMm - xMinMm);
  const glyph = monitorElevationGlyph({
    widthMm,
    monitorHeightMm,
    pedestalHeightMm
  });
  // Wall-local y is y-up from the floor; the assembly's TOP edge is the
  // smallest SVG y after the shared flip, and every glyph y is local-down from
  // there, so one addition maps the whole construction.
  const topSvgYMm = wallHeightMm - glyph.totalHeightMm;

  return (
    <g className="elevation-monitor-ghost">
      {/* The plinth first, so the cabinet's own outline paints over the seam
          where the two meet rather than under it. Absent entirely when the
          monitor stands on the bare floor. */}
      {glyph.pedestal ? (
        <rect
          className="monitor-ghost-pedestal"
          height={glyph.pedestal.heightMm}
          vectorEffect="non-scaling-stroke"
          width={glyph.pedestal.widthMm}
          x={xMinMm + glyph.pedestal.xMm}
          y={topSvgYMm + glyph.pedestal.yMm}
        />
      ) : null}
      <rect
        className="monitor-ghost-cabinet"
        height={glyph.monitor.heightMm}
        vectorEffect="non-scaling-stroke"
        width={glyph.monitor.widthMm}
        x={xMinMm + glyph.monitor.xMm}
        y={topSvgYMm + glyph.monitor.yMm}
      />
      {/* The picture area, inset by the bezel. Null on a cabinet too small to
          hold a bezel on both sides — which then reads as a plain box, the same
          degenerate fallback the floor-case ghost takes below its legs
          threshold. */}
      {glyph.screen ? (
        <rect
          className="monitor-ghost-screen"
          height={glyph.screen.heightMm}
          vectorEffect="non-scaling-stroke"
          width={glyph.screen.widthMm}
          x={xMinMm + glyph.screen.xMm}
          y={topSvgYMm + glyph.screen.yMm}
        />
      ) : null}
    </g>
  );
}
