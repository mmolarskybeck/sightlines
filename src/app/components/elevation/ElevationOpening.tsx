import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { OpeningWallObject } from "../../../domain/project";
import { doorElevationGlyph } from "../../../domain/geometry/doorGlyphs";
import { getArtworkRectSvg, type ArtworkCenterMm, type ArtworkSizeMm, type SvgRectMm } from "./elevationArtworkGeometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// Renders one door/window/blocked-zone placement — the opening counterpart
// to ElevationArtwork, reusing the same rect-geometry helper so an opening
// and an artwork can never disagree about how a center+size maps to an SVG
// rect. Each kind gets one small, restrained glyph layered on the outline
// rather than a busy illustration (docs/plan.md's "restrained, dense,
// task-focused" note): a window gets a mullion cross, a blocked zone gets a
// diagonal hatch fill. A plain doorway (no `leaf`) still gets nothing but the
// outline — it is a void, not a hinged door (the 3D view builds it as one),
// so there is no leaf to draw. A HINGED door draws an inset leaf panel + a
// latch-side knob (doorElevationGlyph) but deliberately still no swing: an
// elevation cannot honestly show swing DEPTH, which was the exact objection
// that removed the old unconditional swing arc (commit a1ebe03). The leaf
// glyph only asserts what an elevation actually can show — which stile is
// hinged — nothing about how far the door opens.
export function ElevationOpening({
  center,
  isGhost = false,
  isOutOfBounds = false,
  isSelected = false,
  kind,
  leaf,
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
  // Present only for a hinged door (DoorWallObject.leaf). Deliberately just
  // `hingeAtStart` — NOT `swingsToLeft` — per the no-swing-in-elevation rule
  // above; `hingeAtStart` maps straight through to the glyph with no mirror,
  // because getArtworkRectSvg (elevationScene.ts) already maps wall-local x
  // straight through from the authored start, and each half of a shared door
  // is drawn on its own wall with its own local x.
  leaf?: { hingeAtStart: boolean };
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
  // showMarks: false (a door too narrow/short for its own reveal inset, the
  // caseGlyphs includeLegs precedent) draws only the plain outline, exactly
  // like a doorway with no leaf at all.
  const doorGlyph =
    kind === "door" && leaf
      ? doorElevationGlyph({ widthMm: rect.widthMm, heightMm: rect.heightMm, hingeAtStart: leaf.hingeAtStart })
      : undefined;

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
      {kind === "window" ? <WindowMullions rect={rect} /> : null}
      {doorGlyph?.showMarks ? <DoorLeaf glyph={doorGlyph} rect={rect} /> : null}
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

// The hinged-door leaf: an inset panel (doorElevationGlyph.leafRect) plus a
// knob dot on the latch side (doorElevationGlyph.knob), both already in the
// SAME top-left/y-down frame as `rect` — doorGlyphs.ts's elevation glyph is
// documented to originate at the opening's top-left for exactly this reason,
// so no flip is needed here (contrast the plan glyph, which is local-centered
// and needs the midX/midY recentering PlanObject.tsx does).
function DoorLeaf({
  glyph,
  rect
}: {
  glyph: ReturnType<typeof doorElevationGlyph>;
  rect: SvgRectMm;
}) {
  return (
    <g className="door-leaf-group">
      <rect
        className="door-leaf"
        height={glyph.leafRect.heightMm}
        vectorEffect="non-scaling-stroke"
        width={glyph.leafRect.widthMm}
        x={rect.xMm + glyph.leafRect.xMm}
        y={rect.yMm + glyph.leafRect.yMm}
      />
      {glyph.knob ? (
        <circle
          className="door-knob"
          cx={rect.xMm + glyph.knob.cxMm}
          cy={rect.yMm + glyph.knob.cyMm}
          r={glyph.knob.radiusMm}
        />
      ) : null}
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
