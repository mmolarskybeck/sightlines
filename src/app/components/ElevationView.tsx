import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { GridOverlay, getGridSpacingMm } from "./GridOverlay";

// Wall-local coordinates are y-up from the floor (docs/plan.md §2); SVG is
// y-down from the top. Every elevation drawing goes through this one flip.
export function wallLocalYToSvgY(wallHeightMm: number, yMm: number): number {
  return wallHeightMm - yMm;
}

export function ElevationView({
  gridVisible,
  wallName,
  wallLengthMm,
  wallHeightMm,
  centerlineMm,
  unit
}: {
  gridVisible: boolean;
  wallName: string;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  unit: DisplayUnit;
}) {
  const viewBox = `0 0 ${wallLengthMm} ${wallHeightMm}`;
  const gridSpacingMm = getGridSpacingMm(unit);
  const centerlineSvgY = wallLocalYToSvgY(wallHeightMm, centerlineMm);

  return (
    <div className="drawing-surface" aria-label="Wall elevation view">
      <div className="surface-label">
        <strong>{wallName}</strong>
        <span>
          {formatLength(wallLengthMm, { unit })} by{" "}
          {formatLength(wallHeightMm, { unit })}
        </span>
      </div>
      <svg className="elevation-svg" viewBox={viewBox} role="img">
        <title>{wallName} elevation</title>
        <rect className="wall-fill" x="0" y="0" width={wallLengthMm} height={wallHeightMm} />
        {gridVisible ? (
          <GridOverlay
            id="elevation-grid"
            height={wallHeightMm}
            spacingMm={gridSpacingMm}
            width={wallLengthMm}
            x={0}
            y={0}
          />
        ) : null}
        <line
          className="centerline"
          x1="0"
          y1={centerlineSvgY}
          x2={wallLengthMm}
          y2={centerlineSvgY}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
