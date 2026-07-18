import {
  Fragment,
  type Dispatch,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from "react";
import { isRectangleRoom } from "../../../domain/geometry/walls";
import { segmentPlanRect } from "../../../domain/geometry/planObjects";
import {
  svgPolygonPoints,
  type PlanScenePartition,
  type PlanSceneRoom
} from "../../../domain/scene2d/planScene";
import type { InsertToolKind } from "../../../domain/placement/createOpening";
import type { FloorPartition } from "../../../domain/geometry/freestandingWalls";
import type { PartitionDragState } from "./types";

// Render-only structure layer: room walls (with their hover/hit strokes), the
// per-room transparent hit polygons, and the free-standing partition slabs —
// the three contiguous, non-interactive-state groups PlanView used to paint
// inline between the grid and the placed objects. Paint order is preserved
// exactly (walls → room-hit → partitions), and every event handler stays
// attached to the same element it was before; the layer owns no state, only
// forwards data + callbacks from PlanView.
export type PlanStructureLayerProps = {
  rooms: PlanSceneRoom[];
  partitions: PlanScenePartition[];
  selectedRoomId: string | null;
  reshapeRoomId: string | null;
  selectedWallId: string | null;
  hoveredWallId: string | null;
  selectedFreestandingWallId: string | null;
  activeTool: InsertToolKind | null;
  drawRoomActive: boolean;
  drawRectActive: boolean;
  partitionToolActive: boolean;
  partitionDrag: PartitionDragState | null;
  suppressNextToolClickRef: MutableRefObject<boolean>;
  setHoveredWallId: Dispatch<SetStateAction<string | null>>;
  onSelectWall?: (wallId: string) => void;
  onSelectRoom?: (roomId: string) => void;
  onReshapeRoomChange?: (roomId: string | null) => void;
  onSelectFreestandingWall?: (wallId: string) => void;
  beginRoomDrag: (roomId: string, event: ReactPointerEvent<SVGPolygonElement>) => void;
  beginPartitionDrag: (
    partition: FloorPartition,
    mode: "move" | "start" | "end",
    event: ReactPointerEvent<SVGElement>
  ) => void;
};

export function PlanStructureLayer({
  rooms,
  partitions,
  selectedRoomId,
  reshapeRoomId,
  selectedWallId,
  hoveredWallId,
  selectedFreestandingWallId,
  activeTool,
  drawRoomActive,
  drawRectActive,
  partitionToolActive,
  partitionDrag,
  suppressNextToolClickRef,
  setHoveredWallId,
  onSelectWall,
  onSelectRoom,
  onReshapeRoomChange,
  onSelectFreestandingWall,
  beginRoomDrag,
  beginPartitionDrag
}: PlanStructureLayerProps) {
  return (
    <>
      {rooms.map((room) => (
        <g key={room.roomId}>
          {room.walls.map((wall) => {
            const x1 = wall.startMm.xMm;
            const y1 = wall.startMm.yMm;
            const x2 = wall.endMm.xMm;
            const y2 = wall.endMm.yMm;

            // Teach the wall→chip link for a selected non-rectangle: hovering
            // this edge lights the wall and its WallSlideHandles chip. Only
            // eligible when the room is selected, not armed for edit-shape,
            // and non-rectangular (rectangles use resize chips, not slides).
            const slideHoverEligible =
              room.roomId === selectedRoomId &&
              reshapeRoomId !== room.roomId &&
              !isRectangleRoom(room.placement.room);
            const isHovered = slideHoverEligible && hoveredWallId === wall.wallId;
            return (
              <Fragment key={wall.wallId}>
                <line
                  className={
                    wall.wallId === selectedWallId || isHovered
                      ? "wall-line active"
                      : "wall-line"
                  }
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  vectorEffect="non-scaling-stroke"
                />
                {/* Invisible, wide hit target painted on top of the visible
                    line so it owns the click — wall-anchored doors/windows
                    render in a later section of this svg, so they still
                    paint above this and keep winning clicks by paint order
                    alone, no z-ordering code needed. Hover here only teaches
                    the chip link; the edge stays click-to-select, never
                    draggable. */}
                <line
                  className="wall-hit"
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  vectorEffect="non-scaling-stroke"
                  onPointerEnter={
                    slideHoverEligible ? () => setHoveredWallId(wall.wallId) : undefined
                  }
                  onPointerLeave={
                    slideHoverEligible
                      ? () =>
                          setHoveredWallId((current) =>
                            current === wall.wallId ? null : current
                          )
                      : undefined
                  }
                  onClick={(event) => {
                    // TRAP 1 — armed placement tool: doors/windows are
                    // click-placed ON walls via handleSvgClick's tool
                    // branch. Swallowing this click would break
                    // click-to-place entirely, so with a tool armed the
                    // wall is inert and the click bubbles through to the
                    // svg handler.
                    if (activeTool) return;
                    event.stopPropagation();
                    // TRAP 2 — a marquee that starts AND ends on this
                    // wall's hit stroke fires its trailing click here
                    // instead of on the svg, so handleSvgClick never
                    // consumes the suppression flag. Consuming it here
                    // keeps that click from hijacking the fresh marquee
                    // selection into a wall select (selectWall drops
                    // multi-select by design).
                    if (suppressNextToolClickRef.current) {
                      suppressNextToolClickRef.current = false;
                      return;
                    }
                    onSelectWall?.(wall.wallId);
                  }}
                />
              </Fragment>
            );
          })}
        </g>
      ))}
      {/* Transparent hit polygon per room, painted after the walls so it
          sits above the wall lines but still below placed objects (next
          block) — those must keep winning their own clicks by paint order.
          At rest a room is otherwise unclickable chrome; this is the only
          surface that turns a plain floor click into a selection. */}
      {rooms.map((room) => {
        const isSelected = room.roomId === selectedRoomId;
        return (
          <polygon
            className={isSelected ? "room-hit selected" : "room-hit"}
            key={room.roomId}
            points={svgPolygonPoints(room.polygonMm)}
            onPointerDown={(event) => {
              // Unselected: let the pointerdown bubble untouched — a drag
              // from here must still be able to start the background
              // marquee (marquee-selecting placements inside a room is an
              // existing feature this must not break). Selected: this
              // polygon IS the move affordance now (the old corner grip is
              // gone), so it claims the gesture the same way a resize
              // handle does.
              if (!isSelected) return;
              event.stopPropagation();
              beginRoomDrag(room.roomId, event);
            }}
            onClick={(event) => {
              // Mirrors the wall-hit TRAP comments above: an armed tool
              // must click through to place, and a marquee's trailing
              // click (suppressNextToolClickRef, set by the marquee's own
              // pointerup) must not be reinterpreted as a room select.
              if (activeTool) return;
              event.stopPropagation();
              if (suppressNextToolClickRef.current) {
                suppressNextToolClickRef.current = false;
                return;
              }
              onSelectRoom?.(room.roomId);
            }}
            onDoubleClick={(event) => {
              // Shortcut for RoomInspector's "Edit shape" button — selects
              // the room (if it wasn't already) and arms reshape mode on it
              // in one gesture.
              if (activeTool || drawRoomActive || drawRectActive) return;
              event.stopPropagation();
              onSelectRoom?.(room.roomId);
              onReshapeRoomChange?.(room.roomId);
            }}
          />
        );
      })}
      {/* Partition slabs — filled rects for each free-standing wall, painted
          above the room-hit polygon so a slab click selects the PARTITION
          (its centerline id), not the room. Rendered below placed objects so
          art on the faces sits on top. The dragged slab shows its live
          preview endpoints. */}
      {partitions.map(({ partition, rect: restRect }) => {
        const isDragging = partitionDrag?.wallId === partition.wallId;
        // The dragged slab previews its live endpoints through the same
        // segment→rect lift the scene builder used for the rest rect.
        const rect = isDragging
          ? segmentPlanRect(
              partitionDrag.previewStartFloorMm,
              partitionDrag.previewEndFloorMm,
              partition.thicknessMm
            )
          : restRect;
        const isSelected = partition.wallId === selectedFreestandingWallId;
        return (
          <rect
            key={partition.wallId}
            x={rect.centerXMm - rect.widthMm / 2}
            y={rect.centerYMm - rect.depthMm / 2}
            width={rect.widthMm}
            height={rect.depthMm}
            transform={`rotate(${rect.angleDeg} ${rect.centerXMm} ${rect.centerYMm})`}
            style={{
              fill: "var(--ink)",
              fillOpacity: isSelected ? 0.9 : 0.72,
              stroke: isSelected ? "var(--selection)" : "transparent",
              strokeWidth: 2,
              cursor: partitionToolActive ? "crosshair" : "move",
              vectorEffect: "non-scaling-stroke"
            }}
            onPointerDown={(event) => {
              if (
                activeTool ||
                drawRoomActive ||
                partitionToolActive ||
                drawRectActive ||
                reshapeRoomId
              )
                return;
              beginPartitionDrag(partition, "move", event);
            }}
            onClick={(event) => {
              if (activeTool || partitionToolActive) return;
              event.stopPropagation();
              if (suppressNextToolClickRef.current) {
                suppressNextToolClickRef.current = false;
                return;
              }
              onSelectFreestandingWall?.(partition.wallId);
            }}
          />
        );
      })}
    </>
  );
}
