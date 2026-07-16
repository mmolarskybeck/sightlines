import type { Project } from "../project";
import { getWallGeometry, hasLoopingWallOrder, isRectangleRoom } from "./walls";
import { changedWallLengthIdsForProject } from "./wallLoop";
import { moveRoomWall } from "./reshapeRoom";

// Which end of the wall stays fixed in WORLD space during a resize. Under the
// hood both anchors are the same whole-wall translation (moveRoomWall) applied
// to one of the resized wall's perpendicular neighbours: "start" slides the
// NEXT wall (the one through the end vertex), "end" slides the PREVIOUS wall —
// which is what lets a handle live on any of the four walls instead of only
// the down/right pair, without ever touching the placement offset.
export type ResizeAnchor = "start" | "end";

export type GeometryEditResult = {
  project: Project;
  changedWallIds: string[];
  anchorVertexId: string;
};

// Sets one wall's exact length while pinning either endpoint. The selected
// wall stays on its existing infinite line; its neighbour at the free end is
// translated parallel to itself until their intersection lands at the target
// distance from the anchor. Because a translated line's intersection with a
// fixed line moves affinely, the required moveRoomWall offset is a single dot
// product rather than an iterative solve.
export function setPolygonWallLength(
  project: Project,
  wallId: string,
  nextLengthMm: number,
  anchor: ResizeAnchor = "start"
): GeometryEditResult {
  if (!Number.isFinite(nextLengthMm) || nextLengthMm <= 0) {
    throw new Error("Wall length must be greater than zero.");
  }

  const placement = project.floor.rooms.find((candidate) =>
    candidate.room.walls.some((wall) => wall.id === wallId)
  );
  if (!placement) {
    throw new Error(`Wall not found: ${wallId}`);
  }

  const room = placement.room;
  const wallIndex = room.walls.findIndex((candidate) => candidate.id === wallId);
  if (!hasLoopingWallOrder(room, wallIndex)) {
    throw new Error("Numeric wall length editing requires a continuous room boundary.");
  }

  const wall = room.walls[wallIndex];
  const wallGeometry = getWallGeometry(room, wall);
  if (wallGeometry.lengthMm === 0) {
    throw new Error("Cannot resize a zero-length wall.");
  }

  const n = room.walls.length;
  const movedWall =
    anchor === "end"
      ? room.walls[(wallIndex - 1 + n) % n]
      : room.walls[(wallIndex + 1) % n];
  const movedGeometry = getWallGeometry(room, movedWall);
  if (movedGeometry.lengthMm === 0) {
    throw new Error("Cannot move a zero-length wall.");
  }

  const wallAxis = {
    xMm: (wallGeometry.end.xMm - wallGeometry.start.xMm) / wallGeometry.lengthMm,
    yMm: (wallGeometry.end.yMm - wallGeometry.start.yMm) / wallGeometry.lengthMm
  };
  const desiredFreeVertex =
    anchor === "end"
      ? {
          xMm: wallGeometry.end.xMm - wallAxis.xMm * nextLengthMm,
          yMm: wallGeometry.end.yMm - wallAxis.yMm * nextLengthMm
        }
      : {
          xMm: wallGeometry.start.xMm + wallAxis.xMm * nextLengthMm,
          yMm: wallGeometry.start.yMm + wallAxis.yMm * nextLengthMm
        };
  const originalFreeVertex = anchor === "end" ? wallGeometry.start : wallGeometry.end;
  const movedLeftNormal = {
    xMm: -(movedGeometry.end.yMm - movedGeometry.start.yMm) / movedGeometry.lengthMm,
    yMm: (movedGeometry.end.xMm - movedGeometry.start.xMm) / movedGeometry.lengthMm
  };
  const offsetMm =
    (desiredFreeVertex.xMm - originalFreeVertex.xMm) * movedLeftNormal.xMm +
    (desiredFreeVertex.yMm - originalFreeVertex.yMm) * movedLeftNormal.yMm;

  const moved = moveRoomWall(project, placement.roomId, movedWall.id, offsetMm);
  return {
    project: moved.project,
    // Numeric entry is exact, so do not reuse the 0.5 mm visual-drag noise
    // threshold. Preserve only a tiny floating-point tolerance here.
    changedWallIds: changedWallLengthIdsForProject(project, moved.project, 1e-6),
    anchorVertexId: anchor === "end" ? wall.endVertexId : wall.startVertexId
  };
}

