import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import { getArtworkRectSvg, type ArtworkCenterMm, type ArtworkSizeMm } from "./elevationArtworkGeometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// Renders one wall display case (vitrine) in elevation — the case counterpart
// to ElevationOpening, reusing the same rect-geometry helper so a case and an
// opening can never disagree about how a center+size maps to an SVG rect. The
// wall-face view is a solid side-profile box: an outer outline plus a thin
// inner inset that reads as the glass line, matching the restrained mark
// vocabulary the plan-view case glyph uses (PlanObject's plan-object--case).
export function ElevationCase({
  center,
  isGhost = false,
  isOutOfBounds = false,
  isSelected = false,
  onPointerDown,
  onSelect,
  size,
  tooltip,
  tooltipDisabled = false,
  wallHeightMm
}: {
  center: ArtworkCenterMm;
  isGhost?: boolean;
  isOutOfBounds?: boolean;
  isSelected?: boolean;
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void;
  // Receives the click event so the caller can read modifier keys (shift/
  // cmd/ctrl) for additive multi-select, mirroring ElevationOpening.
  onSelect?: (event: ReactMouseEvent<SVGGElement>) => void;
  size: ArtworkSizeMm;
  // Hover-tooltip body (see PlacementTooltip's CaseTooltipContent).
  tooltip?: ReactNode;
  // Suppresses the tooltip while a drag is active — the Tooltip wrapper stays
  // mounted, only the content is withheld, so toggling never remounts the <g>.
  tooltipDisabled?: boolean;
  wallHeightMm: number;
}) {
  const rect = getArtworkRectSvg(wallHeightMm, center, size);

  // The glass inset is a fixed fraction of the smaller edge, the same 0.22
  // ratio the plan-view case glyph uses, clamped so a thin case never inverts.
  const insetMm = Math.min(rect.widthMm, rect.heightMm) * 0.22;
  const insetWidthMm = Math.max(0, rect.widthMm - insetMm * 2);
  const insetHeightMm = Math.max(0, rect.heightMm - insetMm * 2);

  const classNames = ["elevation-case"];
  if (isGhost) classNames.push("ghost");
  if (isOutOfBounds) classNames.push("out-of-bounds");
  if (isSelected) classNames.push("selected");

  const shape = (
    <g
      className={classNames.join(" ")}
      onClick={isGhost ? undefined : onSelect}
      onPointerDown={isGhost ? undefined : onPointerDown}
    >
      <rect
        className="case-outline"
        height={rect.heightMm}
        vectorEffect="non-scaling-stroke"
        width={rect.widthMm}
        x={rect.xMm}
        y={rect.yMm}
      />
      <rect
        className="case-glass"
        height={insetHeightMm}
        vectorEffect="non-scaling-stroke"
        width={insetWidthMm}
        x={rect.xMm + insetMm}
        y={rect.yMm + insetMm}
      />
    </g>
  );

  if (!tooltip) return shape;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{shape}</TooltipTrigger>
      {tooltipDisabled ? null : <TooltipContent>{tooltip}</TooltipContent>}
    </Tooltip>
  );
}

// The elevation "shadow" of a freestanding FLOOR case standing in front of the
// wall: a non-interactive, low-opacity dashed outline rising from the floor
// (y=0) to the case's overall height, spanning the along-wall x-range its
// rotated plan footprint projects onto. Purely an alignment aid — it carries
// no selection/drag, and paints BEHIND the wall objects so it never occludes
// them. Its geometry comes straight from the scene's projectFloorCaseOntoWall.
export function ElevationFloorCaseGhost({
  wallHeightMm,
  xMinMm,
  xMaxMm,
  heightMm
}: {
  wallHeightMm: number;
  xMinMm: number;
  xMaxMm: number;
  heightMm: number;
}) {
  const widthMm = Math.max(0, xMaxMm - xMinMm);
  // Wall-local y is y-up from the floor; the ghost's top edge (heightMm) is the
  // smaller SVG y after the shared flip, its bottom edge sits on the floor line.
  const topSvgYMm = wallHeightMm - heightMm;

  return (
    <rect
      className="elevation-floor-case-ghost"
      height={heightMm}
      vectorEffect="non-scaling-stroke"
      width={widthMm}
      x={xMinMm}
      y={topSvgYMm}
    />
  );
}
