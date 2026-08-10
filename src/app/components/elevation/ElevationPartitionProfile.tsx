import { wallLocalYToSvgY } from "./elevationArtworkGeometry";

// One free-standing partition projected onto this wall's elevation — the
// end-cap side profile of a perpendicular partition, the full length of a
// parallel one, the |w·cos| + |d·sin| span of anything oblique (the scene
// builder owns that math; this only draws the range it reports).
//
// TWO TIERS, decided upstream by ElevationScenePartitionProfile.abutting:
//  - abutting → a SOLID slab in the plan view's partition ink, painted AFTER
//    the wall objects. It is architecture meeting this wall and splitting it
//    into two hanging zones, so covering the work at that seam is the honest
//    read, not an occlusion bug.
//  - otherwise → the dashed ghost outline shared with the floor-case and
//    suspended-artwork ghosts, painted BEFORE the wall objects so a partition
//    standing out in the room can never hide hung work.
// Both are inert: no selection, no drag, pointer-events: none in CSS. Nothing
// about placement or validation changes because this drawing exists.
export function ElevationPartitionProfile({
  abutting,
  heightMm,
  wallHeightMm,
  xMinMm,
  xMaxMm
}: {
  abutting: boolean;
  heightMm: number;
  wallHeightMm: number;
  xMinMm: number;
  xMaxMm: number;
}) {
  const widthMm = Math.max(0, xMaxMm - xMinMm);
  // Wall-local y is y-up from the floor; the shared flip puts the partition's
  // TOP edge at the smaller SVG y. A partition taller than the wall it stands
  // in front of therefore overshoots the wall rect — deliberately not clamped,
  // since that IS what the geometry says.
  const topSvgYMm = wallLocalYToSvgY(wallHeightMm, heightMm);

  return (
    <rect
      className={abutting ? "elevation-partition-profile" : "elevation-partition-ghost"}
      height={heightMm}
      vectorEffect="non-scaling-stroke"
      width={widthMm}
      x={xMinMm}
      y={topSvgYMm}
    />
  );
}
