import { getWallsWithGeometry, outwardWallNormal } from "../../../domain/geometry/walls";
import type { DisplayUnit, RoomPlacement } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";

// Live length readouts during a room drag, one rule for every gesture: a
// number sits on the wall it measures. PlanView diffs the drag preview
// against the committed room (changedWallLengthIds) and hands the walls whose
// lengths are changing down here; each shows its CURRENT length at its own
// midpoint, outside the room. The handles themselves show nothing.
// `placement` is the previewed one (displayedProject), so wall lengths here
// are already the live in-drag values — no drag math in this component.
export function WallLengthLabels({
  changedWallIds,
  handleSizeMm,
  invalid,
  placement,
  unit
}: {
  changedWallIds: string[];
  handleSizeMm: number;
  // The in-flight drag would not commit (non-simple polygon etc.) — the
  // labels read in the danger token alongside the chips and outline.
  invalid: boolean;
  placement: RoomPlacement;
  unit: DisplayUnit;
}) {
  if (handleSizeMm <= 0 || changedWallIds.length === 0) return null;

  const changed = new Set(changedWallIds);
  const walls = getWallsWithGeometry(placement.room).filter((wall) => changed.has(wall.id));
  // Far enough out to clear the wall stroke and any chip sitting on the
  // midpoint — the same offset the old at-handle labels used.
  const labelOffsetMm = handleSizeMm * 4.5;

  return (
    <g>
      {walls.map((wall) => {
        const midXMm = (wall.start.xMm + wall.end.xMm) / 2;
        const midYMm = (wall.start.yMm + wall.end.yMm) / 2;
        const outward = outwardWallNormal(placement.room, wall);
        const xMm = midXMm + outward.xMm * labelOffsetMm + placement.offsetXMm;
        const yMm = midYMm + outward.yMm * labelOffsetMm + placement.offsetYMm;

        return (
          <text
            className="resize-handle-label"
            dominantBaseline="middle"
            key={wall.id}
            textAnchor="middle"
            x={xMm}
            y={yMm}
            style={{
              // font-size/stroke-width are in SVG user units (mm), not CSS px,
              // since this SVG's viewBox already scales content to fit —
              // sizing off handleSizeMm (itself screen-px-per-mm-derived)
              // keeps the label a constant on-screen size at any room scale,
              // the same trick vector-effect="non-scaling-stroke" does for
              // wall strokes.
              fontSize: handleSizeMm * 1.8,
              strokeWidth: handleSizeMm * 0.5,
              ...(invalid ? { fill: "var(--danger)" } : {})
            }}
          >
            {formatLength(wall.lengthMm, { unit })}
          </text>
        );
      })}
    </g>
  );
}
