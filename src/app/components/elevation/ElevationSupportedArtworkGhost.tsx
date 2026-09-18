// The elevation "shadow" of a floor artwork STANDING ON A SUPPORT — a
// sculpture on a pedestal, a work on a low plinth, either of them under a plexi
// bonnet. Non-interactive, dashed, painted BEHIND the wall objects, exactly
// like ElevationFloorCaseGhost and ElevationMonitorGhost beside it: the
// assembly belongs to no wall, so it carries no selection, no drag and no
// resize. It exists so a curator can see whether the work's centre lines up
// with what is hung on the wall behind it.
//
// Geometry comes straight from the scene
// (ElevationSceneSupportedArtworkGhost, built by buildElevationScene's
// projectSupportedFootprintOntoWall) and nothing is re-derived here.
//
// TWO SPANS, NOT ONE, and this is the whole reason this component isn't the
// floor-case ghost with a different height: xMin/xMax are the ASSEMBLY's
// along-wall extent (work ∪ support, wider than either whenever the support is
// bigger or the work overhangs) and bound the support box and the bonnet, while
// workXMin/workXMax bound the work outline standing on top. Collapsing them
// would draw a sculpture as wide as its plinth.
//
// TRAP: a LOCKED bonnet may be SHORTER than the work it covers (USER DECISION
// 2026-09-17 — the normaliser warns rather than growing it). The work outline
// is therefore drawn in full, straight through and past the bonnet's top,
// never clipped to it: the drawing has to show the collision the inspector is
// warning about.
export function ElevationSupportedArtworkGhost({
  wallHeightMm,
  xMinMm,
  xMaxMm,
  supportHeightMm,
  workHeightMm,
  bonnetHeightMm,
  workXMinMm,
  workXMaxMm,
  supportXMinMm,
  supportXMaxMm
}: {
  wallHeightMm: number;
  // The assembly span: kept for the neighbour pool; nothing here draws it.
  xMinMm: number;
  xMaxMm: number;
  supportHeightMm: number;
  workHeightMm: number;
  bonnetHeightMm?: number;
  workXMinMm: number;
  workXMaxMm: number;
  supportXMinMm: number;
  supportXMaxMm: number;
}) {
  void xMinMm;
  void xMaxMm;
  // The support block and the bonnet share the SUPPORT's span, not the
  // assembly's: with overhang on, the work can be wider than its pedestal, and
  // the drawing has to show the pedestal as it is, exactly as plan does.
  const supportWidthMm = Math.max(0, supportXMaxMm - supportXMinMm);
  const workWidthMm = Math.max(0, workXMaxMm - workXMinMm);
  // Wall-local y is y-up from the floor while SVG y runs down from the wall's
  // top edge, so one subtraction maps each box's TOP (the larger wall-local y)
  // onto its SVG y. Stated per box rather than once for the assembly: the work
  // and the bonnet have different tops, and a shared "assembly top" would have
  // to pick one of them and be wrong about the other.
  const topSvgYMm = (bottomMm: number, heightMm: number) =>
    wallHeightMm - (bottomMm + heightMm);

  return (
    <g className="elevation-supported-artwork-ghost">
      {/* The support block, standing on the floor line across the support's
          own span. Painted first so the work's own outline overdraws the seam
          where the two meet rather than sitting under it — the same order the
          monitor ghost draws its plinth in. */}
      <rect
        className="supported-artwork-ghost-support"
        height={supportHeightMm}
        vectorEffect="non-scaling-stroke"
        width={supportWidthMm}
        x={supportXMinMm}
        y={topSvgYMm(0, supportHeightMm)}
      />
      {/* The work itself, its bottom edge ON the support's top face — that is
          what a support means (baseHeightMm is ignored under one), so there is
          no gap to account for here. */}
      <rect
        className="supported-artwork-ghost-work"
        height={workHeightMm}
        vectorEffect="non-scaling-stroke"
        width={workWidthMm}
        x={workXMinMm}
        y={topSvgYMm(supportHeightMm, workHeightMm)}
      />
      {/* The plexi bonnet: rising from the support's top face at the support's
          own footprint (bonnet footprint = support footprint, USER DECISION
          2026-09-17), so its span is the support's, not the work's. Drawn
          last, over the work it covers, with the finer dash the monitor
          ghost's screen and the suspension wires use — glass explains itself
          without competing with the volumes a curator is aligning against. */}
      {bonnetHeightMm !== undefined ? (
        <rect
          className="supported-artwork-ghost-bonnet"
          height={bonnetHeightMm}
          vectorEffect="non-scaling-stroke"
          width={supportWidthMm}
          x={supportXMinMm}
          y={topSvgYMm(supportHeightMm, bonnetHeightMm)}
        />
      ) : null}
    </g>
  );
}
