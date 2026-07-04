import type { PointerEvent as ReactPointerEvent } from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import {
  getRectangleRoomDimensions,
  getWallsWithGeometry,
  type WallWithGeometry
} from "../../domain/geometry/walls";
import type { DisplayUnit, RoomPlacement } from "../../domain/project";
import { formatLength } from "../../domain/units/length";

export type ResizeHandleTarget = {
  targetWallId: string;
  axis: Vector2;
  startLengthMm: number;
};

export type ActiveResizeDrag = {
  targetWallId: string;
  previewLengthMm: number;
};

// Two draggable handles per rectangle room, one per independent dimension —
// the tactile counterpart to the Width/Depth fields in the sidebar. Each
// handle sits on the wall that visually moves when its paired dimension
// changes (docs/plan.md §2: dragging and typing must land in the same
// place), not on the wall whose own length value it's actually editing —
// resizing wall[i]'s length moves wall[i+1]'s vertices, so the handle for
// wall[i]'s dimension is placed on wall[i+1].
export function RoomResizeHandles({
  activeDrag,
  handleSizeMm,
  onBeginDrag,
  placement,
  unit
}: {
  activeDrag: ActiveResizeDrag | null;
  handleSizeMm: number;
  onBeginDrag: (
    roomId: string,
    target: ResizeHandleTarget,
    event: ReactPointerEvent<SVGRectElement>
  ) => void;
  placement: RoomPlacement;
  unit: DisplayUnit;
}) {
  const dimensions = getRectangleRoomDimensions(placement.room);
  if (!dimensions) return null;

  const walls = getWallsWithGeometry(placement.room);
  const widthWallIndex = walls.findIndex((wall) => wall.id === dimensions.widthWallId);
  const depthWallIndex = walls.findIndex((wall) => wall.id === dimensions.depthWallId);
  if (widthWallIndex === -1 || depthWallIndex === -1) return null;

  const widthHandleWall = walls[(widthWallIndex + 1) % walls.length];
  const depthHandleWall = walls[(depthWallIndex + 1) % walls.length];

  return (
    <>
      <ResizeHandle
        axis={axisOf(walls[widthWallIndex])}
        displayLengthMm={
          activeDrag?.targetWallId === dimensions.widthWallId
            ? activeDrag.previewLengthMm
            : dimensions.widthMm
        }
        handleSizeMm={handleSizeMm}
        isActive={activeDrag?.targetWallId === dimensions.widthWallId}
        placement={placement}
        startLengthMm={dimensions.widthMm}
        targetWallId={dimensions.widthWallId}
        unit={unit}
        wall={widthHandleWall}
        onBeginDrag={onBeginDrag}
      />
      <ResizeHandle
        axis={axisOf(walls[depthWallIndex])}
        displayLengthMm={
          activeDrag?.targetWallId === dimensions.depthWallId
            ? activeDrag.previewLengthMm
            : dimensions.depthMm
        }
        handleSizeMm={handleSizeMm}
        isActive={activeDrag?.targetWallId === dimensions.depthWallId}
        placement={placement}
        startLengthMm={dimensions.depthMm}
        targetWallId={dimensions.depthWallId}
        unit={unit}
        wall={depthHandleWall}
        onBeginDrag={onBeginDrag}
      />
    </>
  );
}

function ResizeHandle({
  axis,
  displayLengthMm,
  handleSizeMm,
  isActive,
  placement,
  startLengthMm,
  targetWallId,
  unit,
  wall,
  onBeginDrag
}: {
  axis: Vector2;
  displayLengthMm: number;
  handleSizeMm: number;
  isActive: boolean;
  placement: RoomPlacement;
  startLengthMm: number;
  targetWallId: string;
  unit: DisplayUnit;
  wall: WallWithGeometry;
  onBeginDrag: (
    roomId: string,
    target: ResizeHandleTarget,
    event: ReactPointerEvent<SVGRectElement>
  ) => void;
}) {
  const midXMm = (wall.start.xMm + wall.end.xMm) / 2 + placement.offsetXMm;
  const midYMm = (wall.start.yMm + wall.end.yMm) / 2 + placement.offsetYMm;

  return (
    <g>
      <rect
        className={isActive ? "resize-handle active" : "resize-handle"}
        height={handleSizeMm}
        rx={handleSizeMm * 0.25}
        width={handleSizeMm}
        x={midXMm - handleSizeMm / 2}
        y={midYMm - handleSizeMm / 2}
        onPointerDown={(event) => {
          event.stopPropagation();
          onBeginDrag(placement.roomId, { axis, startLengthMm, targetWallId }, event);
        }}
      />
      {isActive ? (
        <text
          className="resize-handle-label"
          x={midXMm}
          y={midYMm - handleSizeMm * 1.4}
          textAnchor="middle"
          style={{
            // font-size/stroke-width are in SVG user units (mm), not CSS
            // px, since this SVG's viewBox already scales content to fit —
            // sizing off handleSizeMm (itself screen-px-per-mm-derived)
            // keeps the label a constant on-screen size at any room scale,
            // the same trick vector-effect="non-scaling-stroke" does for
            // wall strokes.
            fontSize: handleSizeMm * 1.3,
            strokeWidth: handleSizeMm * 0.35
          }}
        >
          {formatLength(displayLengthMm, { unit })}
        </text>
      ) : null}
    </g>
  );
}

function axisOf(wall: WallWithGeometry): Vector2 {
  const dxMm = wall.end.xMm - wall.start.xMm;
  const dyMm = wall.end.yMm - wall.start.yMm;
  const lengthMm = Math.hypot(dxMm, dyMm) || 1;

  return { xMm: dxMm / lengthMm, yMm: dyMm / lengthMm };
}
