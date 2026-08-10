import {
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

// Render-only structure layer: room wall lines, the per-room transparent hit
// polygons, the walls' invisible hit strokes, and the free-standing partition
// slabs — the contiguous, non-interactive-state groups PlanView used to paint
// inline between the grid and the placed objects. The layer owns no state, only
// forwards data + callbacks from PlanView.
//
// Paint order is wall LINES → room-hit → wall HIT strokes → partitions. The
// split between a wall's line and its hit stroke is deliberate: a room's hit
// polygon covers its own interior, so a hit stroke painted beside its line lost
// its inner half to that polygon, leaving a wall clickable only from a ~7px
// sliver on its outside — and where two rooms abut, the neighbour's polygon
// covered that sliver too, making a shared wall completely unselectable.
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
  // SVGElement, not SVGPolygonElement: both the room-hit polygon and the
  // wall-hit strokes (which now paint above it) can start a room drag.
  beginRoomDrag: (roomId: string, event: ReactPointerEvent<SVGElement>) => void;
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
            const isPicked = wall.wallId === selectedWallId;
            // An open wall draws NO line at rest: the gap is the signal, and a
            // dashed line at rest would read as hidden or overhead
            // construction, which is the wrong meaning entirely. It gets a
            // faint dashed affordance when picked (and, via CSS :has(), on
            // hover — the slideHoverEligible state above is a different thing,
            // scoped to selected non-rectangular rooms). The .wall-hit stroke
            // below is untouched, which is what keeps an open wall clickable at
            // all. The unambiguous, always-visible statement lives in the Rooms
            // panel row.
            const classes = wall.isOpenSide
              ? isPicked
                ? "wall-line open affordance"
                : "wall-line open"
              : isPicked || isHovered
                ? "wall-line active"
                : "wall-line";
            return (
              <line
                key={wall.wallId}
                className={classes}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      ))}
      {/* Transparent hit polygon per room, painted after the wall LINES so it
          sits above them but still below placed objects (later block) — those
          must keep winning their own clicks by paint order.
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
      {/* Invisible, wide hit strokes — a SEPARATE pass, painted after EVERY
          room-hit polygon rather than beside their own wall lines.

          That ordering is the whole point. A room's hit polygon covers its own
          interior, so when the strokes lived next to the lines the polygon ate
          the inner half of each 14px band and a wall was clickable only from a
          ~7px sliver on its outside. Where two rooms abut, the neighbour's
          polygon covered that sliver too and the shared wall became completely
          unreachable — no pointer cursor, no way to select it, and (since open
          walls draw nothing) no way to restore one.

          Still below partitions and placed objects, which come later and keep
          winning their own clicks by paint order alone. */}
      {rooms.map((room) => {
        const isSelectedRoom = room.roomId === selectedRoomId;
        const slideHoverEligible =
          isSelectedRoom &&
          reshapeRoomId !== room.roomId &&
          !isRectangleRoom(room.placement.room);
        return (
          <g key={room.roomId}>
            {room.walls.map((wall) => (
              <line
                key={wall.wallId}
                className="wall-hit"
                x1={wall.startMm.xMm}
                y1={wall.startMm.yMm}
                x2={wall.endMm.xMm}
                y2={wall.endMm.yMm}
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
                onPointerDown={(event) => {
                  // These strokes now sit ABOVE the room-hit polygon, so
                  // without this a drag started on a selected room's edge band
                  // would fall through to the background marquee instead of
                  // moving the room. Same contract as the polygon's handler:
                  // unselected rooms let it bubble so the marquee still works.
                  if (activeTool || !isSelectedRoom) return;
                  event.stopPropagation();
                  beginRoomDrag(room.roomId, event);
                }}
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
            ))}
          </g>
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
