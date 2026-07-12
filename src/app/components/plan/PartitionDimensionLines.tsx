import type { DisplayUnit, FreestandingWall } from "../../../domain/project";
import {
  partitionAxisForWorldAxis,
  type PartitionClearances,
  type SideClearance
} from "../../../domain/geometry/partitionSpacing";
import { formatLength } from "../../../domain/units/length";

// Live clearance dimension lines for a selected (or actively dragged) partition
// in plan mode: up to FOUR face-accurate clearances — the two normal (face) gaps
// AND the two span (end-cap) gaps — each drawn from the side's own origin (a
// slab face point or an end cap) out to the nearest obstacle it hit, with a
// tick square at each end and the measured true clear gap labelled at the
// segment midpoint. Sides that missed draw nothing. At rest (selected, no drag)
// all four show; during a MOVE drag `visibleWorldAxes` masks to just the gaps
// on the axes the partition is actually travelling on (so a pure x-move shows
// only its x-relevant pair), all reading true clear distances that update live.
// Render-only — the caller casts the rays
// (memoized) and lifts the result to floor space; this just paints it. Muted
// drafting ink via the shared .dimension-* classes, deliberately quieter than
// the petrol selection color. Sizes divide by nothing here — they are scaled
// off handleSizeMm (already px/mm-derived) so ticks and label hold a constant
// on-screen size at any zoom, the same trick RoomResizeHandles/GroupDimension-
// Lines use.
export function PartitionDimensionLines({
  clearances,
  partition,
  visibleWorldAxes = { x: true, y: true },
  handleSizeMm,
  unit
}: {
  clearances: PartitionClearances; // floor-space
  partition: FreestandingWall;
  // Which world axes' gaps to draw. Defaults to both (at rest / endpoint drag,
  // all four). During a MOVE drag the caller passes the latched mask, so only
  // the gaps on the axes the partition is actually travelling on are shown.
  visibleWorldAxes?: { x: boolean; y: boolean };
  handleSizeMm: number;
  unit: DisplayUnit;
}) {
  if (handleSizeMm <= 0) return null;

  // A clearance pair (normal or span) is visible when EITHER world axis in the
  // mask maps to it — partitionAxisForWorldAxis is the single source of truth
  // for the world-axis → direction mapping, shared with the centering buttons.
  const showNormal =
    (visibleWorldAxes.x && partitionAxisForWorldAxis(partition, "x") === "normal") ||
    (visibleWorldAxes.y && partitionAxisForWorldAxis(partition, "y") === "normal");
  const showSpan =
    (visibleWorldAxes.x && partitionAxisForWorldAxis(partition, "x") === "axis") ||
    (visibleWorldAxes.y && partitionAxisForWorldAxis(partition, "y") === "axis");

  const sides: Array<{ key: string; side: SideClearance }> = [
    { key: "normal-plus", side: clearances.normal.plus },
    { key: "normal-minus", side: clearances.normal.minus },
    { key: "span-plus", side: clearances.span.plus },
    { key: "span-minus", side: clearances.span.minus }
  ]
    .filter((entry) => (entry.key.startsWith("normal") ? showNormal : showSpan))
    .filter((entry) => entry.side.hit !== null);
  if (sides.length === 0) return null;

  const tickHalfMm = handleSizeMm * 0.4;
  const fontSizeMm = handleSizeMm * 1.6;

  return (
    <g pointerEvents="none">
      {sides.map(({ key, side }) => {
        const hit = side.hit!;
        const originMm = side.originMm;
        const midXMm = (originMm.xMm + hit.pointMm.xMm) / 2;
        const midYMm = (originMm.yMm + hit.pointMm.yMm) / 2;
        return (
          <g key={key}>
            <line
              className="dimension-line"
              x1={originMm.xMm}
              y1={originMm.yMm}
              x2={hit.pointMm.xMm}
              y2={hit.pointMm.yMm}
              vectorEffect="non-scaling-stroke"
            />
            {[originMm, hit.pointMm].map((corner, index) => (
              <rect
                key={index}
                className="plan-dimension-tick"
                x={corner.xMm - tickHalfMm}
                y={corner.yMm - tickHalfMm}
                width={tickHalfMm * 2}
                height={tickHalfMm * 2}
              />
            ))}
            <text
              className="dimension-label"
              x={midXMm}
              y={midYMm}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fontSize: fontSizeMm, strokeWidth: fontSizeMm * 0.3 }}
            >
              {formatLength(hit.distanceMm, { unit })}
            </text>
          </g>
        );
      })}
    </g>
  );
}
