import type { Project } from "../project";
import { getWallGeometry } from "./walls";

export type Vector2 = {
  xMm: number;
  yMm: number;
};

// A sane floor during interactive drag so a fast pointer movement can't
// collapse a room to a degenerate near-zero size mid-gesture. The final
// committed value still goes through resizeWallPreservingAngles's own
// >0 check on release.
export const MIN_DRAG_LENGTH_MM = 152.4; // 6 inches

// resizeOrthogonalQuad (editRoom.ts) always anchors a resized wall's
// startVertexId and moves its endVertexId along the wall's own axis — so
// the wall's end vertex, in floor/world coordinates, *is* the point a
// resize drag actually moves. Snapping needs to operate on that point, not
// on wherever inside the 16px handle hit-target the user happened to grab,
// or the grab offset leaks into the committed length even when the pointer
// itself lands exactly on a grid line.
export function getMovingWallEdgeWorldPointMm(
  project: Project,
  wallId: string
): Vector2 {
  for (const placement of project.floor.rooms) {
    const wall = placement.room.walls.find((candidate) => candidate.id === wallId);
    if (!wall) continue;

    const geometry = getWallGeometry(placement.room, wall);
    return {
      xMm: geometry.end.xMm + placement.offsetXMm,
      yMm: geometry.end.yMm + placement.offsetYMm
    };
  }

  throw new Error(`Wall not found: ${wallId}`);
}

// The grab offset is constant for the whole gesture, so translating the
// edge's start position by the raw pointer's movement gives the edge's
// proposed world position with that offset already cancelled out — same
// result as if the pointer had started exactly on the edge.
export function proposeMovingEdgePointMm(
  edgeStartMm: Vector2,
  pointerStartMm: Vector2,
  pointerNowMm: Vector2
): Vector2 {
  return {
    xMm: edgeStartMm.xMm + (pointerNowMm.xMm - pointerStartMm.xMm),
    yMm: edgeStartMm.yMm + (pointerNowMm.yMm - pointerStartMm.yMm)
  };
}

export function projectDeltaOntoAxis(deltaMm: Vector2, axis: Vector2): number {
  return deltaMm.xMm * axis.xMm + deltaMm.yMm * axis.yMm;
}

// Dragging a handle moves the pointer freely in 2D, but a wall's length is
// one-dimensional — only the pointer's movement along that wall's own axis
// direction should affect it. Using the dot product (rather than hardcoding
// "x means width, y means depth") keeps this correct regardless of which
// wall of the pair happens to carry which dimension.
export function computeDraggedLengthMm(
  startLengthMm: number,
  deltaMm: Vector2,
  axis: Vector2
): number {
  const projectedDeltaMm = projectDeltaOntoAxis(deltaMm, axis);
  return Math.max(MIN_DRAG_LENGTH_MM, startLengthMm + projectedDeltaMm);
}

// Bundles "how far did the moving edge actually travel" with "what length
// does that produce" so callers (PlanView) never reconstruct the
// edge-minus-edgeStart subtraction inline — the whole point of snapping the
// edge instead of the pointer is that this delta is the wall's true
// movement, with the handle's grab offset already excluded.
export function computeEdgeSnappedLengthMm(
  startLengthMm: number,
  edgeStartMm: Vector2,
  snappedEdgeMm: Vector2,
  axis: Vector2
): number {
  const deltaMm: Vector2 = {
    xMm: snappedEdgeMm.xMm - edgeStartMm.xMm,
    yMm: snappedEdgeMm.yMm - edgeStartMm.yMm
  };
  return computeDraggedLengthMm(startLengthMm, deltaMm, axis);
}
