import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import {
  CASE_LEG_SIZE_MM,
  CASE_WALL_THICKNESS_MM
} from "../../../domain/project";
import { casePlanGlyph, wallTextPlanGlyph } from "../../../domain/geometry/caseGlyphs";
import type { DoorSwingPlanGlyph } from "../../../domain/geometry/doorGlyphs";
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
  swing,
  tooltip,
  tooltipDisabled = false
}: {
  // Floor of the invisible hit rect on both axes, in model mm — keeps small
  // (esp. thin wall) objects clickable at any zoom. Ghosts never get one.
  //
  // The floor is applied PER AXIS via Math.max, so it only ever pads the axis
  // that is actually too small: a projection board (a floor artwork whose
  // depthMm is the board's ~18mm thickness, drawn as a correct plan hairline)
  // gets a full-length grab band on its thin axis and no overhang past its
  // ends. This is the measurement overlay's hit-line-inert pattern — the drawn
  // rect keeps its true thickness and the transparent rect below it carries
  // the pointer, so a hairline stays draggable without being drawn fat.
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
  // A hinged door's swing glyph (planScene.ts's PlanSceneWallObject.doorSwing)
  // — undefined for a plain doorway, which keeps drawing the void chevron
  // exactly as before. Ignored for every kind other than "door". See the
  // render-site comment below for why this is the one glyph that is allowed
  // to paint outside the object's own rect.
  swing?: DoorSwingPlanGlyph;
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
      {kind === "artwork" && isFloorPlaced ? (
        // ─── FRONT-FACE CONVENTION ────────────────────────────────────────
        // A floor object's FRONT is its +depth face: the long edge at local
        // +y, i.e. the world direction (-sin θ, cos θ) for θ = rotationDeg.
        // At rotationDeg = 0 that is the edge at centerY + depth/2 — the
        // BOTTOM edge as drawn in plan, since plan +y is screen-down. In 3D
        // it is the box's local +z face, because three/FloorObjectBox.tsx's
        // planRotationToYaw maps plan +y → world +z (yaw = -rotationDeg).
        // Plan, elevation and 3D must all read it the same way.
        //
        // This is not an arbitrary pick — it's the convention the geometry
        // already encodes. offsetPlanRectToViewerSide shifts a wall-hung rect
        // by +depth/2 along exactly this axis (the "left normal" of the wall
        // direction, which planObjects.ts documents as the viewer's/room's
        // side), leaving the -depth edge sitting ON the wall line. So the back
        // face is -depth and the viewer-facing one is +depth, and a wall→floor
        // conversion — which inherits the wall's angle verbatim (store.ts) —
        // keeps facing the way it already faced.
        //
        // What this edge marks is ORIENTATION, not "where the image is". It
        // used to be able to claim both, back when a floor box wrapped its
        // image over every face; now ArtworkFloorObject.imageFaces makes the
        // textured set a curatorial choice, and a "top only" floor graphic has
        // no image on this edge at all. The marker stays honest anyway —
        // knowing which way a work faces is what drives rotation, wall
        // conversion, and reading a 45° board off the drawing — but do not
        // reintroduce a comment (or a test) asserting that the front face is
        // necessarily the imaged one. 3D and the inspector are the only
        // surfaces that know which faces carry the image.
        //
        // Drawn as a thickened edge rather than an added decoration: the same
        // "2D glyph echoes real construction" discipline as the case legs. A
        // heavier line on one face is plan-drawing shorthand for the finished/
        // significant surface, and it costs no extra geometry outside the rect.
        //
        // ARTWORK ONLY, and FLOOR-PLACED only:
        // - A wall-hung work needs no marker; the wall line it sits flush
        //   against is already the cue (the same reasoning that leaves a wall
        //   case legless).
        // - A blocked zone is a planning annotation with no physical front,
        //   and a case is glazed on every side — neither has a face to mark.
        // - Ghosts never set isFloorPlaced (PlanOverlaysLayer passes only
        //   isGhost), so a drop/tool preview stays as spare as it is today.
        <line
          className="plan-object-mark plan-object-mark--front-face"
          vectorEffect="non-scaling-stroke"
          x1={x}
          x2={rightX}
          y1={bottomY}
          y2={bottomY}
        />
      ) : null}
      {kind === "wall-text" ? (
        // A couple of short horizontal "text lines" — the plan echo of the
        // elevation skeleton panel, reusing the generic mark stroke.
        <g className="plan-object-mark plan-object-mark--wall-text">
          {wallTextPlanGlyph({
            widthMm: planRect.widthMm,
            depthMm: planRect.depthMm
          }).lines.map((textLine, index) => (
            <line
              key={index}
              vectorEffect="non-scaling-stroke"
              x1={midX + textLine.x1Mm}
              x2={midX + textLine.x2Mm}
              y1={midY + textLine.yMm}
              y2={midY + textLine.yMm}
            />
          ))}
        </g>
      ) : null}
      {kind === "door" && swing ? (
        // A HINGED door: the leaf drawn open at 90° plus the quarter-circle
        // it sweeps (doorSwingPlanGlyph). This is deliberately the only
        // glyph in the app that paints outside the object's own rect — a
        // swing can reach a full door-width beyond the thin opening rect,
        // into the room's open floor. plan-object-hit, renderedRect (used by
        // the marquee's planRectIntersectsRect) and the wall's own drag
        // geometry all keep using the thin opening rect, UNCHANGED by
        // hinging: giving the swing a hit target would let it compete with
        // the neighboring wall's slide/resize handle, which the known
        // handle-eats-clicks trap already places right at the wall midpoint
        // a swing often reaches into. `.plan-object-mark` already carries
        // pointer-events:none for every kind's glyph, which is exactly what
        // keeps this transparent to clicks — v1 draws the swing only, it
        // adds no hit target and no clearance validation (see the door-leaf
        // plan §4/§8).
        //
        // midX/midY recenter the glyph's local-centered mm (origin at the
        // rect's own center, +x/+y per doorGlyphs.ts's documented frame) into
        // this component's absolute model-space coordinates, same as the
        // `case` glyph above. The leaf and arc are drawn as one continuous
        // path — the leaf's tip IS the arc's start point by construction
        // (doorSwingPlanGlyph), so there is no seam.
        <g className="plan-object-mark plan-object-mark--door-swing">
          <line
            vectorEffect="non-scaling-stroke"
            x1={midX + swing.leaf.x1Mm}
            x2={midX + swing.leaf.x2Mm}
            y1={midY + swing.leaf.y1Mm}
            y2={midY + swing.leaf.y2Mm}
          />
          <path
            d={`M ${midX + swing.arc.startXMm} ${midY + swing.arc.startYMm} A ${swing.arc.radiusMm} ${swing.arc.radiusMm} 0 ${swing.arc.largeArcFlag} ${swing.arc.sweepFlag} ${midX + swing.arc.endXMm} ${midY + swing.arc.endYMm}`}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : kind === "door" ? (
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
            // The construction (glass inset, glazing hatch, leg placement and
            // the legs-appear threshold) lives in the shared glyph module, in
            // local-centered mm. The zoom-clamped wall inset and leg size are
            // passed in so the screen stays legible; the module returns the raw
            // structure, which the PDF export reuses at true mm.
            const wallInsetMm = clampMm(
              pixelsPerMm,
              CASE_WALL_THICKNESS_MM,
              3,
              Math.min(planRect.widthMm, planRect.depthMm) * 0.35
            );
            const legSizeMm = clampMm(
              pixelsPerMm,
              CASE_LEG_SIZE_MM,
              2.5,
              Math.min(planRect.widthMm, planRect.depthMm) * 0.18
            );
            const glyph = casePlanGlyph({
              widthMm: planRect.widthMm,
              depthMm: planRect.depthMm,
              includeLegs: isFloorPlaced,
              wallInsetMm,
              legSizeMm
            });
            return (
              <>
                {glyph.glass ? (
                  <rect
                    className="plan-object-case-glass"
                    height={glyph.glass.y1Mm - glyph.glass.y0Mm}
                    vectorEffect="non-scaling-stroke"
                    width={glyph.glass.x1Mm - glyph.glass.x0Mm}
                    x={midX + glyph.glass.x0Mm}
                    y={midY + glyph.glass.y0Mm}
                  />
                ) : null}
                {glyph.hatch.map((line, index) => (
                  <line
                    className="plan-object-case-hatch"
                    key={index}
                    vectorEffect="non-scaling-stroke"
                    x1={midX + line.x1Mm}
                    x2={midX + line.x2Mm}
                    y1={midY + line.y1Mm}
                    y2={midY + line.y2Mm}
                  />
                ))}
                {glyph.legs.map((leg, index) => (
                  <rect
                    className="plan-object-case-leg"
                    height={leg.sizeMm}
                    key={`leg-${index}`}
                    vectorEffect="non-scaling-stroke"
                    width={leg.sizeMm}
                    x={midX + leg.cxMm - leg.sizeMm / 2}
                    y={midY + leg.cyMm - leg.sizeMm / 2}
                  />
                ))}
              </>
            );
          })()}
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
