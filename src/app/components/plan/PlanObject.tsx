import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// Renders one placed object (wall-anchored door/window/blocked-zone, or a
// floor-placed artwork/blocked-zone) as a thin rect in plan view — the plan
// counterpart to ElevationOpening/ElevationArtwork, reusing the same
// restrained stroke-only visual language (no fill illustration) so a plan
// rect and its elevation placement read as the same object.
export function PlanObject({
  hitMinSizeMm = 0,
  isFloorPlaced = false,
  isGhost = false,
  isInvalid = false,
  isSelected = false,
  kind,
  onBeginDrag,
  onSelect,
  planRect,
  tooltip,
  tooltipDisabled = false
}: {
  // Floor of the invisible hit rect on both axes, in model mm — keeps small
  // (esp. thin wall) objects clickable at any zoom. Ghosts never get one.
  hitMinSizeMm?: number;
  isFloorPlaced?: boolean;
  // A click-to-place (or drop) preview: non-interactive, translucent,
  // dashed — same convention as ElevationArtwork's `isGhost`.
  isGhost?: boolean;
  // The current preview position can't commit (a wall-only artwork dragged/
  // dropped off every wall): paints the danger token. Overrides selection/ghost
  // strokes — the refusal must read regardless of the object's other state.
  isInvalid?: boolean;
  isSelected?: boolean;
  kind: "door" | "window" | "blocked-zone" | "artwork";
  // Starts a pointer-drag move of this object (PlanView owns the live preview
  // + commit-on-release). A click without real movement still falls through to
  // onSelect — the drag release is a no-op below its movement threshold.
  onBeginDrag?: (event: ReactPointerEvent<SVGGElement>) => void;
  // Receives the click event so the caller can read modifier keys (shift/
  // cmd/ctrl) for additive multi-select.
  onSelect?: (event: ReactMouseEvent<SVGGElement>) => void;
  planRect: PlanRect;
  // Hover-tooltip body (see PlacementTooltip). Ghosts never get one.
  tooltip?: ReactNode;
  // Suppresses the tooltip while a drag or armed placement tool is active.
  // The Tooltip wrapper stays mounted and only the content is withheld, so
  // toggling this mid-drag never remounts the <g> out from under a
  // pointer-capture sequence.
  tooltipDisabled?: boolean;
}) {
  const classNames = ["plan-object", `plan-object--${kind}`];
  if (isFloorPlaced) classNames.push("is-floor");
  if (isSelected) classNames.push("is-selected");
  if (isGhost) classNames.push("is-ghost");
  if (isInvalid) classNames.push("is-invalid");

  const x = planRect.centerXMm - planRect.widthMm / 2;
  const y = planRect.centerYMm - planRect.depthMm / 2;
  const rightX = x + planRect.widthMm;
  const bottomY = y + planRect.depthMm;
  const midX = planRect.centerXMm;
  const midY = planRect.centerYMm;
  const insetMm = Math.min(planRect.widthMm, planRect.depthMm) * 0.22;
  const insetWidthMm = Math.max(0, planRect.widthMm - insetMm * 2);
  const insetDepthMm = Math.max(0, planRect.depthMm - insetMm * 2);
  const hatchRunMm = Math.min(planRect.widthMm, planRect.depthMm);
  const hitWidthMm = Math.max(planRect.widthMm, hitMinSizeMm);
  const hitDepthMm = Math.max(planRect.depthMm, hitMinSizeMm);

  const shape = (
    <g
      className={classNames.join(" ")}
      onClick={
        isGhost
          ? undefined
          : (event) => {
              // Selecting a plan object must not also trigger whatever the plan
              // background does on click (there's none today, but this keeps the
              // click scoped to the object the way ElevationView's placements do).
              event.stopPropagation();
              onSelect?.(event);
            }
      }
      onPointerDown={
        isGhost
          ? undefined
          : (event) => {
              event.stopPropagation();
              onBeginDrag?.(event);
            }
      }
      transform={`rotate(${planRect.angleDeg} ${planRect.centerXMm} ${planRect.centerYMm})`}
    >
      {isGhost ? null : (
        <rect
          className="plan-object-hit"
          height={hitDepthMm}
          width={hitWidthMm}
          x={planRect.centerXMm - hitWidthMm / 2}
          y={planRect.centerYMm - hitDepthMm / 2}
        />
      )}
      <rect
        className="plan-object-outline"
        height={planRect.depthMm}
        vectorEffect="non-scaling-stroke"
        width={planRect.widthMm}
        x={x}
        y={y}
      />
      {kind === "artwork" ? (
        <rect
          className="plan-object-mark plan-object-mark--artwork"
          height={insetDepthMm}
          vectorEffect="non-scaling-stroke"
          width={insetWidthMm}
          x={x + insetMm}
          y={y + insetMm}
        />
      ) : null}
      {kind === "door" ? (
        <path
          className="plan-object-mark plan-object-mark--door"
          d={`M ${x} ${bottomY} L ${x} ${y} L ${rightX} ${bottomY}`}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {kind === "window" ? (
        <g className="plan-object-mark plan-object-mark--window">
          <line
            vectorEffect="non-scaling-stroke"
            x1={x}
            x2={rightX}
            y1={midY}
            y2={midY}
          />
          <line
            vectorEffect="non-scaling-stroke"
            x1={midX}
            x2={midX}
            y1={y}
            y2={bottomY}
          />
        </g>
      ) : null}
      {kind === "blocked-zone" ? (
        <g className="plan-object-mark plan-object-mark--blocked-zone">
          <line
            vectorEffect="non-scaling-stroke"
            x1={x}
            x2={x + hatchRunMm}
            y1={bottomY}
            y2={y}
          />
          <line
            vectorEffect="non-scaling-stroke"
            x1={midX - hatchRunMm / 2}
            x2={midX + hatchRunMm / 2}
            y1={bottomY}
            y2={y}
          />
          <line
            vectorEffect="non-scaling-stroke"
            x1={rightX - hatchRunMm}
            x2={rightX}
            y1={bottomY}
            y2={y}
          />
        </g>
      ) : null}
    </g>
  );

  if (!tooltip || isGhost) return shape;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{shape}</TooltipTrigger>
      {tooltipDisabled ? null : <TooltipContent>{tooltip}</TooltipContent>}
    </Tooltip>
  );
}
