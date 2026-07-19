import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import { getArtworkRectSvg, type ArtworkCenterMm, type ArtworkSizeMm } from "./elevationArtworkGeometry";
import {
  CASE_GLASS_THICKNESS_MM,
  CASE_WALL_THICKNESS_MM
} from "../../../domain/project";
import {
  caseElevationGlyph,
  caseFloorGhostGlyph
} from "../../../domain/geometry/caseGlyphs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// px → mm at the current zoom, or 0 with no zoom context (pixelsPerMm
// absent/0) — see PlanObject.tsx's identical helper for the rationale.
function mmForPx(pixelsPerMm: number, px: number): number {
  return pixelsPerMm > 0 ? px / pixelsPerMm : 0;
}

function clampMm(pixelsPerMm: number, realMm: number, minPx: number, maxMm: number): number {
  return Math.min(Math.max(realMm, mmForPx(pixelsPerMm, minPx)), maxMm);
}

// Renders one wall display case (vitrine) in elevation — the case counterpart
// to ElevationOpening, reusing the same rect-geometry helper so a case and an
// opening can never disagree about how a center+size maps to an SVG rect. The
// wall-face view echoes the true 3D construction (CaseMesh.tsx's wall-case
// tray) instead of a generic concentric double-rect: a glass-lid line inset
// between the side walls and a bottom slab line — matching the honest-geometry
// plan glyph (PlanObject's plan-object--case).
export function ElevationCase({
  center,
  isGhost = false,
  isOutOfBounds = false,
  isSelected = false,
  onPointerDown,
  onSelect,
  pixelsPerMm = 0,
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
  // Current elevation zoom (screen px per model mm) — clamps the construction
  // marks to stay legible. Absent/0 (export paths, tests) means real mm.
  pixelsPerMm?: number;
  size: ArtworkSizeMm;
  // Hover-tooltip body (see PlacementTooltip's CaseTooltipContent).
  tooltip?: ReactNode;
  // Suppresses the tooltip while a drag is active — the Tooltip wrapper stays
  // mounted, only the content is withheld, so toggling never remounts the <g>.
  tooltipDisabled?: boolean;
  wallHeightMm: number;
}) {
  const rect = getArtworkRectSvg(wallHeightMm, center, size);

  // Side-wall thickness the glass lid is inset within — stopping short of the
  // corners (rather than a full-width line) is what kills the double-rect
  // read the old concentric inset had.
  const wallT = clampMm(pixelsPerMm, CASE_WALL_THICKNESS_MM, 2, rect.widthMm * 0.35);
  const glassBandMm = clampMm(pixelsPerMm, CASE_GLASS_THICKNESS_MM, 1.5, rect.heightMm * 0.25);
  const slabBandMm = clampMm(pixelsPerMm, CASE_WALL_THICKNESS_MM, 2, rect.heightMm * 0.25);
  // The construction (which marks exist, where) lives in the shared glyph
  // module in local mm; the zoom-clamped insets above are passed in so the
  // screen stays legible while the PDF export can reuse the same structure.
  const glyph = caseElevationGlyph({
    widthMm: rect.widthMm,
    heightMm: rect.heightMm,
    sideInsetMm: wallT,
    glassBandMm,
    slabBandMm
  });
  const glassLidYMm = rect.yMm + glyph.glassLid.yMm;
  const slabLineYMm = rect.yMm + glyph.slab.yMm;
  const lidX1Mm = rect.xMm + glyph.glassLid.x1Mm;
  const lidX2Mm = rect.xMm + glyph.glassLid.x2Mm;
  const showMarks = glyph.showMarks;

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
      {showMarks ? (
        <>
          <line
            className="case-glass"
            vectorEffect="non-scaling-stroke"
            x1={lidX1Mm}
            x2={lidX2Mm}
            y1={glassLidYMm}
            y2={glassLidYMm}
          />
          <line
            className="case-slab"
            vectorEffect="non-scaling-stroke"
            x1={rect.xMm}
            x2={rect.xMm + rect.widthMm}
            y1={slabLineYMm}
            y2={slabLineYMm}
          />
        </>
      ) : null}
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

  // The shared glyph module owns the box/slab/leg structure incl. the
  // legs-appear threshold; y is local (down from the ghost's top), mapped into
  // SVG space by adding topSvgYMm below.
  const glyph = caseFloorGhostGlyph({ widthMm, heightMm });

  // Below the legs threshold there's no room for legs: fall back to the plain
  // silhouette rect exactly as before rather than drawing degenerate marks.
  if (!glyph.hasLegs) {
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

  const glassBoxHeightMm = glyph.glassBox.heightMm;
  const slabLineYMm = topSvgYMm + glyph.slabYMm;
  // Only two legs (not four): the projected extent from
  // projectFloorCaseOntoWall is a 1D along-wall range, so a rotated case's
  // exact leg x-positions aren't recoverable here — these two lines are an
  // alignment approximation, inset CASE_LEG_INSET_MM from each edge of the
  // projected extent (clamped inside it on a narrow projection).
  const legXStartMm = xMinMm + glyph.legs[0]!.xMm;
  const legXEndMm = xMinMm + glyph.legs[1]!.xMm;

  return (
    <g className="elevation-floor-case-ghost">
      <rect
        className="floor-case-ghost-glass-box"
        height={glassBoxHeightMm}
        vectorEffect="non-scaling-stroke"
        width={widthMm}
        x={xMinMm}
        y={topSvgYMm}
      />
      <line
        className="floor-case-ghost-slab"
        vectorEffect="non-scaling-stroke"
        x1={xMinMm}
        x2={xMaxMm}
        y1={slabLineYMm}
        y2={slabLineYMm}
      />
      <line
        className="floor-case-ghost-leg"
        vectorEffect="non-scaling-stroke"
        x1={legXStartMm}
        x2={legXStartMm}
        y1={slabLineYMm}
        y2={wallHeightMm}
      />
      <line
        className="floor-case-ghost-leg"
        vectorEffect="non-scaling-stroke"
        x1={legXEndMm}
        x2={legXEndMm}
        y1={slabLineYMm}
        y2={wallHeightMm}
      />
    </g>
  );
}