// Rectangle-only numeric wall resize, expressed as a delegation into the
// general polygon wall-move core (reshapeRoom.moveRoomWall). The rectangle
// gate is load-bearing, not just UI gating: rectangles are the only shape
// where "resize this wall" has one unambiguous, still-orthogonal answer
// (opposite wall follows, the other pair translates). For any other room
// shape, moving a neighbouring wall would change more than this wall's
// length — an edit a numeric length entry should never do silently.
// Reshaping non-rectangular rooms is a dedicated tool, not a side effect of
// this field. The pinned contract lives in the "rectangle resize
// characterization (pipeline-merge gate)" suites in editRoom.test.ts and
// store.test.ts.
export function resizeWallPreservingAngles(
  project: Project,
  wallId: string,
  nextLengthMm: number,
  anchor: ResizeAnchor = "start"
): GeometryEditResult {
  if (!Number.isFinite(nextLengthMm) || nextLengthMm <= 0) {
    throw new Error("Wall length must be greater than zero.");
  }

  const placement = project.floor.rooms.find((candidate) =>
    candidate.room.walls.some((wall) => wall.id === wallId)
  );
  if (!placement) {
    throw new Error(`Wall not found: ${wallId}`);
  }

  const room = placement.room;
  const wallIndex = room.walls.findIndex((candidate) => candidate.id === wallId);
  const wall = room.walls[wallIndex];

  if (!isRectangleRoom(room) || !hasLoopingWallOrder(room, wallIndex)) {
    throw new Error(
      `Numeric length editing only supports rectangular rooms right now. "${room.name}" isn't a simple rectangle.`
    );
  }

  const n = room.walls.length;
  const movedWall =
    anchor === "end"
      ? room.walls[(wallIndex - 1 + n) % n]
      : room.walls[(wallIndex + 1) % n];

  const wallGeometry = getWallGeometry(room, wall);
  const movedGeometry = getWallGeometry(room, movedWall);

  // The free vertex must travel by (next - current) along this wall's axis —
  // away from the anchored vertex, so the axis flips for an "end" anchor.
  // moveRoomWall measures its offset along the MOVED wall's left normal,
  // which in a rectangle is (anti)parallel to that travel direction; the dot
  // product's sign (always ±1 here — isRectangleRoom rejects zero-length
  // walls and guarantees perpendicular neighbours) converts between the two
  // conventions without caring about winding.
  const travelSign = anchor === "end" ? -1 : 1;
  const alignment = Math.sign(
    travelSign *
      ((wallGeometry.end.xMm - wallGeometry.start.xMm) *
        -(movedGeometry.end.yMm - movedGeometry.start.yMm) +
        (wallGeometry.end.yMm - wallGeometry.start.yMm) *
          (movedGeometry.end.xMm - movedGeometry.start.xMm))
  );
  const offsetMm = (nextLengthMm - wallGeometry.lengthMm) * alignment;

  const moved = moveRoomWall(project, placement.roomId, movedWall.id, offsetMm);

  return {
    project: moved.project,
    changedWallIds: changedWallLengthIdsForProject(project, moved.project),
    // Report whichever vertex actually held still in world space, so callers
    // (the store's lastGeometryEdit, the plan-view handles) can anchor UI to
    // it — the resized wall's own vertex, not moveRoomWall's.
    anchorVertexId: anchor === "end" ? wall.endVertexId : wall.startVertexId
  };
}
