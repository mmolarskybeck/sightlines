import type { PointerEvent as ReactPointerEvent } from "react";
import type { Vector2 } from "../../../domain/geometry/dragResize";
import {
  getWallsWithGeometry,
  outwardWallNormal,
  type WallWithGeometry
} from "../../../domain/geometry/walls";
import type { RoomPlacement } from "../../../domain/project";

// The in-flight wall slide, mirrored down from PlanView's wallDrag state. The
// chip for `wallId` renders with the "active" treatment and tints to the
// danger token while `valid` is false — same idiom as RoomReshapeHandles'
// invalid vertices. The chip shows no numbers: the walls whose lengths the
// slide changes carry their own live labels (WallLengthLabels, composed by
// PlanView).
export type ActiveWallSlideDrag = {
  wallId: string;
  valid: boolean;
};

// Selected-mode handles for a NON-rectangular room (rectangles keep
// RoomResizeHandles). One chip per wall midpoint; dragging a chip slides that
// whole wall along its perpendicular via PlanView's beginWallDrag (moveRoomWall
// path). This is wall sliding only — corner/topology editing lives in the armed
// edit-shape mode (RoomReshapeHandles), never here. `placement` already carries
// the live wallDrag preview (PlanView layers it into displayedProject), so this
// component draws whatever polygon it's given and never computes drag math.
export function WallSlideHandles({
  activeDrag,
  handleSizeMm,
  highlightedWallId,
  placement,
  onBeginWallDrag
}: {
  activeDrag: ActiveWallSlideDrag | null;
  handleSizeMm: number;
  // The wall edge the pointer is hovering (PlanView tracks this on the wall-hit
  // strokes); its chip renders with the stronger "active" treatment so the wall
  // and its chip point at each other.
  highlightedWallId: string | null;
  placement: RoomPlacement;
  onBeginWallDrag: (wallId: string, event: ReactPointerEvent<SVGRectElement>) => void;
}) {
  if (handleSizeMm <= 0) return null;

  const walls = getWallsWithGeometry(placement.room);

  // A generous hit target (~2.8x the visible square) keeps the chip easy to
  // grab, matching RoomResizeHandles. Walls too short to host that cleanly hide
  // their chip (they stay editable via Edit shape), so measure against it.
  const paddedSizeMm = handleSizeMm * 2.8;

  return (
    <>
      {walls.map((wall) => {
        // Crowded walls: no room for the chip without it swamping the wall, so
        // skip it. Short walls remain reachable through Edit shape mode.
        if (wall.lengthMm < paddedSizeMm * 3) return null;
        return (
          <WallSlideHandle
            activeDrag={activeDrag}
            handleSizeMm={handleSizeMm}
            highlighted={highlightedWallId === wall.id}
            key={wall.id}
            paddedSizeMm={paddedSizeMm}
            placement={placement}
            wall={wall}
            onBeginWallDrag={onBeginWallDrag}
          />
        );
      })}
    </>
  );
}

function WallSlideHandle({
  activeDrag,
  handleSizeMm,
  highlighted,
  paddedSizeMm,
  placement,
  wall,
  onBeginWallDrag
}: {
  activeDrag: ActiveWallSlideDrag | null;
  handleSizeMm: number;
  highlighted: boolean;
  paddedSizeMm: number;
  placement: RoomPlacement;
  wall: WallWithGeometry;
  onBeginWallDrag: (wallId: string, event: ReactPointerEvent<SVGRectElement>) => void;
}) {
  const centerXMm = (wall.start.xMm + wall.end.xMm) / 2 + placement.offsetXMm;
  const centerYMm = (wall.start.yMm + wall.end.yMm) / 2 + placement.offsetYMm;
  const normal = outwardWallNormal(placement.room, wall);

  const isDragging = activeDrag?.wallId === wall.id;
  const invalid = isDragging ? !activeDrag.valid : false;
  // The chip is stronger while hovered OR mid-drag — React hover state drives
  // the former, PlanView's highlightedWallId (hovering the wall edge) the same.
  const isActive = highlighted || isDragging;
  const size = handleSizeMm;

  // The chip slides its wall PERPENDICULAR to the wall's own axis, so the
  // cursor communicates the normal's direction (not the wall's). Generalizes
  // RoomResizeHandles' axis test to all four diagonal buckets.
  const cursor = perpendicularCursor(normal);

  const baseClassName = isActive ? "resize-handle active" : "resize-handle";
  const dangerStyle = invalid ? { fill: "var(--danger)", stroke: "var(--danger)" } : {};
  const handlePointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    onBeginWallDrag(wall.id, event);
  };

  return (
    <g>
      {/* Padded hit target rendered behind the visible chip */}
      <rect
        className={`${baseClassName} handle-hit`}
        height={paddedSizeMm}
        width={paddedSizeMm}
        x={centerXMm - paddedSizeMm / 2}
        y={centerYMm - paddedSizeMm / 2}
        style={{ cursor }}
        onPointerDown={handlePointerDown}
      />
      <rect
        className={baseClassName}
        height={size}
        width={size}
        x={centerXMm - size / 2}
        y={centerYMm - size / 2}
        style={{ cursor, ...dangerStyle }}
        onPointerDown={handlePointerDown}
      />
    </g>
  );
}

// Bucket the chip's travel direction (the wall's perpendicular) into the four
// resize cursors. Near-axis-aligned normals read ns-/ew-resize; diagonals split
// by the sign product into the two mirrored diagonal cursors. Generalizes the
// two-way axis test in RoomResizeHandles.
function perpendicularCursor(normal: Vector2): string {
  const absX = Math.abs(normal.xMm);
  const absY = Math.abs(normal.yMm);
  // A wall's perpendicular that is dominantly horizontal/vertical reads as a
  // straight resize cursor; only genuinely diagonal travel gets the diagonal
  // arrows (tan 22.5° ≈ 0.414 splits the octants).
  const diagonalThreshold = 0.414;
  const minor = Math.min(absX, absY);
  const major = Math.max(absX, absY);
  if (major === 0 || minor / major < diagonalThreshold) {
    return absX >= absY ? "ew-resize" : "ns-resize";
  }
  // Same-sign components point along the main diagonal (↘/↖), opposite signs
  // along the anti-diagonal (↗/↙).
  return normal.xMm * normal.yMm > 0 ? "nwse-resize" : "nesw-resize";
}
