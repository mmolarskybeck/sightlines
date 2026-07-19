import type { DisplayUnit } from "../../../domain/project";
import type { PlanGapLine } from "../../../domain/dimensions/planDimensions";
import { formatLength } from "../../../domain/units/length";
import {
  estimateLabelWidth,
  labelFitsInSpan,
  labelTextStyle,
  MIN_DIMENSION_SEGMENT_MM
} from "../shared/dimensionDrafting";

// Selection-driven plan-view dimension lines: the top-down twin of elevation's
// VerticalGapDimensionLines, sharing PartitionDimensionLines' drafting
// vocabulary (the .dimension-line / .dimension-tick / .dimension-label classes,
// witness-free facing-edge ticks, handleSizeMm-scaled sizes for constant on-
// screen size, non-scaling strokes). Every PlanGapLine is already fully placed
// in floor space by planDimensions.ts; this component only offsets the line off
// its measured geometry (floor gaps sit in the corridor, wall gaps step into the
// room), draws the two facing-edge ticks, and labels the clearance horizontally.
//
// Floor coordinates share the plan SVG's y-down space, so points map straight
// through with no flip. Labels stay horizontal (axis-independent), matching
// every other plan annotation.
//
// A gap narrower than its own label (e.g. an 8 1/4" clearance between two
// display cases) can't hold a label centered at 0.9 handle-units off the
// line — the text is wider than the gap itself and runs behind the
// neighboring object's fill. When the estimated label width doesn't fit the
// measured gap, the label steps out to a farther offset along the normal
// (clear of the measured geometry) with a short leader line back to the
// dimension line's midpoint, the same staggered-label/leader convention
// PartitionDimensionLines uses for labels that don't fit their segment.

const LABEL_FIT_SLACK = 0.8; // handle-units of breathing room, matches PartitionDimensionLines
const NEAR_LABEL_OFFSET_RATIO = 0.9; // label sits close to the line when it fits
const FAR_LABEL_OFFSET_RATIO = 2.4; // stepped out, past the measured geometry, when it doesn't

export function PlanGapDimensionLines({
  gaps,
  handleSizeMm,
  unit
}: {
  gaps: PlanGapLine[];
  handleSizeMm: number;
  unit: DisplayUnit;
}) {
  if (gaps.length === 0 || handleSizeMm <= 0) return null;

  const tickHalfMm = handleSizeMm * 0.45;
  const fontSizeMm = handleSizeMm * 1.6;
  const nearLabelOffsetMm = handleSizeMm * NEAR_LABEL_OFFSET_RATIO;
  const farLabelOffsetMm = handleSizeMm * FAR_LABEL_OFFSET_RATIO;

  return (
    <g pointerEvents="none">
      {gaps.map((gap) => {
        // Line direction a→b and its unit; degenerate (touching) gaps still tick.
        const dx = gap.bMm.xMm - gap.aMm.xMm;
        const dy = gap.bMm.yMm - gap.aMm.yMm;
        const length = Math.hypot(dx, dy);
        const dir =
          length > 1e-6 ? { xMm: dx / length, yMm: dy / length } : { xMm: 1, yMm: 0 };
        // Tick runs perpendicular to the line (i.e. along the facing edge).
        const tick = { xMm: -dir.yMm, yMm: dir.xMm };

        const offsetMm = gap.offsetHandleUnits * handleSizeMm;
        const shift = (point: { xMm: number; yMm: number }) => ({
          xMm: point.xMm + gap.normalMm.xMm * offsetMm,
          yMm: point.yMm + gap.normalMm.yMm * offsetMm
        });
        const a = shift(gap.aMm);
        const b = shift(gap.bMm);
        const mid = { xMm: (a.xMm + b.xMm) / 2, yMm: (a.yMm + b.yMm) / 2 };
        const isTiny = gap.gapMm < MIN_DIMENSION_SEGMENT_MM;
        const label = formatLength(Math.max(0, gap.gapMm), { unit });

        // Fit test against the UNSHIFTED line length (the measured gap the
        // objects actually leave) — a normal-direction offset never widens
        // that span. When the label doesn't fit, it steps out to the farther
        // offset and gets a leader back to the line, like Partition's row>0.
        const labelWidth = estimateLabelWidth(label, fontSizeMm);
        const fits = labelFitsInSpan(length, labelWidth, handleSizeMm * LABEL_FIT_SLACK);
        // The stepped-out label must clear the measured footprints themselves,
        // not just the line: labelClearMm (when the domain knows the union's
        // near edge) plus most of a line-height beats the fixed far offset.
        const clearOffsetMm =
          gap.labelClearMm !== undefined ? gap.labelClearMm + fontSizeMm : farLabelOffsetMm;
        const labelOffsetMm = fits ? nearLabelOffsetMm : Math.max(farLabelOffsetMm, clearOffsetMm);
        const labelPoint = {
          xMm: mid.xMm + gap.normalMm.xMm * labelOffsetMm,
          yMm: mid.yMm + gap.normalMm.yMm * labelOffsetMm
        };

        return (
          <g key={gap.id}>
            {isTiny ? null : (
              <line
                className="dimension-line"
                x1={a.xMm}
                y1={a.yMm}
                x2={b.xMm}
                y2={b.yMm}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {[a, b].map((point, index) => (
              <line
                key={index}
                className="dimension-tick"
                x1={point.xMm - tick.xMm * tickHalfMm}
                y1={point.yMm - tick.yMm * tickHalfMm}
                x2={point.xMm + tick.xMm * tickHalfMm}
                y2={point.yMm + tick.yMm * tickHalfMm}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {fits ? null : (
              <line
                className="dimension-line"
                x1={mid.xMm}
                y1={mid.yMm}
                x2={labelPoint.xMm}
                y2={labelPoint.yMm}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <text
              className="dimension-label"
              x={labelPoint.xMm}
              y={labelPoint.yMm}
              textAnchor="middle"
              dominantBaseline="central"
              style={labelTextStyle(fontSizeMm)}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
