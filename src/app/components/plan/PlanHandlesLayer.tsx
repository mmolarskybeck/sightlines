import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { unitLeftNormalOrZero } from "../../../domain/geometry/vector";
import { changedWallLengthIds, isRectangleRoom } from "../../../domain/geometry/walls";
import {
  svgPolygonPoints,
  type PlanScenePartition,
  type PlanSceneRoom
} from "../../../domain/scene2d/planScene";
import type { DisplayUnit, RoomPlacement } from "../../../domain/project";
import { RoomResizeHandles, type ResizeHandleTarget } from "./RoomResizeHandles";
import { RoomReshapeHandles } from "./RoomReshapeHandles";
import { WallSlideHandles } from "./WallSlideHandles";
import { WallLengthLabels } from "./WallLengthLabels";
import type { DragState, PartitionDragState, VertexDragState, WallDragState } from "./types";

// Render-only selection-decoration layer: the selected room's wash/outline plus
// its (mutually exclusive) resize / wall-slide / reshape handle set and live
// wall-length labels, followed by the selected partition's A/B face labels and
// its two endpoint handles. Both blocks paint above placed objects, exactly as
// PlanView painted them inline. The layer owns no drag state — it reads the
// live drag previews (drag/vertexDrag/wallDrag/partitionDrag) and calls the
// begin-drag callbacks PlanView threads through.
export type PlanHandlesLayerProps = {
  rooms: PlanSceneRoom[];
  partitions: PlanScenePartition[];
  // The COMMITTED room placements (project.floor.rooms), diffed against the
  // displayed placement to label whichever walls a live reshape is changing.
  committedRooms: RoomPlacement[];
  selectedRoomId: string | null;
  selectedFreestandingWallId: string | null;
  reshapeRoomId: string | null;
  handleSizeMm: number;
  wallUnit: DisplayUnit;
  hoveredWallId: string | null;
  selectedVertexId: string | null;
  drag: DragState | null;
  vertexDrag: VertexDragState | null;
  wallDrag: WallDragState | null;
  partitionDrag: PartitionDragState | null;
  beginDrag: (
    roomId: string,
    target: ResizeHandleTarget,
    event: ReactPointerEvent<SVGRectElement>
  ) => void;
  beginWallDrag: (roomId: string, wallId: string, event: ReactPointerEvent<SVGElement>) => void;
  beginVertexDrag: (
    roomId: string,
    vertexId: string,
    event: ReactPointerEvent<SVGRectElement>
  ) => void;
  handleSplitWallClick: (wallId: string, event: ReactMouseEvent<SVGElement>) => void;
  beginPartitionDrag: (
    partition: PlanScenePartition["partition"],
    mode: "move" | "start" | "end",
    event: ReactPointerEvent<SVGElement>
  ) => void;
  // Snapshot rendering mode (docs/export-spec.md §10.2): suppresses the
  // room's wash/outline/handle set and the selected partition's face labels
  // + endpoint handles (pure selection chrome), while keeping the live wall
  // length labels — the dimension content this layer draws for a selection.
  exportMode?: boolean;
};

