import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { PlanRect } from "../../domain/geometry/planObjects";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// Renders one placed object (wall-anchored door/window/blocked-zone, or a
// floor-placed artwork/blocked-zone) as a thin rect in plan view — the plan
// counterpart to ElevationOpening/ElevationArtwork, reusing the same
// restrained stroke-only visual language (no fill illustration) so a plan
// rect and its elevation placement read as the same object.
export function PlanObject({
  isFloorPlaced = false,
  isGhost = false,
  isSelected = false,
  kind,
  onBeginDrag,
  onSelect,
  planRect,
  tooltip,
  tooltipDisabled = false
}: {
  isFloorPlaced?: boolean;
  // A click-to-place (or drop) preview: non-interactive, translucent,
  // dashed — same convention as ElevationArtwork's `isGhost`.
  isGhost?: boolean;
  isSelected?: boolean;
  kind: "door" | "window" | "blocked-zone" | "artwork";
  // Starts a pointer-drag move of this object (PlanView owns the live preview
  // + commit-on-release). A click without real movement still falls through to
  // onSelect — the drag release is a no-op below its movement threshold.
  onBeginDrag?: (event: ReactPointerEvent<SVGGElement>) => void;
  onSelect?: () => void;
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

  const x = planRect.centerXMm - planRect.widthMm / 2;
  const y = planRect.centerYMm - planRect.depthMm / 2;

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
              onSelect?.();
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
      <rect
        className="plan-object-outline"
        height={planRect.depthMm}
        vectorEffect="non-scaling-stroke"
        width={planRect.widthMm}
        x={x}
        y={y}
      />
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
