import type { DisplayUnit, FreestandingWall } from "../../../domain/project";
import {
  partitionAxisForWorldAxis,
  type ChainSegment,
  type PartitionDimensionChains
} from "../../../domain/geometry/partitionSpacing";
import { formatLength } from "../../../domain/units/length";
import { staggerLabelRow } from "./labelStagger";

const LABEL_GLYPH_WIDTH_RATIO = 0.62;
const LABEL_FIT_SLACK = 0.8;
const MAX_STAGGER_ROW = 3;

type ChainName = keyof PartitionDimensionChains;

export function PartitionDimensionLines({
  chains,
  partition,
  visibleWorldAxes = { x: true, y: true },
  handleSizeMm,
  unit
}: {
  chains: PartitionDimensionChains;
  partition: FreestandingWall;
  visibleWorldAxes?: { x: boolean; y: boolean };
  handleSizeMm: number;
  unit: DisplayUnit;
}) {
  if (handleSizeMm <= 0) return null;

  const showNormal =
    (visibleWorldAxes.x && partitionAxisForWorldAxis(partition, "x") === "normal") ||
    (visibleWorldAxes.y && partitionAxisForWorldAxis(partition, "y") === "normal");
  const showSpan =
    (visibleWorldAxes.x && partitionAxisForWorldAxis(partition, "x") === "axis") ||
    (visibleWorldAxes.y && partitionAxisForWorldAxis(partition, "y") === "axis");

  const visible: Array<{ name: ChainName; segments: ChainSegment[] }> = [
    ...(showNormal ? [{ name: "normal" as const, segments: chains.normal }] : []),
    ...(showSpan ? [{ name: "span" as const, segments: chains.span }] : [])
  ].filter((entry) => entry.segments.length > 0);

  return (
    <g pointerEvents="none">
      {visible.map(({ name, segments }) => (
        <DimensionChain
          key={name}
          name={name}
          segments={segments}
          handleSizeMm={handleSizeMm}
          unit={unit}
        />
      ))}
    </g>
  );
}

