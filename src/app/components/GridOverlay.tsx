import type { DisplayUnit } from "../../domain/project";

// Temporary fixed interval: 1ft for imperial units, 50cm for metric.
// Replaced by the shared precision system (docs/plan.md §5.5) once built.
export function getGridSpacingMm(unit: DisplayUnit): number {
  return unit === "cm" || unit === "m" ? 500 : 304.8;
}

export function GridOverlay({
  height,
  id,
  spacingMm,
  width,
  x,
  y
}: {
  height: number;
  id: string;
  spacingMm: number;
  width: number;
  x: number;
  y: number;
}) {
  const majorSpacingMm = spacingMm * 4;

  return (
    <>
      <defs>
        <pattern
          id={`${id}-minor`}
          width={spacingMm}
          height={spacingMm}
          patternUnits="userSpaceOnUse"
        >
          <path
            className="grid-line minor"
            d={`M ${spacingMm} 0 L 0 0 0 ${spacingMm}`}
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
        <pattern
          id={`${id}-major`}
          width={majorSpacingMm}
          height={majorSpacingMm}
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
