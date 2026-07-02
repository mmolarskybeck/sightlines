export type Vector2 = {
  xMm: number;
  yMm: number;
};

// A sane floor during interactive drag so a fast pointer movement can't
// collapse a room to a degenerate near-zero size mid-gesture. The final
// committed value still goes through resizeWallPreservingAngles's own
// >0 check on release.
export const MIN_DRAG_LENGTH_MM = 152.4; // 6 inches

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
