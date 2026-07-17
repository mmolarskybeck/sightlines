import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { ArtworkFrame, Dimensions } from "../../../domain/project";
import {
  FRAME_EDGE_HAIRLINE_HEX,
  FRAME_FINISH_HEX,
  MAT_BEVEL_HAIRLINE_HEX,
  MAT_FILL_HEX
} from "../../../domain/framing";
import { getArtworkRectSvg, type ArtworkCenterMm, type ArtworkSizeMm, type SvgRectMm } from "./elevationArtworkGeometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// Grow an SVG rect outward by an equal band on every side (mat/frame ring).
function expandRect(rect: SvgRectMm, bandMm: number): SvgRectMm {
  return {
    xMm: rect.xMm - bandMm,
    yMm: rect.yMm - bandMm,
    widthMm: rect.widthMm + bandMm * 2,
    heightMm: rect.heightMm + bandMm * 2
  };
}

// One placement's visual, reused for both a real (persisted) placement and
// the transient drop/drag ghost — a ghost is just a non-interactive instance
// of the same rect+image with a `ghost` class, so the two can never drift
// into visually disagreeing about size or position (they already can't
// disagree numerically, since both go through the same
// resolveArtworkSnap call — see ElevationView).
export function ElevationArtwork({
  center,
  dimensionStatus,
  frame,
  imageUrl,
  isGhost = false,
  isOutOfBounds = false,
  isSelected = false,
  matWidthMm,
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
  // Optional schematic framing (docs/quick-todos.md): a frame band drawn as a
  // flat color ring outside the mat, and a mat band drawn as an off-white ring
  // inside the frame. Both absent → image renders exactly as before.
  frame?: ArtworkFrame;
  imageUrl?: string;
  isGhost?: boolean;
  isOutOfBounds?: boolean;
  isSelected?: boolean;
  matWidthMm?: number;
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void;
  // Receives the click event so the caller can read modifier keys (shift/
  // cmd/ctrl) for additive multi-select. Passed straight to onClick, which
  // already provides it.
  onSelect?: (event: ReactMouseEvent<SVGGElement>) => void;
  // The IMAGE size (as stored on the wall object). Mat/frame bands render
  // outside it; interaction geometry expands the placement through the
  // framing adapter at its call boundaries.
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

  // Band widths (0 when absent). Mat sits directly around the image; frame
  // sits outside the mat. The outer rect (image + mat + frame) is what the
  // selection outline wraps.
  const matBandMm = matWidthMm && matWidthMm > 0 ? matWidthMm : 0;
  const frameBandMm = frame && frame.widthMm > 0 ? frame.widthMm : 0;
  const matRect = matBandMm > 0 ? expandRect(rect, matBandMm) : rect;
  const outerRect = frameBandMm > 0 ? expandRect(matRect, frameBandMm) : matRect;
  const frameFill = frame ? FRAME_FINISH_HEX[frame.finish] : undefined;

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
      {frameBandMm > 0 ? (
        // Frame: flat color ring, outermost. A simple filled rect the mat/
        // image paint over — a schematic mockup, not a molded profile.
        <rect
          className="elevation-artwork-frame"
          fill={frameFill}
          height={outerRect.heightMm}
          width={outerRect.widthMm}
          x={outerRect.xMm}
          y={outerRect.yMm}
        />
      ) : null}
      {matBandMm > 0 ? (
        // Mat: off-white board filling from the frame's inner edge to the
        // image opening.
        <rect
          className="elevation-artwork-mat"
          fill={MAT_FILL_HEX}
          height={matRect.heightMm}
          width={matRect.widthMm}
          x={matRect.xMm}
          y={matRect.yMm}
        />
      ) : null}
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
      {frameBandMm > 0 && frame ? (
        // Frame edge hairlines (mat-bevel weight, finish-aware color) so the
        // frame band always reads as its own ring — a white frame against a
        // white mat (or the wall fill) would otherwise run together, while the
        // light bevel grey would shout against a dark frame. One at the
        // frame's outer edge, one at its inner boundary: the frame/mat edge
        // when a mat exists, else the frame/image opening (matRect collapses
        // to the image rect when matBandMm is 0). Kept subtle: hairline
        // weight, non-scaling.
        <g className="elevation-artwork-frame-edges">
          <rect
            fill="none"
            height={outerRect.heightMm}
            stroke={FRAME_EDGE_HAIRLINE_HEX[frame.finish]}
            strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
            width={outerRect.widthMm}
            x={outerRect.xMm}
            y={outerRect.yMm}
          />
          <rect
            fill="none"
            height={matRect.heightMm}
            stroke={FRAME_EDGE_HAIRLINE_HEX[frame.finish]}
            strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
            width={matRect.widthMm}
            x={matRect.xMm}
            y={matRect.yMm}
          />
        </g>
      ) : null}
      {matBandMm > 0 ? (
        // Thin bevel hairline marking the mat's window against the image
        // opening (docs/quick-todos.md).
        <rect
          className="elevation-artwork-mat-bevel"
          fill="none"
          height={rect.heightMm}
          stroke={MAT_BEVEL_HAIRLINE_HEX}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
          width={rect.widthMm}
          x={rect.xMm}
          y={rect.yMm}
        />
      ) : null}
      <rect
        className="artwork-outline"
        height={outerRect.heightMm}
        vectorEffect="non-scaling-stroke"
        width={outerRect.widthMm}
        x={outerRect.xMm}
        y={outerRect.yMm}
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
