import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import {
  CASE_LEG_INSET_MM,
  CASE_LEG_SIZE_MM,
  CASE_WALL_THICKNESS_MM
} from "../../../domain/project";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// px → mm at the current zoom, or 0 with no zoom context (pixelsPerMm
// absent/0) — callers then skip the floor/ceiling clamp entirely and use the
// real mm value, which is what export/test rendering (no live zoom) wants.
function mmForPx(pixelsPerMm: number, px: number): number {
  return pixelsPerMm > 0 ? px / pixelsPerMm : 0;
}

// Clamp a real-world mm construction constant to stay legible on screen: at
// least `minPx` screen pixels, but never past `maxMm` (so a tiny case's
// "20mm wall" doesn't balloon to look like a thick frame).
function clampMm(pixelsPerMm: number, realMm: number, minPx: number, maxMm: number): number {
  return Math.min(Math.max(realMm, mmForPx(pixelsPerMm, minPx)), maxMm);
}

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
  pixelsPerMm = 0,
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
  kind: "door" | "window" | "blocked-zone" | "artwork" | "wall-text" | "case";
  // Starts a pointer-drag move of this object (PlanView owns the live preview
  // + commit-on-release). A click without real movement still falls through to
  // onSelect — the drag release is a no-op below its movement threshold.
  onBeginDrag?: (event: ReactPointerEvent<SVGGElement>) => void;
  // Receives the click event so the caller can read modifier keys (shift/
  // cmd/ctrl) for additive multi-select.
  onSelect?: (event: ReactMouseEvent<SVGGElement>) => void;
  // Current plan zoom (screen px per model mm) — used only by the `case`
  // glyph to clamp its honest-3D-geometry inset/legs to stay legible at any
  // zoom. Absent/0 (export paths, tests with no live zoom) means "use real mm,
  // no clamping."
  pixelsPerMm?: number;
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
      {kind === "wall-text" ? (
        // A couple of short horizontal "text lines" — the plan echo of the
        // elevation skeleton panel, reusing the generic mark stroke.
        <g className="plan-object-mark plan-object-mark--wall-text">
          <line
            vectorEffect="non-scaling-stroke"
            x1={x + insetMm}
            x2={rightX - insetMm}
            y1={midY - insetMm * 0.4}
            y2={midY - insetMm * 0.4}
          />
          <line
            vectorEffect="non-scaling-stroke"
            x1={x + insetMm}
            x2={rightX - insetMm - insetWidthMm * 0.35}
            y1={midY + insetMm * 0.4}
            y2={midY + insetMm * 0.4}
          />
        </g>
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
      {kind === "case" ? (
        // A vitrine glyph echoing the true 3D construction (CaseMesh.tsx)
        // rather than an arbitrary inset: the glass box sits inside a
        // CASE_WALL_THICKNESS_MM tray wall, and (for a freestanding floor
        // case) four CASE_LEG_SIZE_MM legs sit CASE_LEG_INSET_MM in from the
        // footprint edge — the same offsets FloorCaseMesh uses. A wall case
        // has no legs, so it draws only the glass inset — leaving the
        // outline's wall-side edge as its orientation cue against the wall
        // line it sits flush on.
        <g className="plan-object-mark plan-object-mark--case">
          {(() => {
            const wallInsetMm = clampMm(
              pixelsPerMm,
              CASE_WALL_THICKNESS_MM,
              3,
              Math.min(planRect.widthMm, planRect.depthMm) * 0.35
            );
            const glassWidthMm = planRect.widthMm - wallInsetMm * 2;
            const glassDepthMm = planRect.depthMm - wallInsetMm * 2;
            if (glassWidthMm <= 0 || glassDepthMm <= 0) return null;
            const gx0 = x + wallInsetMm;
            const gy0 = y + wallInsetMm;
            const gx1 = gx0 + glassWidthMm;
            const gy1 = gy0 + glassDepthMm;
            // Loose 45° glazing hatch: a few sparse strokes marking the glass
            // surface. Deliberately the OPPOSITE diagonal from the blocked-zone
            // hatch (which rises left→right) so glass and blocked never share
            // a symbol, and wide-spaced so it stays quiet at small sizes.
            // Lines run y = x + c; c indexes the diagonals, centered in range.
            const hatchSpacingMm = Math.max(Math.min(glassWidthMm, glassDepthMm) * 1.2, 300);
            const cMin = gy0 - gx1;
            const cMax = gy1 - gx0;
            const hatchCount = Math.floor((cMax - cMin) / hatchSpacingMm);
            const hatchStartC = cMin + (cMax - cMin - (hatchCount - 1) * hatchSpacingMm) / 2;
            const hatchLines = [];
            for (let i = 0; i < hatchCount; i++) {
              const c = hatchStartC + i * hatchSpacingMm;
              const xa = Math.max(gx0, gy0 - c);
              const xb = Math.min(gx1, gy1 - c);
              if (xb <= xa) continue;
              hatchLines.push(
                <line
                  className="plan-object-case-hatch"
                  key={i}
                  vectorEffect="non-scaling-stroke"
                  x1={xa}
                  x2={xb}
                  y1={xa + c}
                  y2={xb + c}
                />
              );
            }
            return (
              <>
                <rect
                  className="plan-object-case-glass"
                  height={glassDepthMm}
                  vectorEffect="non-scaling-stroke"
                  width={glassWidthMm}
                  x={gx0}
                  y={gy0}
                />
                {hatchLines}
              </>
            );
          })()}
          {isFloorPlaced
            ? (() => {
                const legSizeMm = clampMm(
                  pixelsPerMm,
                  CASE_LEG_SIZE_MM,
                  2.5,
                  Math.min(planRect.widthMm, planRect.depthMm) * 0.18
                );
                // Below this footprint the two legs on an edge would collide
                // (or straddle the edge itself) — matches FloorCaseMesh's own
                // Math.max clamp, which pins legs to the center once the
                // footprint is too small for a true CASE_LEG_INSET_MM offset.
                if (Math.min(planRect.widthMm, planRect.depthMm) < 2 * (CASE_LEG_INSET_MM + CASE_LEG_SIZE_MM)) {
                  return null;
                }
                const legOffsetXMm = Math.max(planRect.widthMm / 2 - CASE_LEG_INSET_MM, legSizeMm / 2);
                const legOffsetDMm = Math.max(planRect.depthMm / 2 - CASE_LEG_INSET_MM, legSizeMm / 2);
                return [
                  { cx: midX - legOffsetXMm, cy: midY - legOffsetDMm },
                  { cx: midX + legOffsetXMm, cy: midY - legOffsetDMm },
                  { cx: midX - legOffsetXMm, cy: midY + legOffsetDMm },
                  { cx: midX + legOffsetXMm, cy: midY + legOffsetDMm }
                ].map((leg, index) => (
                  <rect
                    className="plan-object-case-leg"
                    height={legSizeMm}
                    key={index}
                    vectorEffect="non-scaling-stroke"
                    width={legSizeMm}
                    x={leg.cx - legSizeMm / 2}
                    y={leg.cy - legSizeMm / 2}
                  />
                ));
              })()
            : null}
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