function DimensionChain({
  name,
  segments,
  handleSizeMm,
  unit
}: {
  name: ChainName;
  segments: ChainSegment[];
  handleSizeMm: number;
  unit: DisplayUnit;
}) {
  const first = segments[0]?.aMm;
  const last = segments.at(-1)?.bMm;
  if (!first || !last) return null;
  const length = Math.hypot(last.xMm - first.xMm, last.yMm - first.yMm);
  if (length <= 1e-6) return null;
  const dir = { xMm: (last.xMm - first.xMm) / length, yMm: (last.yMm - first.yMm) / length };
  // Put the two chains on opposite drafting sides so their labels do not pile
  // up over the selected slab at the crossing.
  const side = name === "normal" ? 1 : -1;
  const normal = { xMm: -dir.yMm * side, yMm: dir.xMm * side };
  const offsetMm = handleSizeMm * 2.5;
  const shifted = (point: { xMm: number; yMm: number }) => ({
    xMm: point.xMm + normal.xMm * offsetMm,
    yMm: point.yMm + normal.yMm * offsetMm
  });
  const fontSizeMm = handleSizeMm * 1.6;
  const tickHalfMm = handleSizeMm * 0.45;
  const rowSpacingMm = handleSizeMm * 1.8;
  // Drafting conventions: witness lines stand off the measured geometry and
  // overshoot slightly past the dimension line; ticks are oblique 45° slashes
  // so they stay legible at low zoom where a perpendicular tick would merge
  // into the witness line.
  const witnessGapMm = handleSizeMm * 0.6;
  const witnessOvershootMm = handleSizeMm * 0.5;
  const tickDir = {
    xMm: (dir.xMm + normal.xMm) * Math.SQRT1_2,
    yMm: (dir.yMm + normal.yMm) * Math.SQRT1_2
  };
  const gapSegments = segments.filter((segment) => segment.kind === "gap");
  const rowEnd: number[] = [];
  const labels = gapSegments.map((segment) => {
    const label = formatLength(Math.max(0, segment.lengthMm), { unit });
    const startAlong =
      (segment.aMm.xMm - first.xMm) * dir.xMm +
      (segment.aMm.yMm - first.yMm) * dir.yMm;
    const endAlong = startAlong + segment.lengthMm;
    const labelWidth = label.length * fontSizeMm * LABEL_GLYPH_WIDTH_RATIO;
    const midAlong = (startAlong + endAlong) / 2;
    const row = staggerLabelRow(rowEnd, {
      fits: segment.lengthMm >= labelWidth + handleSizeMm * LABEL_FIT_SLACK,
      mid: midAlong,
      halfWidth: labelWidth / 2,
      gap: handleSizeMm * 0.5,
      maxRow: MAX_STAGGER_ROW
    });
    return { segment, label, row, labelWidth };
  });
  const stations = [segments[0].aMm, ...segments.map((segment) => segment.bMm)];
  // Row-0 labels sit on the dimension line itself, so the line breaks behind
  // them; the break spans the label's extent projected onto the line.
  const lineBreaks = new Map(
    labels
      .filter(({ row }) => row === 0)
      .map(({ segment, labelWidth }) => [
        segment,
        (Math.abs(dir.xMm) * labelWidth + Math.abs(dir.yMm) * fontSizeMm * 1.4) / 2 +
          handleSizeMm * 0.4
      ])
  );

  return (
    <g>
      {segments.map((segment, index) => {
        const a = shifted(segment.aMm);
        const b = shifted(segment.bMm);
        const halfBreakMm = lineBreaks.get(segment);
        const halfLengthMm = segment.lengthMm / 2;
        if (halfBreakMm !== undefined && halfBreakMm < halfLengthMm) {
          const mid = { xMm: (a.xMm + b.xMm) / 2, yMm: (a.yMm + b.yMm) / 2 };
          return (
            <g key={`segment-${index}`}>
              <line
                className="dimension-line"
                x1={a.xMm}
                y1={a.yMm}
                x2={mid.xMm - dir.xMm * halfBreakMm}
                y2={mid.yMm - dir.yMm * halfBreakMm}
                vectorEffect="non-scaling-stroke"
              />
              <line
                className="dimension-line"
                x1={mid.xMm + dir.xMm * halfBreakMm}
                y1={mid.yMm + dir.yMm * halfBreakMm}
                x2={b.xMm}
                y2={b.yMm}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        }
        return (
          <line
            key={`segment-${index}`}
            className="dimension-line"
            x1={a.xMm}
            y1={a.yMm}
            x2={b.xMm}
            y2={b.yMm}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {stations.map((station, index) => {
        const point = shifted(station);
        return (
          <g key={`station-${index}`}>
            <line
              className="dimension-line"
              x1={station.xMm + normal.xMm * witnessGapMm}
              y1={station.yMm + normal.yMm * witnessGapMm}
              x2={point.xMm + normal.xMm * witnessOvershootMm}
              y2={point.yMm + normal.yMm * witnessOvershootMm}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="plan-dimension-tick"
              x1={point.xMm - tickDir.xMm * tickHalfMm}
              y1={point.yMm - tickDir.yMm * tickHalfMm}
              x2={point.xMm + tickDir.xMm * tickHalfMm}
              y2={point.yMm + tickDir.yMm * tickHalfMm}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      {labels.map(({ segment, label, row }, index) => {
        const midpoint = shifted({
          xMm: (segment.aMm.xMm + segment.bMm.xMm) / 2,
          yMm: (segment.aMm.yMm + segment.bMm.yMm) / 2
        });
        // Row 0 sits in the break of the dimension line itself; staggered
        // rows step outward and keep a leader back to the line.
        const labelOffsetMm = row === 0 ? 0 : handleSizeMm * 1.2 + row * rowSpacingMm;
        const labelPoint = {
          xMm: midpoint.xMm + normal.xMm * labelOffsetMm,
          yMm: midpoint.yMm + normal.yMm * labelOffsetMm
        };
        return (
          <g key={`label-${index}`}>
            {row > 0 ? (
              <line
                className="dimension-line"
                x1={midpoint.xMm}
                y1={midpoint.yMm}
                x2={labelPoint.xMm}
                y2={labelPoint.yMm}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <text
              className="dimension-label"
              x={labelPoint.xMm}
              y={labelPoint.yMm}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fontSize: fontSizeMm, strokeWidth: fontSizeMm * 0.3 }}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
