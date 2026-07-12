import type { DisplayUnit } from "../../../domain/project";
import type { PartitionClearances } from "../../../domain/geometry/partitionSpacing";
import { formatLength } from "../../../domain/units/length";

// Live clearance dimension lines for a selected (or actively dragged) partition
// in plan mode: from the centerline midpoint out to each perimeter wall the
// "normal"-axis rays hit, with a tick square at each end and the measured gap
// labelled at the segment midpoint. Render-only — the caller casts the rays
// (memoized) and lifts the result to floor space; this just paints it. Muted
// drafting ink via the shared .dimension-* classes, deliberately quieter than
// the petrol selection color. Sizes divide by nothing here — they are scaled
// off handleSizeMm (already px/mm-derived) so ticks and label hold a constant
// on-screen size at any zoom, the same trick RoomResizeHandles/GroupDimension-
// Lines use.
export function PartitionDimensionLines({
  clearances,
  handleSizeMm,
  unit
}: {
  clearances: PartitionClearances; // floor-space
  handleSizeMm: number;
  unit: DisplayUnit;
}) {
  if (handleSizeMm <= 0) return null;

  const { originMm, plus, minus } = clearances;
  const sides = [plus, minus].filter((hit): hit is NonNullable<typeof hit> => hit !== null);
  if (sides.length === 0) return null;

  const tickHalfMm = handleSizeMm * 0.4;
  const fontSizeMm = handleSizeMm * 1.6;

  return (
    <g pointerEvents="none">
      {sides.map((hit) => {
        const midXMm = (originMm.xMm + hit.pointMm.xMm) / 2;
        const midYMm = (originMm.yMm + hit.pointMm.yMm) / 2;
        return (
          <g key={hit.wallId}>
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
