import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import {
  getArtworkRectSvg,
  type ArtworkCenterMm,
  type ArtworkSizeMm
} from "./elevationArtworkGeometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// Renders one wall shelf in elevation — the shelf counterpart to ElevationCase,
// reusing the same rect-geometry helper so a shelf, a case and an opening can
// never disagree about how a center + size maps to an SVG rect.
//
// Deliberately ONE mark: a solid slab band. A shelf seen head-on has no
// construction to show (shelfGlyphs.ts says the same about its plan glyph) —
// its whole job on this canvas is to state where the surface a work stands on
// is, so the band is filled rather than outlined, which is also what makes a
// work sitting on it read as supported rather than as overlapping it.
//
// It takes center + size (not the scene entry's x-span) for one reason: the
// live move-drag preview feeds a center straight in (previewCenterById), the
// same way it does for every other elevation object. ElevationView maps the
// scene's ElevationSceneShelf span onto this shape — the span is still where
// the geometry comes from, never recomputed here.
export function ElevationShelf({
  center,
  isGhost = false,
  isOutOfBounds = false,
  isSelected = false,
  isSnapTarget = false,
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
  // A work is currently captured on this slab's top face mid-drag: the surface
  // announces itself (petrol wash + stroke) so "standing on the shelf" is
  // visible on the shelf, not only inferable from a dashed line.
  isSnapTarget?: boolean;
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void;
  // Receives the click event so the caller can read modifier keys (shift/
  // cmd/ctrl) for additive multi-select, mirroring ElevationCase.
  onSelect?: (event: ReactMouseEvent<SVGGElement>) => void;
  size: ArtworkSizeMm;
  // Hover-tooltip body (see PlacementTooltip's ShelfTooltipContent).
  tooltip?: ReactNode;
  // Suppresses the tooltip while a drag is active — the Tooltip wrapper stays
  // mounted, only the content is withheld, so toggling never remounts the <g>.
  tooltipDisabled?: boolean;
  wallHeightMm: number;
}) {
  const rect = getArtworkRectSvg(wallHeightMm, center, size);

  const classNames = ["elevation-shelf"];
  if (isGhost) classNames.push("ghost");
  if (isOutOfBounds) classNames.push("out-of-bounds");
  if (isSelected) classNames.push("selected");
  if (isSnapTarget) classNames.push("snap-target");

  const shape = (
    <g
      className={classNames.join(" ")}
      onClick={isGhost ? undefined : onSelect}
      onPointerDown={isGhost ? undefined : onPointerDown}
    >
      <rect
        className="shelf-slab"
        height={rect.heightMm}
        vectorEffect="non-scaling-stroke"
        width={rect.widthMm}
        x={rect.xMm}
        y={rect.yMm}
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
