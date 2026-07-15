import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  offsetPlanRectToViewerSide,
  segmentPlanRect,
  type FloorWall
} from "../../../domain/geometry/planObjects";
import { formatLength } from "../../../domain/units/length";
import type { OpeningKind } from "../../../domain/placement/createOpening";
import type { DisplayUnit } from "../../../domain/project";
import { DEFAULT_FREESTANDING_THICKNESS_MM } from "../../../domain/geometry/freestandingWalls";
import type { Guide } from "../../../domain/snapping/resolveSnap";
import { PlanObject } from "../PlanObject";
import { marqueeRectMm, type MarqueeState } from "../marqueeRect";
import type {
  DrawState,
  DropGhostState,
  PartitionDrawState,
  PartitionDuplicateGhostState,
  RectDrawState,
  ToolGhostState
} from "./types";

type ViewBoxRect = { x: number; y: number; width: number; height: number };

// Render-only overlay layer: everything gestural that paints above the drawing
// — the polygon-room draw preview + its full-viewBox capture rect, the
// partition-draw and rectangle-room-draw previews, the armed-tool and drop
// ghosts, the snap guides, and the in-progress marquee. Paint order is
// preserved exactly (draw-room → partition-draw → rect-draw → tool ghost →
// drop ghost → guides → marquee). The layer owns no state: PlanView passes the
// transient draw/ghost/marquee states, the merged `activeGuides`, and the
// pointer callbacks that own each capture rect.
export type PlanOverlaysLayerProps = {
  drawRoomActive: boolean;
  draw: DrawState | null;
  partitionToolActive: boolean;
  partitionDraw: PartitionDrawState | null;
  partitionDuplicateActive: boolean;
  partitionDuplicateGhost: PartitionDuplicateGhostState | null;
  drawRectActive: boolean;
  rectDraw: RectDrawState | null;
  toolGhost: ToolGhostState | null;
  dropGhost: DropGhostState | null;
  marquee: MarqueeState | null;
  // The active gesture's snap guides, already resolved by PlanView (the same
  // objectDrag ?? dropGhost ?? drag ?? roomDrag ?? toolGhost precedence).
  activeGuides: Guide[];
  activeTool: OpeningKind | null;
  viewBox: ViewBoxRect;
  handleSizeMm: number;
  wallUnit: DisplayUnit;
  wallObjectMinDepthMm: number;
  floorWalls: FloorWall[];
  handleDrawClick: (event: ReactMouseEvent<SVGRectElement>) => void;
  handleDrawPointerMove: (event: ReactPointerEvent<SVGRectElement>) => void;
  beginPartitionDraw: (event: ReactPointerEvent<SVGRectElement>) => void;
  handlePartitionDuplicateMove: (event: ReactPointerEvent<SVGRectElement>) => void;
  handlePartitionDuplicateClick: (event: ReactMouseEvent<SVGRectElement>) => void;
  beginRectDraw: (event: ReactPointerEvent<SVGRectElement>) => void;
};

