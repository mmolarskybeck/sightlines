import type { KeyboardEvent, PointerEvent } from "react";
import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";

export type MeasurementPoint = {
  xMm: number;
  yMm: number;
};

export type MeasurementEndpoint = "a" | "b";

export type MeasurementOverlayProps = {
  a: MeasurementPoint;
  b: MeasurementPoint;
  unit: DisplayUnit;
  /** Screen scale used only to keep labels, handles, and hit targets constant in pixels. */
  pixelsPerMm: number;
  selected?: boolean;
  snappedEndpoint?: MeasurementEndpoint | null;
  onBodyPointerDown?: (event: PointerEvent<SVGLineElement>) => void;
  onEndpointPointerDown?: (
    endpoint: MeasurementEndpoint,
    event: PointerEvent<SVGCircleElement>
  ) => void;
  onEndpointKeyDown?: (
    endpoint: MeasurementEndpoint,
    event: KeyboardEvent<SVGCircleElement>
  ) => void;
};

/**
 * Interaction chrome for a temporary model-space measurement.
 *
 * Coordinates are already expressed in the SVG's model space. Plan can pass
 * floor coordinates directly; Elevation should apply its shared wall-local
 * y-to-SVG conversion before rendering. The component never stores viewport
 * pixels or mutates project data.
 */
export function MeasurementOverlay({
  a,
  b,
  unit,
  pixelsPerMm,
  selected = true,
  snappedEndpoint = null,
  onBodyPointerDown,
  onEndpointPointerDown,
  onEndpointKeyDown
}: MeasurementOverlayProps) {
  if (pixelsPerMm <= 0) return null;

  const dx = b.xMm - a.xMm;
  const dy = b.yMm - a.yMm;
  const distanceMm = Math.hypot(dx, dy);
  const distanceLabel = formatLength(distanceMm, { unit });
  const midX = (a.xMm + b.xMm) / 2;
  const midY = (a.yMm + b.yMm) / 2;
  const length = distanceMm || 1;
  const labelOffsetMm = 14 / pixelsPerMm;
  const labelX = midX + (-dy / length) * labelOffsetMm;
  const labelY = midY + (dx / length) * labelOffsetMm;
  const arrowLengthMm = 11 / pixelsPerMm;
  const arrowHalfWidthMm = 4.5 / pixelsPerMm;
  const haloRadiusMm = 9 / pixelsPerMm;
  const handleHitRadiusMm = 22 / pixelsPerMm;
  const bodyHitWidthMm = 14 / pixelsPerMm;
  const fontSizeMm = 11 / pixelsPerMm;
  const description = `Measurement, ${distanceLabel}`;

  const handle = (endpoint: MeasurementEndpoint, point: MeasurementPoint) => {
    const snapped = snappedEndpoint === endpoint;
    const endpointName = endpoint === "a" ? "start" : "end";
    // The tip is the stored endpoint exactly. Its wings sit inside the
    // measured span, so both arrows face outward without shortening or
    // visually shifting the measurement line.
    const inwardX = endpoint === "a" ? dx / length : -dx / length;
    const inwardY = endpoint === "a" ? dy / length : -dy / length;
    const baseX = point.xMm + inwardX * arrowLengthMm;
    const baseY = point.yMm + inwardY * arrowLengthMm;
    const perpendicularX = -inwardY * arrowHalfWidthMm;
    const perpendicularY = inwardX * arrowHalfWidthMm;
    const arrowPoints = [
      `${point.xMm},${point.yMm}`,
      `${baseX + perpendicularX},${baseY + perpendicularY}`,
      `${baseX - perpendicularX},${baseY - perpendicularY}`
    ].join(" ");
    return (
      <g className="measurement-endpoint" data-endpoint={endpoint} data-snapped={snapped || undefined}>
        <circle
          aria-hidden="true"
          className="measurement-handle-halo"
          cx={point.xMm}
          cy={point.yMm}
          r={haloRadiusMm}
        />
        <circle
          aria-label={`Measurement ${endpointName} point, ${distanceLabel}`}
          className="measurement-handle-hit"
          cx={point.xMm}
          cy={point.yMm}
          r={handleHitRadiusMm}
          role="button"
          data-owns-arrow-keys=""
          tabIndex={selected ? 0 : -1}
          onKeyDown={(event) => onEndpointKeyDown?.(endpoint, event)}
          onPointerDown={(event) => {
            event.stopPropagation();
            onEndpointPointerDown?.(endpoint, event);
          }}
        />
        <polygon
          aria-hidden="true"
          className="measurement-handle"
          points={arrowPoints}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  };

  return (
    <g
      aria-label={description}
      className={selected ? "measurement-overlay selected" : "measurement-overlay"}
      data-selected={selected || undefined}
      role="group"
    >
      <line
        aria-label={`Select ${description.toLowerCase()}`}
        className="measurement-line-hit"
        x1={a.xMm}
        y1={a.yMm}
        x2={b.xMm}
        y2={b.yMm}
        role="button"
        tabIndex={selected ? 0 : -1}
        style={{ strokeWidth: bodyHitWidthMm, pointerEvents: selected ? "stroke" : "none" }}
        onPointerDown={(event) => {
          event.stopPropagation();
          onBodyPointerDown?.(event);
        }}
      />
      <line
        aria-hidden="true"
        className="measurement-line"
        x1={a.xMm}
        y1={a.yMm}
        x2={b.xMm}
        y2={b.yMm}
        vectorEffect="non-scaling-stroke"
      />
      <text
        aria-hidden="true"
        className="measurement-label"
        dominantBaseline="middle"
        textAnchor="middle"
        x={labelX}
        y={labelY}
        style={{ fontSize: fontSizeMm, strokeWidth: fontSizeMm * 0.3 }}
      >
        {distanceLabel}
      </text>
      {selected ? (
        <>
          {handle("a", a)}
          {handle("b", b)}
        </>
      ) : null}
    </g>
  );
}
