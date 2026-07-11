import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { OpeningWallObject } from "../../domain/project";
import { getArtworkRectSvg, type ArtworkCenterMm, type ArtworkSizeMm, type SvgRectMm } from "./elevationArtworkGeometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// Renders one door/window/blocked-zone placement — the opening counterpart
// to ElevationArtwork, reusing the same rect-geometry helper so an opening
// and an artwork can never disagree about how a center+size maps to an SVG
// rect. Each kind gets one small, restrained glyph layered on the outline
// rather than a busy illustration (docs/plan.md's "restrained, dense,
// task-focused" note): a door gets a corner swing-arc hint, a window gets a
// mullion cross, a blocked zone gets a diagonal hatch fill.
export function ElevationOpening({
  center,
  isGhost = false,
  isOutOfBounds = false,
  isSelected = false,
  kind,
  onPointerDown,
  onSelect,
  size,
  tooltip,
  tooltipDisabled = false,
  wallHeightMm,
  wallObjectId
}: {
  center: ArtworkCenterMm;
  isGhost?: boolean;
  isOutOfBounds?: boolean;
  isSelected?: boolean;
  kind: OpeningWallObject["kind"];
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void;
  // Receives the click event so the caller can read modifier keys (shift/
  // cmd/ctrl) for additive multi-select. Passed straight to onClick, which
  // already provides it.
  onSelect?: (event: ReactMouseEvent<SVGGElement>) => void;
  size: ArtworkSizeMm;
  // Hover-tooltip body (see PlacementTooltip): kind icon + label + dims.
  tooltip?: ReactNode;
  // Suppresses the tooltip while a drag is active. The Tooltip wrapper stays
  // mounted and only the content is withheld, so toggling this mid-drag never
  // remounts the <g> out from under a pointer sequence.
  tooltipDisabled?: boolean;
  wallHeightMm: number;
  wallObjectId: string;
}) {
  const rect = getArtworkRectSvg(wallHeightMm, center, size);

  const classNames = ["elevation-opening", `elevation-opening-${kind}`];
  if (isGhost) classNames.push("ghost");
  if (isOutOfBounds) classNames.push("out-of-bounds");
  if (isSelected) classNames.push("selected");

  const shape = (
    <g
      className={classNames.join(" ")}
      onClick={isGhost ? undefined : onSelect}
      onPointerDown={isGhost ? undefined : onPointerDown}
    >
      {kind === "blocked-zone" ? <BlockedZoneHatch rect={rect} wallObjectId={wallObjectId} /> : null}
      <rect
        className="opening-outline"
        height={rect.heightMm}
        vectorEffect="non-scaling-stroke"
        width={rect.widthMm}
        x={rect.xMm}
        y={rect.yMm}
      />
      {kind === "door" ? <DoorSwingHint rect={rect} /> : null}
      {kind === "window" ? <WindowMullions rect={rect} /> : null}
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

// A quarter-circle swing arc anchored at the bottom-left (hinge) corner —
// the familiar plan-view door glyph, borrowed here purely as an
// iconographic "this is a door" cue rather than a physically accurate
// elevation depiction (an elevation can't literally show swing depth, which
// happens along the axis perpendicular to the wall face).
function DoorSwingHint({ rect }: { rect: SvgRectMm }) {
  const radius = Math.min(rect.widthMm, rect.heightMm);
  const hingeXMm = rect.xMm;
  const hingeYMm = rect.yMm + rect.heightMm;

  return (
    <path
      className="door-swing"
      d={`M ${hingeXMm} ${hingeYMm - radius} A ${radius} ${radius} 0 0 1 ${hingeXMm + radius} ${hingeYMm}`}
      fill="none"
      vectorEffect="non-scaling-stroke"
    />
  );
}

// A single vertical + horizontal mullion through the middle of the sash —
// the simplest recognizable "cross" a window glyph needs, restrained
// rather than a full multi-pane grid.
function WindowMullions({ rect }: { rect: SvgRectMm }) {
  const midXMm = rect.xMm + rect.widthMm / 2;
  const midYMm = rect.yMm + rect.heightMm / 2;

  return (
    <g className="window-mullions">
      <line
        vectorEffect="non-scaling-stroke"
        x1={midXMm}
        x2={midXMm}
        y1={rect.yMm}
        y2={rect.yMm + rect.heightMm}
      />
      <line
        vectorEffect="non-scaling-stroke"
        x1={rect.xMm}
        x2={rect.xMm + rect.widthMm}
        y1={midYMm}
        y2={midYMm}
      />
    </g>
  );
}

// A per-instance pattern id keeps multiple blocked zones from colliding on
// the same <defs> id within one document.
function BlockedZoneHatch({ rect, wallObjectId }: { rect: SvgRectMm; wallObjectId: string }) {
  const patternId = `blocked-zone-hatch-${wallObjectId}`;

  return (
    <>
      <defs>
        <pattern
          height={60}
          id={patternId}
          patternUnits="userSpaceOnUse"
          width={60}
          patternTransform="rotate(45)"
        >
          <line className="blocked-zone-hatch-line" vectorEffect="non-scaling-stroke" x1="0" x2="0" y1="0" y2="60" />
        </pattern>
      </defs>
      <rect
        className="blocked-zone-fill"
        fill={`url(#${patternId})`}
        height={rect.heightMm}
        width={rect.widthMm}
        x={rect.xMm}
        y={rect.yMm}
      />
    </>
  );
}