export function PlanHandlesLayer({
  rooms,
  partitions,
  committedRooms,
  selectedRoomId,
  selectedFreestandingWallId,
  reshapeRoomId,
  handleSizeMm,
  wallUnit,
  hoveredWallId,
  selectedVertexId,
  drag,
  vertexDrag,
  wallDrag,
  partitionDrag,
  beginDrag,
  beginWallDrag,
  beginVertexDrag,
  handleSplitWallClick,
  beginPartitionDrag,
  exportMode = false
}: PlanHandlesLayerProps) {
  return (
    <>
      {/* The selected room's outline/wash/handles paint in their own layer
          ABOVE placed objects — at rest a room shows none of this (no
          outline, no wash, no handles), so this block renders at most once,
          for whichever room selectedRoomId names. */}
      {(() => {
        const selectedSceneRoom = rooms.find((room) => room.roomId === selectedRoomId);
        if (!selectedSceneRoom || handleSizeMm <= 0) return null;
        const selectedPlacement = selectedSceneRoom.placement;

        const isReshaping = reshapeRoomId === selectedPlacement.roomId;
        const vertexDragInvalid =
          isReshaping && vertexDrag?.roomId === selectedPlacement.roomId && !vertexDrag.valid;
        // A wall slide only happens in the selected-default mode (not while
        // armed for edit-shape), so its invalid tint is independent of
        // isReshaping — the outline reads danger whenever the live slide is
        // invalid for this room.
        const wallDragInvalid =
          wallDrag?.roomId === selectedPlacement.roomId && !wallDrag.valid;

        // "A number sits on the wall it measures": during any reshape
        // gesture on this room (chip resize, wall slide, vertex drag), diff
        // the drag preview (selectedPlacement, from displayedProject)
        // against the committed room — every wall whose length is changing
        // labels itself. One derivation covers all three gestures,
        // including a slide between non-parallel neighbours changing the
        // dragged wall's own length. A whole-room move translates without
        // reshaping, so it's excluded rather than diffed to nothing.
        const reshapeDragActive =
          drag?.roomId === selectedPlacement.roomId ||
          wallDrag?.roomId === selectedPlacement.roomId ||
          vertexDrag?.roomId === selectedPlacement.roomId;
        const baselinePlacement = reshapeDragActive
          ? committedRooms.find(
              (placement) => placement.roomId === selectedPlacement.roomId
            )
          : undefined;
        const changedWallIds = baselinePlacement
          ? changedWallLengthIds(baselinePlacement.room, selectedPlacement.room)
          : [];

        return (
          <g>
            {/* Wash/outline/handle-fork are pure selection chrome — suppressed
                in exportMode. WallLengthLabels below is the dimension content
                a snapshot must keep, so it renders regardless. */}
            {exportMode ? null : (
              <>
                <polygon
                  className="room-selection-wash"
                  points={svgPolygonPoints(selectedSceneRoom.polygonMm)}
                />
                <polygon
                  className="room-selection-outline"
                  points={svgPolygonPoints(selectedSceneRoom.polygonMm)}
                  vectorEffect="non-scaling-stroke"
                  style={vertexDragInvalid || wallDragInvalid ? { stroke: "var(--danger)" } : undefined}
                />
                {/* Three-way handle fork, mutually exclusive per the invariant:
                    edit-shape armed → corner/split handles only; else a rectangle
                    keeps its resize chips; else a non-rectangle gets wall-slide
                    chips. Exactly one control set ever renders for a room. */}
                {isReshaping ? (
                  <RoomReshapeHandles
                    activeVertexId={vertexDrag?.roomId === selectedPlacement.roomId ? vertexDrag.vertexId : null}
                    handleSizeMm={handleSizeMm}
                    invalid={vertexDragInvalid}
                    placement={selectedPlacement}
                    selectedVertexId={selectedVertexId}
                    onBeginVertexDrag={(vertexId, event) =>
                      beginVertexDrag(selectedPlacement.roomId, vertexId, event)
                    }
                    onSplitWallClick={handleSplitWallClick}
                  />
                ) : isRectangleRoom(selectedPlacement.room) ? (
                  <RoomResizeHandles
                    activeDrag={
                      drag && drag.roomId === selectedPlacement.roomId
                        ? { targetWallId: drag.targetWallId, anchor: drag.anchor }
                        : null
                    }
                    handleSizeMm={handleSizeMm}
                    placement={selectedPlacement}
                    onBeginDrag={beginDrag}
                  />
                ) : (
                  <WallSlideHandles
                    activeDrag={
                      wallDrag?.roomId === selectedPlacement.roomId
                        ? { wallId: wallDrag.wallId, valid: wallDrag.valid }
                        : null
                    }
                    handleSizeMm={handleSizeMm}
                    highlightedWallId={hoveredWallId}
                    placement={selectedPlacement}
                    onBeginWallDrag={(wallId, event) =>
                      beginWallDrag(selectedPlacement.roomId, wallId, event)
                    }
                  />
                )}
              </>
            )}
            {/* Live length labels compose as a sibling layer over whichever
                handle set is active — the handle components never label
                anything themselves. */}
            <WallLengthLabels
              changedWallIds={changedWallIds}
              handleSizeMm={handleSizeMm}
              invalid={vertexDragInvalid || wallDragInvalid}
              placement={selectedPlacement}
              unit={wallUnit}
            />
          </g>
        );
      })()}
      {/* Selected partition: A/B face labels and the two endpoint handles
          (resize/re-angle), painted above placed objects so they stay
          grabbable. The body itself is the move affordance (slab rect above).
          Both are selection chrome (not dimension content — PartitionDimensionLines
          owns that), so exportMode suppresses this whole block. */}
      {!exportMode && selectedFreestandingWallId && handleSizeMm > 0
        ? (() => {
            const partition = partitions.find(
              (candidate) => candidate.partition.wallId === selectedFreestandingWallId
            )?.partition;
            if (!partition) return null;
            const isDragging = partitionDrag?.wallId === partition.wallId;
            const startMm = isDragging ? partitionDrag.previewStartFloorMm : partition.startMm;
            const endMm = isDragging ? partitionDrag.previewEndFloorMm : partition.endMm;
            const { xMm: nx, yMm: ny } = unitLeftNormalOrZero(startMm, endMm);
            const midX = (startMm.xMm + endMm.xMm) / 2;
            const midY = (startMm.yMm + endMm.yMm) / 2;
            const labelOffsetMm = partition.thicknessMm / 2 + handleSizeMm * 1.6;
            const handle = handleSizeMm;
            const endpoints: { end: "start" | "end"; xMm: number; yMm: number }[] = [
              { end: "start", xMm: startMm.xMm, yMm: startMm.yMm },
              { end: "end", xMm: endMm.xMm, yMm: endMm.yMm }
            ];
            return (
              <g className="partition-selected-layer">
                {[
                  { label: "A", ox: nx, oy: ny },
                  { label: "B", ox: -nx, oy: -ny }
                ].map(({ label, ox, oy }) => (
                  <text
                    key={label}
                    x={midX + ox * labelOffsetMm}
                    y={midY + oy * labelOffsetMm}
                    dominantBaseline="middle"
                    textAnchor="middle"
                    style={{
                      fontSize: handle * 1.6,
                      fill: "var(--selection)",
                      fontWeight: 600,
                      pointerEvents: "none",
                      userSelect: "none"
                    }}
                  >
                    {label}
                  </text>
                ))}
                {endpoints.map(({ end, xMm, yMm }) => (
                  <g key={end}>
                    <rect
                      className="resize-handle handle-hit"
                      x={xMm - handle * 1.4}
                      y={yMm - handle * 1.4}
                      width={handle * 2.8}
                      height={handle * 2.8}
                      style={{ cursor: "move" }}
                      onPointerDown={(event) => beginPartitionDrag(partition, end, event)}
                    />
                    <rect
                      className="resize-handle active"
                      x={xMm - handle / 2}
                      y={yMm - handle / 2}
                      width={handle}
                      height={handle}
                      style={{ cursor: "move", pointerEvents: "none" }}
                    />
                  </g>
                ))}
              </g>
            );
          })()
        : null}
    </>
  );
}
