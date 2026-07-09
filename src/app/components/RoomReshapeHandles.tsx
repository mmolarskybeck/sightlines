import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { getWallsWithGeometry } from "../../domain/geometry/walls";
import type { RoomPlacement } from "../../domain/project";

// Reshape mode's handles: a sibling to RoomResizeHandles (that one stays
// rectangle-only and untouched), rendered instead of it while this room is
// the one PlanView has armed for reshape (App.tsx's reshapeRoomId). `placement`
// is expected to already carry any live vertex-drag preview (PlanView layers
// that into displayedProject before passing it down here), so this component
// never computes drag math itself — it just draws whatever polygon it's given.
export function RoomReshapeHandles({
  activeVertexId,
  handleSizeMm,
  invalid,
  placement,
  selectedVertexId,
  onBeginVertexDrag,
  onBeginWallDrag,
  onSplitWallClick
}: {
  // The vertex currently being dragged (if any) — rendered larger, same idea
  // as RoomResizeHandles' isActive handle.
  activeVertexId: string | null;
  handleSizeMm: number;
  // The in-flight drag (if any) would leave this room a non-simple polygon —
  // every vertex handle (and the room outline, painted by the caller) reads
  // in the danger token while true.
  invalid: boolean;
  placement: RoomPlacement;
  // A vertex selected (but not necessarily mid-drag) for the Delete/Backspace
  // merge shortcut — rendered with the same "active" treatment.
  selectedVertexId: string | null;
  onBeginVertexDrag: (vertexId: string, event: ReactPointerEvent<SVGRectElement>) => void;
  // Dragging the wall's own body (not a vertex, not the split "+") slides the
  // whole wall along its perpendicular — see PlanView's beginWallDrag.
  onBeginWallDrag: (wallId: string, event: ReactPointerEvent<SVGLineElement>) => void;
  onSplitWallClick: (wallId: string, event: ReactMouseEvent<SVGElement>) => void;
}) {
  if (handleSizeMm <= 0) return null;

  const walls = getWallsWithGeometry(placement.room);
  const vertexSizeMm = handleSizeMm;
  const splitSizeMm = handleSizeMm * 0.85;

  return (
    <g className="room-reshape-layer">
      {/* Wall-body hit targets paint FIRST (bottom of this layer) so the split
          "+" handles and vertex handles below, both rendered after, always
          win a click in their own (larger, padded) hit zones. A wide
          transparent stroke along the wall's own centerline is a simpler hit
          target than a rotated rect and works identically at any angle. */}
      {walls.map((wall) => (
        <line
          key={`wall-body-${wall.id}`}
          className="room-reshape-wall-hit"
          x1={wall.start.xMm + placement.offsetXMm}
          y1={wall.start.yMm + placement.offsetYMm}
          x2={wall.end.xMm + placement.offsetXMm}
          y2={wall.end.yMm + placement.offsetYMm}
          style={{
            cursor: "move",
            stroke: "transparent",
            strokeWidth: handleSizeMm * 2.2,
            pointerEvents: "stroke"
          }}
          onPointerDown={(event) => onBeginWallDrag(wall.id, event)}
        />
      ))}
      {walls.map((wall) => {
        const midXMm = (wall.start.xMm + wall.end.xMm) / 2 + placement.offsetXMm;
        const midYMm = (wall.start.yMm + wall.end.yMm) / 2 + placement.offsetYMm;
        return (
          <g key={`split-${wall.id}`}>
            {/* Generous invisible hit target behind the small visible "+". */}
            <rect
              className="resize-handle handle-hit"
              height={splitSizeMm * 2.6}
              width={splitSizeMm * 2.6}
              x={midXMm - splitSizeMm * 1.3}
              y={midYMm - splitSizeMm * 1.3}
              style={{ cursor: "copy" }}
              onClick={(event) => {
                event.stopPropagation();
                onSplitWallClick(wall.id, event);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            />
            <rect
              className="resize-handle"
              height={splitSizeMm}
              width={splitSizeMm}
              x={midXMm - splitSizeMm / 2}
              y={midYMm - splitSizeMm / 2}
              style={{ cursor: "copy", pointerEvents: "none" }}
            />
            <text
              dominantBaseline="middle"
              textAnchor="middle"
              x={midXMm}
              y={midYMm}
              style={{
                fontSize: splitSizeMm * 1.3,
                fill: "var(--selection)",
                pointerEvents: "none",
                userSelect: "none"
              }}
            >
              +
            </text>
          </g>
        );
      })}
      {placement.room.vertices.map((vertex) => {
        const xMm = vertex.xMm + placement.offsetXMm;
        const yMm = vertex.yMm + placement.offsetYMm;
        const isActive = vertex.id === activeVertexId || vertex.id === selectedVertexId;
        const size = isActive ? vertexSizeMm * 1.4 : vertexSizeMm;
        const paddedSizeMm = size * 2.8;

        return (
          <g key={vertex.id}>
            <rect
              className="resize-handle handle-hit"
              height={paddedSizeMm}
              width={paddedSizeMm}
              x={xMm - paddedSizeMm / 2}
              y={yMm - paddedSizeMm / 2}
              style={{ cursor: "move" }}
              onPointerDown={(event) => onBeginVertexDrag(vertex.id, event)}
            />
            <rect
              className={isActive ? "resize-handle active" : "resize-handle"}
              height={size}
              width={size}
              x={xMm - size / 2}
              y={yMm - size / 2}
              style={{
                cursor: "move",
                pointerEvents: "none",
                ...(invalid ? { fill: "var(--danger)", stroke: "var(--danger)" } : {})
              }}
            />
          </g>
        );
      })}
    </g>
  );
}
