import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizeAnchor } from "../../domain/geometry/editRoom";
import type { Vector2 } from "../../domain/geometry/dragResize";
import {
  getRectangleRoomDimensions,
  getRoomBounds,
  getWallsWithGeometry,
  type WallWithGeometry
} from "../../domain/geometry/walls";
import type { DisplayUnit, RoomPlacement } from "../../domain/project";
import { formatLength } from "../../domain/units/length";

export type ResizeHandleTarget = {
  targetWallId: string;
  axis: Vector2;
  startLengthMm: number;
  anchor: ResizeAnchor;
};

export type ActiveResizeDrag = {
  targetWallId: string;
  anchor: ResizeAnchor;
  previewLengthMm: number;
};

// Rendered only for the selected room (PlanView gates this on
// placement.roomId === selectedRoomId), in the selection overlay layer above
// placed objects. Four draggable handles per rectangle room, one per wall —
// two independent dimensions (Width/Depth, the sidebar's fields) times two
// anchors (the room can grow/shrink from either side of each dimension), so a
// room is no longer stuck only growing down/right. Each handle sits ON its
// own wall's midpoint (no outward offset — the room's selection outline
// already marks the boundary, so the handle doubles as a point on it).
//
// Per docs/plan.md §2, dragging and typing a dimension must land in the same
// place: resizeWallPreservingAngles anchor "start" moves wall[i+1]'s
// vertices when resizing wall[i]; anchor "end" moves wall[i+3]'s (== wall
// [i-1]'s) instead. So the handle for wall[i]'s dimension sits on wall[i+1]
// for anchor "start" and wall[i+3] for anchor "end" — always on the wall
// that actually moves, never on the wall whose length value it edits.
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

  const centroidMm = roomCentroidWorldMm(placement);
  const widthAxis = axisOf(walls[widthWallIndex]);
  const depthAxis = axisOf(walls[depthWallIndex]);

  const handleSpecs: {
    key: string;
    wall: WallWithGeometry;
    axis: Vector2;
    targetWallId: string;
    anchor: ResizeAnchor;
    startLengthMm: number;
  }[] = [
    {
      key: "width-start",
      wall: walls[(widthWallIndex + 1) % walls.length],
      axis: widthAxis,
      targetWallId: dimensions.widthWallId,
      anchor: "start",
      startLengthMm: dimensions.widthMm
    },
    {
      key: "width-end",
      wall: walls[(widthWallIndex + 3) % walls.length],
      axis: widthAxis,
      targetWallId: dimensions.widthWallId,
      anchor: "end",
      startLengthMm: dimensions.widthMm
    },
    {
      key: "depth-start",
      wall: walls[(depthWallIndex + 1) % walls.length],
      axis: depthAxis,
      targetWallId: dimensions.depthWallId,
      anchor: "start",
      startLengthMm: dimensions.depthMm
    },
    {
      key: "depth-end",
      wall: walls[(depthWallIndex + 3) % walls.length],
      axis: depthAxis,
      targetWallId: dimensions.depthWallId,
      anchor: "end",
      startLengthMm: dimensions.depthMm
    }
  ];

  return (
    <>
      {handleSpecs.map((spec) => (
        <ResizeHandle
          anchor={spec.anchor}
          axis={spec.axis}
          centroidMm={centroidMm}
          displayLengthMm={
            activeDrag?.targetWallId === spec.targetWallId && activeDrag.anchor === spec.anchor
              ? activeDrag.previewLengthMm
              : spec.startLengthMm
          }
          handleSizeMm={handleSizeMm}
          isActive={
            activeDrag?.targetWallId === spec.targetWallId && activeDrag.anchor === spec.anchor
          }
          key={spec.key}
          placement={placement}
          startLengthMm={spec.startLengthMm}
          targetWallId={spec.targetWallId}
          unit={unit}
          wall={spec.wall}
          onBeginDrag={onBeginDrag}
        />
      ))}
    </>
  );
}

