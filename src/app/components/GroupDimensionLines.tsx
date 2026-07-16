import { getGroupBounds } from "../../domain/placement/groupBounds";
import type { DisplayUnit, WallObjectBase } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { wallLocalYToSvgY } from "./elevationArtworkGeometry";
import { staggerLabelRow } from "./plan/labelStagger";

// On-canvas dimension lines for a selection on one wall: an outer segment on
// each side, every actual interior gap between members, each with end ticks and
// a formatted length label. Segments are PRECOMPUTED by the caller and passed
// in — the caller chooses which flavour to feed based on context, since the two
// spacing readings differ deliberately:
//   • IDLE selection → getNeighborAwareSegments: the outer segments stop at the
//     nearest unselected neighbour (window/door/work) rather than sailing to
//     the far wall edge, so the numbers describe the space actually beside the
//     works.
//   • ACTIVE arrange session → getSpacingSegments: the outer segments run to
//     the wall edges, because the arrange modes solve against the wall edges —
//     the lines must show the very values being edited.
// Either way the caller applies every live preview (arrange session + in-flight
// drag) to both the members and the segments, so labels track movement in
// realtime; `members` here is only used to position the line row below the
// group's union bounds.
//
// All sizes divide by pixelsPerMm — the RoomResizeHandles trick — so ticks,
// label text, and offsets hold a constant on-screen size at any wall scale,
// the same job vector-effect="non-scaling-stroke" does for the line strokes.

// Estimated on-screen glyph width as a fraction of the font size — used to
// decide whether a segment is wide enough for its label to fit centered under
// its own line, or whether it must be staggered to a lower row instead.
const LABEL_FONT_PX = 10;
const LABEL_GLYPH_WIDTH_RATIO = 0.62;
const LABEL_FIT_SLACK_PX = 8;

// Horizontal breathing room (screen px) kept between two labels sharing a
// staggered row so their halos never touch.
const LABEL_ROW_GAP_PX = 4;

// The deepest staggered row a label may occupy; past this we stop looking and
// place it on the last row even if it collides, since a slightly crowded label
// still beats a dropped measurement.
const MAX_STAGGER_ROW = 3;

// Segments narrower than this get no connecting line (a flush edge would draw a
// zero-length or backwards span) — but they are still LABELED: a "0"" readout
// tells the curator the works are touching, which is real information.
const MIN_SEGMENT_MM = 0.5;

export function GroupDimensionLines({
  members,
  segments,
  wallHeightMm,
  pixelsPerMm,
  unit
}: {
  // Effective positions already applied by the caller (session + drag previews)
  // — used only to position the dimension row below the group's union bounds.
  members: WallObjectBase[];
  // Precomputed spacing segments (neighbour-aware when idle, wall-edge during an
  // arrange session — the caller decides). Same shape either helper returns.
  segments: { fromMm: number; toMm: number }[];
  wallHeightMm: number;
  pixelsPerMm: number;
  unit: DisplayUnit;
}) {
  // Before the container has measured (or with no members) there's no scale
  // to size the annotations against — render nothing rather than divide by 0.
  if (members.length === 0 || pixelsPerMm <= 0) return null;

  const bounds = getGroupBounds(members);

  // The dimension line sits a fixed screen distance below the group; when the
  // group hangs low enough that the line would fall under the floor (negative
  // wall-local y), flip it above the group top by the same offset instead.
  const lineOffsetMm = 24 / pixelsPerMm;
  const belowYMm = bounds.centerYMm - bounds.heightMm / 2 - lineOffsetMm;
  const lineYMm =
    belowYMm < 0 ? bounds.centerYMm + bounds.heightMm / 2 + lineOffsetMm : belowYMm;
  const lineSvgY = wallLocalYToSvgY(wallHeightMm, lineYMm);

  const tickHalfMm = 5 / pixelsPerMm;
  const labelOffsetMm = 13 / pixelsPerMm;
  const rowSpacingMm = 12 / pixelsPerMm;
  const fontSizeMm = LABEL_FONT_PX / pixelsPerMm;

  // First pass: decide each label's row. Row 0 = centered under its own line
  // (only when the label estimably fits inside the segment); rows 1..N =
  // staggered below, packed greedily left-to-right so a label lands in the
  // first row where it clears the previous label placed there. Every segment
  // gets a label — margins that used to vanish now stagger instead of dropping.
  // rowRightPx[row] tracks the right screen-x extent of the last label in that
  // staggered row.
  const rowRightPx: number[] = [];
  const placements = segments.map((segment, index) => {
    const widthMm = segment.toMm - segment.fromMm;
    const isTiny = Math.abs(widthMm) < MIN_SEGMENT_MM;
    // A negative segment means neighbors overlap: the connecting line would be
    // misleading (it'd span backwards), so keep just the ticks. Sign is applied
    // by hand because formatLength's fraction paths aren't negative-safe.
    const isOverlap = widthMm < 0;
    const label = (isOverlap ? "-" : "") + formatLength(Math.abs(widthMm), { unit });
    const midMm = (segment.fromMm + segment.toMm) / 2;

    const segmentPx = Math.abs(widthMm) * pixelsPerMm;
    const labelWidthPx = label.length * LABEL_FONT_PX * LABEL_GLYPH_WIDTH_RATIO;
    const fits = segmentPx >= labelWidthPx + LABEL_FIT_SLACK_PX;

    const row = staggerLabelRow(rowRightPx, {
      fits,
      mid: midMm * pixelsPerMm,
      halfWidth: labelWidthPx / 2,
      gap: LABEL_ROW_GAP_PX,
      maxRow: MAX_STAGGER_ROW
    });

    return { segment, index, midMm, label, isTiny, isOverlap, row };
  });

  return (
    <g pointerEvents="none">
      {placements.map(({ segment, index, midMm, label, isTiny, isOverlap, row }) => {
        const labelY = lineSvgY + labelOffsetMm + row * rowSpacingMm;
        return (
          <g key={index}>
            {isOverlap || isTiny ? null : (
              <line
                className="dimension-line"
                x1={segment.fromMm}
                y1={lineSvgY}
                x2={segment.toMm}
                y2={lineSvgY}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <line
              className="dimension-tick"
              x1={segment.fromMm}
              y1={lineSvgY - tickHalfMm}
              x2={segment.fromMm}
              y2={lineSvgY + tickHalfMm}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="dimension-tick"
              x1={segment.toMm}
              y1={lineSvgY - tickHalfMm}
              x2={segment.toMm}
              y2={lineSvgY + tickHalfMm}
              vectorEffect="non-scaling-stroke"
            />
            {row > 0 ? (
              // A hairline leader from the segment's midpoint on the dimension
              // line down to its staggered label, so ownership stays clear when
              // the label can't sit directly under its own span.
              <line
                className="dimension-line"
                x1={midMm}
                y1={lineSvgY}
                x2={midMm}
                y2={labelY - fontSizeMm}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <text
              className="dimension-label"
              x={midMm}
              y={labelY}
              textAnchor="middle"
              style={{
                // Same constant-screen-size trick as .resize-handle-label:
                // font-size/stroke-width are SVG user units (mm), sized off the
                // live px-per-mm so the text and its halo hold a fixed on-screen
                // size at any zoom.
                fontSize: fontSizeMm,
                strokeWidth: fontSizeMm * 0.3
              }}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