export function PlanOverlaysLayer({
  drawRoomActive,
  draw,
  partitionToolActive,
  partitionDraw,
  partitionDuplicateActive,
  partitionDuplicateGhost,
  drawRectActive,
  rectDraw,
  toolGhost,
  dropGhost,
  marquee,
  activeGuides,
  activeTool,
  viewBox,
  handleSizeMm,
  wallUnit,
  wallObjectMinDepthMm,
  floorWalls,
  handleDrawClick,
  handleDrawPointerMove,
  beginPartitionDraw,
  handlePartitionDuplicateMove,
  handlePartitionDuplicateClick,
  beginRectDraw
}: PlanOverlaysLayerProps) {
  return (
    <>
      {/* Polygon-room draw overlay: a full-viewBox transparent capture rect
          owns every pointer event while drawing (so underlying walls/objects
          never interfere), with the preview painted on top at
          pointer-events:none so events fall through to the rect. Placed,
          valid rubber-band, and invalid rubber-band each use existing plan
          tokens (ink walls, petrol selection, danger). */}
      {drawRoomActive && draw
        ? (() => {
            const last = draw.points.at(-1) ?? null;
            const rubberEnd = draw.cursorMm;
            const committedPoints = draw.points
              .map((point) => `${point.xMm},${point.yMm}`)
              .join(" ");
            const segmentLengthMm =
              last && rubberEnd && !draw.closing
                ? Math.hypot(rubberEnd.xMm - last.xMm, rubberEnd.yMm - last.yMm)
                : null;
            const vertexSizeMm = handleSizeMm > 0 ? handleSizeMm : 0;
            // The existing room geometry the cursor is latched onto (§6.3),
            // so the snap indicator can also highlight the shared wall.
            const snapWall = draw.snap
              ? floorWalls.find((wall) => wall.id === draw.snap?.wallId) ?? null
              : null;

            return (
              <g className="draw-room-layer">
                <rect
                  x={viewBox.x}
                  y={viewBox.y}
                  width={viewBox.width}
                  height={viewBox.height}
                  fill="transparent"
                  onClick={handleDrawClick}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerMove={handleDrawPointerMove}
                />
                {draw.points.length >= 2 ? (
                  <polyline
                    points={committedPoints}
                    fill="none"
                    stroke="var(--ink)"
                    strokeWidth={5}
                    strokeLinecap="square"
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
                {last && rubberEnd ? (
                  <line
                    x1={last.xMm}
                    y1={last.yMm}
                    x2={rubberEnd.xMm}
                    y2={rubberEnd.yMm}
                    stroke={draw.invalid ? "var(--danger)" : "var(--selection)"}
                    strokeWidth={4}
                    strokeDasharray="6 5"
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
                {vertexSizeMm > 0
                  ? draw.points.map((point, index) => {
                      const size =
                        index === 0 && draw.closing ? vertexSizeMm * 1.5 : vertexSizeMm;
                      return (
                        <rect
                          key={index}
                          className="resize-handle"
                          x={point.xMm - size / 2}
                          y={point.yMm - size / 2}
                          width={size}
                          height={size}
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: "none" }}
                        />
                      );
                    })
                  : null}
                {/* Room-snap indicator (§6.3): a crisp filled petrol square
                    on the snapped point, with the shared wall segment
                    highlighted in the same selection token — no pills, no
                    circles, matching the draw preview's design language. */}
                {draw.snap && snapWall ? (
                  <line
                    className="draw-snap-wall"
                    x1={snapWall.startFloorMm.xMm}
                    y1={snapWall.startFloorMm.yMm}
                    x2={snapWall.endFloorMm.xMm}
                    y2={snapWall.endFloorMm.yMm}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
                {draw.snap && vertexSizeMm > 0 ? (
                  <rect
                    className="draw-snap-marker"
                    x={draw.snap.pointMm.xMm - vertexSizeMm / 2}
                    y={draw.snap.pointMm.yMm - vertexSizeMm / 2}
                    width={vertexSizeMm}
                    height={vertexSizeMm}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
                {segmentLengthMm != null && rubberEnd && vertexSizeMm > 0 ? (
                  <text
                    className="resize-handle-label"
                    x={rubberEnd.xMm + vertexSizeMm}
                    y={rubberEnd.yMm - vertexSizeMm}
                    style={{
                      // SVG user units (mm), sized off handleSizeMm so the
                      // readout stays a constant on-screen size at any zoom —
                      // the same trick RoomResizeHandles' label uses.
                      fontSize: vertexSizeMm * 1.6,
                      strokeWidth: vertexSizeMm * 0.5,
                      pointerEvents: "none"
                    }}
                  >
                    {formatLength(segmentLengthMm, { unit: wallUnit })}
                  </text>
                ) : null}
              </g>
            );
          })()
        : null}
      {/* Partition tool: a full-viewBox capture rect owns the press-drag
          that draws the centerline; the live preview slab paints on top at
          pointer-events:none. Release commits via onAddFreestandingWall. */}
      {partitionToolActive ? (
        <g className="partition-draw-layer">
          <rect
            x={viewBox.x}
            y={viewBox.y}
            width={viewBox.width}
            height={viewBox.height}
            fill="transparent"
            style={{ cursor: "crosshair" }}
            onPointerDown={beginPartitionDraw}
          />
          {partitionDraw && partitionDraw.endMm
            ? (() => {
                const rect = segmentPlanRect(
                  partitionDraw.startMm,
                  partitionDraw.endMm,
                  DEFAULT_FREESTANDING_THICKNESS_MM
                );
                const lengthMm = Math.hypot(
                  partitionDraw.endMm.xMm - partitionDraw.startMm.xMm,
                  partitionDraw.endMm.yMm - partitionDraw.startMm.yMm
                );
                // Offset the readout along the slab's own normal (flipped to
                // point screen-upward) so it clears the slab at any angle —
                // a fixed "above center" offset overlaps vertical partitions.
                const labelNormal =
                  lengthMm > 0
                    ? {
                        xMm: -(partitionDraw.endMm.yMm - partitionDraw.startMm.yMm) / lengthMm,
                        yMm: (partitionDraw.endMm.xMm - partitionDraw.startMm.xMm) / lengthMm
                      }
                    : { xMm: 0, yMm: -1 };
                const labelFlip = labelNormal.yMm > 0 ? -1 : 1;
                const labelOffsetMm =
                  DEFAULT_FREESTANDING_THICKNESS_MM / 2 + handleSizeMm * 1.6;
                const color = partitionDraw.invalid ? "var(--danger)" : "var(--selection)";
                return (
                  <g style={{ pointerEvents: "none" }}>
                    <rect
                      x={rect.centerXMm - rect.widthMm / 2}
                      y={rect.centerYMm - rect.depthMm / 2}
                      width={rect.widthMm}
                      height={rect.depthMm}
                      transform={`rotate(${rect.angleDeg} ${rect.centerXMm} ${rect.centerYMm})`}
                      style={{ fill: color, fillOpacity: 0.4, stroke: color, strokeWidth: 2 }}
                      vectorEffect="non-scaling-stroke"
                    />
                    {handleSizeMm > 0 ? (
                      <text
                        className="resize-handle-label"
                        x={rect.centerXMm + labelNormal.xMm * labelFlip * labelOffsetMm}
                        y={rect.centerYMm + labelNormal.yMm * labelFlip * labelOffsetMm}
                        textAnchor="middle"
                        style={{
                          fontSize: handleSizeMm * 1.6,
                          strokeWidth: handleSizeMm * 0.5,
                          pointerEvents: "none"
                        }}
                      >
                        {formatLength(lengthMm, { unit: wallUnit })}
                      </text>
                    ) : null}
                  </g>
                );
              })()
            : null}
        </g>
      ) : null}
      {partitionDuplicateActive ? (
        <g className="partition-duplicate-layer">
          <rect
            x={viewBox.x}
            y={viewBox.y}
            width={viewBox.width}
            height={viewBox.height}
            fill="transparent"
            style={{ cursor: "copy" }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={handlePartitionDuplicateMove}
            onClick={handlePartitionDuplicateClick}
          />
          {partitionDuplicateGhost
            ? (() => {
                const rect = segmentPlanRect(
                  partitionDuplicateGhost.startMm,
                  partitionDuplicateGhost.endMm,
                  partitionDuplicateGhost.thicknessMm
                );
                const color = partitionDuplicateGhost.invalid
                  ? "var(--danger)"
                  : "var(--selection)";
                return (
                  <rect
                    x={rect.centerXMm - rect.widthMm / 2}
                    y={rect.centerYMm - rect.depthMm / 2}
                    width={rect.widthMm}
                    height={rect.depthMm}
                    transform={`rotate(${rect.angleDeg} ${rect.centerXMm} ${rect.centerYMm})`}
                    style={{
                      fill: color,
                      fillOpacity: 0.3,
                      stroke: color,
                      strokeWidth: 2,
                      pointerEvents: "none"
                    }}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })()
            : null}
        </g>
      ) : null}
      {/* Rectangle-room tool: a full-viewBox capture rect owns the press-drag
          between the two corners; the live preview rect and its W × D readout
          paint on top at pointer-events:none. Release commits via
          onAddRectangleRoom. */}
      {drawRectActive ? (
        <g className="rect-draw-layer">
          <rect
            x={viewBox.x}
            y={viewBox.y}
            width={viewBox.width}
            height={viewBox.height}
            fill="transparent"
            style={{ cursor: "crosshair" }}
            onPointerDown={beginRectDraw}
          />
          {rectDraw && rectDraw.endMm
            ? (() => {
                const originXMm = Math.min(rectDraw.startMm.xMm, rectDraw.endMm.xMm);
                const originYMm = Math.min(rectDraw.startMm.yMm, rectDraw.endMm.yMm);
                const widthMm = Math.abs(rectDraw.endMm.xMm - rectDraw.startMm.xMm);
                const depthMm = Math.abs(rectDraw.endMm.yMm - rectDraw.startMm.yMm);
                const color = rectDraw.invalid ? "var(--danger)" : "var(--selection)";
                return (
                  <g style={{ pointerEvents: "none" }}>
                    <rect
                      x={originXMm}
                      y={originYMm}
                      width={widthMm}
                      height={depthMm}
                      style={{ fill: color, fillOpacity: 0.4, stroke: color, strokeWidth: 2 }}
                      vectorEffect="non-scaling-stroke"
                    />
                    {handleSizeMm > 0 ? (
                      <text
                        className="resize-handle-label"
                        x={rectDraw.endMm.xMm + handleSizeMm}
                        y={rectDraw.endMm.yMm - handleSizeMm}
                        style={{
                          // SVG user units (mm), sized off handleSizeMm so the
                          // readout stays a constant on-screen size at any zoom
                          // — the same trick the draw-room readout uses.
                          fontSize: handleSizeMm * 1.6,
                          strokeWidth: handleSizeMm * 0.5,
                          pointerEvents: "none"
                        }}
                      >
                        {`${formatLength(widthMm, { unit: wallUnit })} × ${formatLength(depthMm, {
                          unit: wallUnit
                        })}`}
                      </text>
                    ) : null}
                  </g>
                );
              })()
            : null}
        </g>
      ) : null}
      {toolGhost ? (
        <PlanObject
          isGhost
          kind={activeTool ?? "door"}
          planRect={
            toolGhost.placement.anchor === "wall"
              ? {
                  ...toolGhost.planRect,
                  depthMm: Math.max(toolGhost.planRect.depthMm, wallObjectMinDepthMm)
                }
              : toolGhost.planRect
          }
        />
      ) : null}
      {dropGhost ? (
        <PlanObject
          isGhost
          // No wall captured → wall-only artwork can't land here: paint the
          // danger token so the refusal reads before release.
          isInvalid={dropGhost.placement.anchor === "none"}
          kind="artwork"
          planRect={
            dropGhost.placement.anchor === "wall"
              ? {
                  // Always artwork (checklist drag-in) — offset to the
                  // viewer's side (spec §5.3) so the drop ghost matches
                  // where the placed glyph will actually render.
                  ...offsetPlanRectToViewerSide(dropGhost.planRect),
                  depthMm: Math.max(dropGhost.planRect.depthMm, wallObjectMinDepthMm)
                }
              : dropGhost.planRect
          }
        />
      ) : null}
      {activeGuides.map((guide) => {
        // A bounded guide (extentMm set, e.g. a partition drag clipped to its
        // room) draws as a segment over that range along its length; an
        // unbounded guide spans the full viewBox. For an x-guide (vertical) the
        // extent is the y range; for a y-guide (horizontal) it is the x range.
        const alongStart =
          guide.extentMm?.startMm ?? (guide.axis === "x" ? viewBox.y : viewBox.x);
        const alongEnd =
          guide.extentMm?.endMm ??
          (guide.axis === "x" ? viewBox.y + viewBox.height : viewBox.x + viewBox.width);
        return (
          <line
            className="snap-guide"
            key={guide.id}
            x1={guide.axis === "x" ? guide.positionMm : alongStart}
            y1={guide.axis === "y" ? guide.positionMm : alongStart}
            x2={guide.axis === "x" ? guide.positionMm : alongEnd}
            y2={guide.axis === "y" ? guide.positionMm : alongEnd}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {marquee
        ? (() => {
            // Plan is y-down (no flip), so the min/max rect maps straight to
            // the <rect>. Dashed petrol stroke (.marquee-rect) — the same
            // in-progress marquee look elevation uses.
            const rect = marqueeRectMm(marquee);
            return (
              <rect
                className="marquee-rect"
                x={rect.minXMm}
                y={rect.minYMm}
                width={rect.maxXMm - rect.minXMm}
                height={rect.maxYMm - rect.minYMm}
                vectorEffect="non-scaling-stroke"
              />
            );
          })()
        : null}
    </>
  );
}
