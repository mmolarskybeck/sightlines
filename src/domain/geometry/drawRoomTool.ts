import { canCloseOnWall, type DrawRoomSnap } from "./drawSnapping";
import type { FloorWall } from "./planObjects";
import { isSimplePolygon, segmentsIntersect, type Point } from "./polygon";

const DRAW_EPS = 1e-6;

// The adjacent segment may share its endpoint but may not backtrack collinearly.
export function drawSegmentInvalid(points: Point[], candidate: Point): boolean {
  const n = points.length;
  if (n === 0) return false;
  const last = points[n - 1];
  for (let i = 0; i < n - 1; i += 1) {
    const s1 = points[i];
    const s2 = points[i + 1];
    if (i === n - 2) {
      const crossV =
        (s1.xMm - last.xMm) * (candidate.yMm - last.yMm) -
        (s1.yMm - last.yMm) * (candidate.xMm - last.xMm);
      const dot =
        (s1.xMm - last.xMm) * (candidate.xMm - last.xMm) +
        (s1.yMm - last.yMm) * (candidate.yMm - last.yMm);
      if (Math.abs(crossV) <= DRAW_EPS && dot > DRAW_EPS) return true;
    } else if (segmentsIntersect(last, candidate, s1, s2)) {
      return true;
    }
  }
  return false;
}

// Close on a shared wall only when the resulting polygon remains simple.
export function drawCloseOnWall(
  points: Point[],
  candidate: Point,
  snap: DrawRoomSnap | null,
  walls: FloorWall[]
): boolean {
  if (!snap || points.length < 3) return false;
  const wall = walls.find((candidateWall) => candidateWall.id === snap.wallId);
  if (!wall) return false;
  if (!canCloseOnWall(points, candidate, wall)) return false;
  if (drawSegmentInvalid(points, candidate)) return false;
  return isSimplePolygon([...points, candidate]);
}

export function isWithinClose(points: Point[], pointerMm: Point, closeRadiusMm: number): boolean {
  if (points.length < 3) return false;
  return (
    Math.hypot(pointerMm.xMm - points[0].xMm, pointerMm.yMm - points[0].yMm) <= closeRadiusMm
  );
}
