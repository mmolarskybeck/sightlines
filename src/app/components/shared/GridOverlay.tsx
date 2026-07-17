import { getGridPatternPhaseMm } from "../../../domain/units/precision";

// A drafting-style two-tier line grid: pale hairlines at the minor interval,
// heavier landmark lines at the major interval. Both tiers tile in userspace
// so the lattice stays continuous under any rect placement.
export function GridOverlay({
  height,
  id,
  majorSpacingMm,
  minorSpacingMm,
  originXMm = 0,
  originYMm = 0,
  width,
  x,
  y
}: {
  height: number;
  id: string;
  majorSpacingMm: number;
  minorSpacingMm: number;
  // Geometry-space point the grid should be anchored to (docs/plan.md
  // §5.5), not the screen/viewport origin. Defaults to (0, 0) so callers
  // that don't pass these (e.g. PlanView's world-origin floor grid) keep
  // tiling straight from userspace (0,0), unchanged.
  originXMm?: number;
  originYMm?: number;
  width: number;
  x: number;
  y: number;
}) {
  return (
    <>
      <defs>
        <pattern
          id={`${id}-minor`}
          width={minorSpacingMm}
          height={minorSpacingMm}
          x={getGridPatternPhaseMm(originXMm, minorSpacingMm)}
          y={getGridPatternPhaseMm(originYMm, minorSpacingMm)}
          patternUnits="userSpaceOnUse"
        >
          <path
            className="grid-line minor"
            d={`M ${minorSpacingMm} 0 L 0 0 0 ${minorSpacingMm}`}
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
        <pattern
          id={`${id}-major`}
          width={majorSpacingMm}
          height={majorSpacingMm}
          x={getGridPatternPhaseMm(originXMm, majorSpacingMm)}
          y={getGridPatternPhaseMm(originYMm, majorSpacingMm)}
          patternUnits="userSpaceOnUse"
        >
          <path
            className="grid-line major"
            d={`M ${majorSpacingMm} 0 L 0 0 0 ${majorSpacingMm}`}
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
      </defs>
      <rect
        className="grid-fill"
        fill={`url(#${id}-minor)`}
        x={x}
        y={y}
        width={width}
        height={height}
      />
      <rect
        className="grid-fill"
        fill={`url(#${id}-major)`}
        x={x}
        y={y}
        width={width}
        height={height}
      />
    </>
  );
}
