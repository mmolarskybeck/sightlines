export function GridOverlay({
  height,
  id,
  majorSpacingMm,
  minorSpacingMm,
  width,
  x,
  y
}: {
  height: number;
  id: string;
  majorSpacingMm: number;
  minorSpacingMm: number;
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
