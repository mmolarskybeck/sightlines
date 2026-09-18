import { monitorElevationGlyph } from "../../../domain/geometry/monitorGlyphs";

// The elevation "shadow" of a floor-standing BOX MONITOR in front of this wall:
// the cabinet with its screen marked inside, standing at its own baseHeightMm —
// non-interactive, dashed, painted BEHIND the wall objects, exactly like
// ElevationFloorCaseGhost next to it. Purely an alignment aid: it exists so a
// curator can see whether the screen's centre lines up with the work hung
// beside it.
//
// The PEDESTAL under it is not drawn here (schema v8): a pedestal is its own
// floor object and ghosts through ElevationSupportGhost. This cabinet simply
// starts where its bottom edge is — which, for a monitor standing on a
// pedestal, IS that pedestal's top face.
//
// Geometry comes straight from the scene's projection and the construction from
// the shared mm-space glyph module, so the drawing, the PDF and the 3D cabinet
// cannot drift.
export function ElevationMonitorGhost({
  wallHeightMm,
  xMinMm,
  xMaxMm,
  monitorHeightMm,
  baseHeightMm
}: {
  wallHeightMm: number;
  xMinMm: number;
  xMaxMm: number;
  monitorHeightMm: number;
  // Wall-local height of the cabinet's BOTTOM edge. 0 on the bare floor; a
  // pedestal's top face when the monitor is standing on one.
  baseHeightMm: number;
}) {
  const widthMm = Math.max(0, xMaxMm - xMinMm);
  // Nothing under the cabinet is this glyph's business any more, so the shared
  // construction is asked for the cabinet alone.
  const glyph = monitorElevationGlyph({ widthMm, monitorHeightMm, pedestalHeightMm: 0 });
  // Wall-local y is y-up from the floor; the cabinet's TOP edge is the smallest
  // SVG y after the shared flip, and every glyph y is local-down from there, so
  // one addition maps the whole construction.
  const topSvgYMm = wallHeightMm - baseHeightMm - glyph.totalHeightMm;

  return (
    <g className="elevation-monitor-ghost">
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
