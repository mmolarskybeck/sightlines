import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { Dimensions } from "../../domain/project";
import { getArtworkRectSvg, type ArtworkCenterMm, type ArtworkSizeMm } from "./elevationArtworkGeometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// One placement's visual, reused for both a real (persisted) placement and
// the transient drop/drag ghost — a ghost is just a non-interactive instance
// of the same rect+image with a `ghost` class, so the two can never drift
// into visually disagreeing about size or position (they already can't
// disagree numerically, since both go through the same
// resolveArtworkSnap call — see ElevationView).
export function ElevationArtwork({
  center,
  dimensionStatus,
  imageUrl,
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
  // Undefined (e.g. the library record went missing) is treated the same as
  // "unknown" — no dimension data is exactly as uncertain as explicitly
  // unknown data.
  dimensionStatus?: Dimensions["status"];
  imageUrl?: string;
  isGhost?: boolean;
  isOutOfBounds?: boolean;
  isSelected?: boolean;
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void;
  onSelect?: () => void;
  size: ArtworkSizeMm;
  // Hover-tooltip body (see PlacementTooltip); elevation passes title/artist/
  // dims but no thumbnail — the artwork itself is already visible. Ghosts
  // never get one.
  tooltip?: ReactNode;
  // Suppresses the tooltip while a drag is active. The Tooltip wrapper stays
  // mounted and only the content is withheld, so toggling this mid-drag never
  // remounts the <g> out from under a pointer sequence.
  tooltipDisabled?: boolean;
  wallHeightMm: number;
}) {
  const rect = getArtworkRectSvg(wallHeightMm, center, size);
  const uncertain = !isGhost && dimensionStatus !== undefined && dimensionStatus !== "known";

  const classNames = ["elevation-artwork"];
  if (isGhost) classNames.push("ghost");
  if (uncertain) classNames.push("uncertain", dimensionStatus ?? "unknown");
  if (isOutOfBounds) classNames.push("out-of-bounds");
  if (isSelected) classNames.push("selected");

  const shape = (
    <g
      className={classNames.join(" ")}
      onClick={isGhost ? undefined : onSelect}
      onPointerDown={isGhost ? undefined : onPointerDown}
    >
      {imageUrl ? (
        // "meet", never "slice" — cropping real artwork to fill the rect
        // would misrepresent it. A mismatched aspect ratio letterboxes
        // inside the true-dimension rect instead, which the outline below
        // keeps visible regardless.
        <image
          className="elevation-artwork-image"
          height={rect.heightMm}
          href={imageUrl}
          preserveAspectRatio="xMidYMid meet"
          width={rect.widthMm}
          x={rect.xMm}
          y={rect.yMm}
        />
      ) : null}
      <rect
        className="artwork-outline"
        height={rect.heightMm}
        vectorEffect="non-scaling-stroke"
        width={rect.widthMm}
        x={rect.xMm}
        y={rect.yMm}
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