function ResizeHandle({
  anchor,
  axis,
  centroidMm,
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
  anchor: ResizeAnchor;
  axis: Vector2;
  centroidMm: Vector2;
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
  const centerXMm = (wall.start.xMm + wall.end.xMm) / 2 + placement.offsetXMm;
  const centerYMm = (wall.start.yMm + wall.end.yMm) / 2 + placement.offsetYMm;
  // Only needed for the label's placement below — the handle itself now sits
  // directly on the wall it targets, no outward offset.
  const normal = outwardNormal(wall, placement, centroidMm);

  // The handle only ever moves along its TARGET wall's own axis
  // (computeDraggedLengthMm projects the pointer delta onto it) — for a
  // rectangle that axis is perpendicular to the wall this handle actually
  // sits on, so it's the same direction the handle was offset along. The
  // cursor communicates that constrained direction rather than free drag.
  const cursor = Math.abs(axis.xMm) >= Math.abs(axis.yMm) ? "ew-resize" : "ns-resize";

  // The label reads outside the room, along the wall's outward normal, far
  // enough out to clear both the wall stroke and the handle itself (the
  // handle sits ON the wall now, so this single offset stands in for what
  // used to be the handle's own outward offset plus its label's).
  const labelOffsetMm = handleSizeMm * 4.5;
  const labelXMm = centerXMm + normal.xMm * labelOffsetMm;
  const labelYMm = centerYMm + normal.yMm * labelOffsetMm;

  // A generous hit target (~2.8x the visible square) keeps the handle easy to
  // grab even though the visible chip itself is small and sits flush on the
  // wall line rather than floating clear of it.
  const paddedSizeMm = handleSizeMm * 2.8;
  const baseClassName = isActive ? "resize-handle active" : "resize-handle";
  const handlePointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    onBeginDrag(placement.roomId, { anchor, axis, startLengthMm, targetWallId }, event);
  };

  return (
    <g>
      {/* Padded hit target rendered behind the visible handle */}
      <rect
        className={`${baseClassName} handle-hit`}
        height={paddedSizeMm}
        width={paddedSizeMm}
        x={centerXMm - paddedSizeMm / 2}
        y={centerYMm - paddedSizeMm / 2}
        onPointerDown={handlePointerDown}
      />
      <rect
        className={baseClassName}
        height={handleSizeMm}
        style={isActive ? undefined : { cursor }}
        width={handleSizeMm}
        x={centerXMm - handleSizeMm / 2}
        y={centerYMm - handleSizeMm / 2}
        onPointerDown={handlePointerDown}
      />
      {isActive ? (
        <text
          className="resize-handle-label"
          dominantBaseline="middle"
          textAnchor="middle"
          x={labelXMm}
          y={labelYMm}
          style={{
            // font-size/stroke-width are in SVG user units (mm), not CSS
            // px, since this SVG's viewBox already scales content to fit —
            // sizing off handleSizeMm (itself screen-px-per-mm-derived)
            // keeps the label a constant on-screen size at any room scale,
            // the same trick vector-effect="non-scaling-stroke" does for
            // wall strokes.
            fontSize: handleSizeMm * 1.8,
            strokeWidth: handleSizeMm * 0.5
          }}
        >
          {formatLength(displayLengthMm, { unit })}
        </text>
      ) : null}
    </g>
  );
}

function roomCentroidWorldMm(placement: RoomPlacement): Vector2 {
  const bounds = getRoomBounds(placement.room);
  return {
    xMm: (bounds.minX + bounds.maxX) / 2 + placement.offsetXMm,
    yMm: (bounds.minY + bounds.maxY) / 2 + placement.offsetYMm
  };
}

// Of a wall's two possible perpendiculars, the one pointing away from the
// room's centroid (in world space) — so the label sits outside the room
// regardless of the rectangle's vertex winding order.
function outwardNormal(
  wall: WallWithGeometry,
  placement: RoomPlacement,
  centroidMm: Vector2
): Vector2 {
  const axis = axisOf(wall);
  const candidate: Vector2 = { xMm: -axis.yMm, yMm: axis.xMm };

  const midXMm = (wall.start.xMm + wall.end.xMm) / 2 + placement.offsetXMm;
  const midYMm = (wall.start.yMm + wall.end.yMm) / 2 + placement.offsetYMm;
  const towardMidMm: Vector2 = { xMm: midXMm - centroidMm.xMm, yMm: midYMm - centroidMm.yMm };

  const dot = candidate.xMm * towardMidMm.xMm + candidate.yMm * towardMidMm.yMm;
  return dot < 0 ? { xMm: -candidate.xMm, yMm: -candidate.yMm } : candidate;
}

function axisOf(wall: WallWithGeometry): Vector2 {
  const dxMm = wall.end.xMm - wall.start.xMm;
  const dyMm = wall.end.yMm - wall.start.yMm;
  const lengthMm = Math.hypot(dxMm, dyMm) || 1;

  return { xMm: dxMm / lengthMm, yMm: dyMm / lengthMm };
}
