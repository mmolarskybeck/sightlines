import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import { computeWallTextSkeleton } from "../../../domain/scene2d/wallTextSkeleton";
import { getArtworkRectSvg, type ArtworkCenterMm, type ArtworkSizeMm } from "./elevationArtworkGeometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// A wall-mounted didactic text panel — a white rectangle with a hairline
// border and light-grey skeleton bars (the shadcn Skeleton look, drawn not
// imported). No real text: every wall text renders identically, only its size
// changes the bar layout (shared with the 3D panel and the PDF export via
// computeWallTextSkeleton). Styled with inline attributes rather than CSS
// classes so it needs no global.css rule; colors reference design tokens where
// possible and stay theme-aware.
const PANEL_FILL = "#ffffff";
const BAR_FILL = "#d4d4d4";
// Rounded bar ends: a fraction of bar height.
const BAR_RADIUS_RATIO = 0.5;

export function ElevationWallText({
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
  onSelect?: (event: ReactMouseEvent<SVGGElement>) => void;
  size: ArtworkSizeMm;
  tooltip?: ReactNode;
  tooltipDisabled?: boolean;
  wallHeightMm: number;
}) {
  const rect = getArtworkRectSvg(wallHeightMm, center, size);
  const skeleton = computeWallTextSkeleton(size.widthMm, size.heightMm);

  const borderColor = isOutOfBounds
    ? "var(--danger)"
    : isSelected
      ? "var(--selection)"
      : "var(--muted)";
  const borderWidth = isSelected || isOutOfBounds ? 2 : 1.15;

  const shape = (
    <g
      onClick={isGhost ? undefined : onSelect}
      onPointerDown={isGhost ? undefined : onPointerDown}
      opacity={isGhost ? 0.75 : 1}
      style={{ cursor: isGhost ? "default" : "grab" }}
    >
      <rect
        fill={PANEL_FILL}
        height={rect.heightMm}
        stroke={borderColor}
        strokeDasharray={isGhost ? "6 5" : undefined}
        strokeWidth={borderWidth}
        vectorEffect="non-scaling-stroke"
        width={rect.widthMm}
        x={rect.xMm}
        y={rect.yMm}
      />
      {skeleton.bars.map((bar, index) => {
        const barHeightMm = rect.heightMm * bar.heightFrac;
        return (
          <rect
            key={index}
            fill={BAR_FILL}
            height={barHeightMm}
            rx={barHeightMm * BAR_RADIUS_RATIO}
            width={rect.widthMm * bar.widthFrac}
            x={rect.xMm + rect.widthMm * bar.xFrac}
            y={rect.yMm + rect.heightMm * bar.yFrac}
          />
        );
      })}
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
