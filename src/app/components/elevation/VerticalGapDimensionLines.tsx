import type { GapDimension } from "../../../domain/dimensions/orthogonalNeighbors";
import type { DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { wallLocalYToSvgY } from "./elevationArtworkGeometry";
import {
  estimateLabelWidth,
  labelTextStyle,
  ELEVATION_LABEL_FONT_PX,
  MIN_DIMENSION_SEGMENT_MM
} from "../shared/dimensionDrafting";

// Vertical companion to GroupDimensionLines: one dimension line per vertical
// neighbor gap (stacked works), derived by the same §9.6 corridor engine the
// document PDF uses (deriveVerticalNeighborGaps). The line stands in the gap's
// widest clear corridor with horizontal end ticks at the facing edges; the
// label stays horizontal (matching every other canvas annotation) beside the
// line, flipping to the left side when it would spill past the wall's end.
//
// All sizes divide by pixelsPerMm — the same constant-on-screen-size trick as
// GroupDimensionLines — so ticks, text, and offsets hold their size at any
// wall scale.

// ELEVATION_LABEL_FONT_PX / LABEL_GLYPH_WIDTH_RATIO / MIN_DIMENSION_SEGMENT_MM
// come from dimensionDrafting.ts, shared with GroupDimensionLines: gaps below
// the segment cutoff get no line (it would be a zero-length hairline) but
// keep ticks and a "0" label — works touching in a column is real information.

export function VerticalGapDimensionLines({
  gaps,
  wallLengthMm,
  wallHeightMm,
  pixelsPerMm,
  unit
}: {
  gaps: GapDimension[];
  wallLengthMm: number;
  wallHeightMm: number;
  pixelsPerMm: number;
  unit: DisplayUnit;
}) {
  if (gaps.length === 0 || pixelsPerMm <= 0) return null;

  const tickHalfMm = 5 / pixelsPerMm;
  const labelOffsetMm = 8 / pixelsPerMm;
  const fontSizeMm = ELEVATION_LABEL_FONT_PX / pixelsPerMm;

  return (
    <g pointerEvents="none">
      {gaps.map((gap) => {
        const xMm = (gap.corridorLoMm + gap.corridorHiMm) / 2;
        // fromMm/toMm are wall-local y-up facing edges; flip each to SVG y.
        const topSvgY = wallLocalYToSvgY(wallHeightMm, gap.toMm);
        const bottomSvgY = wallLocalYToSvgY(wallHeightMm, gap.fromMm);
        const midSvgY = (topSvgY + bottomSvgY) / 2;
        const isTiny = gap.gapMm < MIN_DIMENSION_SEGMENT_MM;
        const label = formatLength(gap.gapMm, { unit });

        // Horizontal label beside the line, vertically centered on the gap.
        // Flip to the left of the line when the estimated text would run past
        // the wall's right end (a column hung near the wall's end).
        const labelWidthMm = estimateLabelWidth(label, fontSizeMm);
        const spillsRight = xMm + labelOffsetMm + labelWidthMm > wallLengthMm;
        const labelX = spillsRight ? xMm - labelOffsetMm : xMm + labelOffsetMm;

        return (
          <g key={`${gap.aId}:${gap.bId}`}>
            {isTiny ? null : (
              <line
                className="dimension-line"
                x1={xMm}
                y1={topSvgY}
                x2={xMm}
                y2={bottomSvgY}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <line
              className="dimension-tick"
              x1={xMm - tickHalfMm}
              y1={topSvgY}
              x2={xMm + tickHalfMm}
              y2={topSvgY}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="dimension-tick"
              x1={xMm - tickHalfMm}
              y1={bottomSvgY}
              x2={xMm + tickHalfMm}
              y2={bottomSvgY}
              vectorEffect="non-scaling-stroke"
            />
            <text
              className="dimension-label"
              x={labelX}
              y={midSvgY + fontSizeMm * 0.35}
              textAnchor={spillsRight ? "end" : "start"}
              // Constant on-screen text size at any zoom, same as
              // GroupDimensionLines' labels.
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
