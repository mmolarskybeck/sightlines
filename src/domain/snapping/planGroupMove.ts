import type { Vector2 } from "../geometry/dragResize";
import {
  getWallObjectPlanRect,
  projectPointToWall,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type FloorWall,
  type PlanRect
} from "../geometry/planObjects";

// Plan-view group drag is translation-only: the whole multi-selection moves
// rigidly by a floor-space delta, with NO wall re-anchoring mid-gesture (that
// per-object cross-boundary logic is deliberately reserved for single-object
// drags). Each member keeps its anchor — a wall member slides along (and stays
// glued to) its own wall line, a floor member translates freely. These pure
// helpers hold that per-member math so PlanView's preview and commit can't
// disagree, and so the geometry is unit-testable without the component.

export type PlanGroupMember =
  | {
      id: string;
      anchor: "wall";
      // The member's own wall, captured at drag start. Walls can't change
      // mid-drag (nothing commits until release), so snapshotting the FloorWall
      // here keeps these helpers self-contained — no wall lookup, no
      // missing-wall branch.
      wall: FloorWall;
      // Rest-state world center in floor space (getWallObjectPlanRect's center).
      worldCenterMm: Vector2;
      widthMm: number;
      depthMm: number;
    }
  | {
      id: string;
      anchor: "floor";
      centerMm: Vector2;
      widthMm: number;
      depthMm: number;
      rotationDeg: number;
    };

// The bounding-box center of the members' rest centers, in floor space — the
// point fed to grid snapping so the group's delta can land on the grid. Only
// the centers matter here (not each member's rotated footprint): snapping the
// group translation to the grid is about where the cluster sits, and an
// axis-aligned union of rotated rects would be both fuzzy and beside the point.
export function getPlanGroupCenterMm(members: PlanGroupMember[]): Vector2 {
  const centers = members.map((member) =>
    member.anchor === "wall" ? member.worldCenterMm : member.centerMm
  );
  const xs = centers.map((center) => center.xMm);
  const ys = centers.map((center) => center.yMm);

  return {
    xMm: (Math.min(...xs) + Math.max(...xs)) / 2,
    yMm: (Math.min(...ys) + Math.max(...ys)) / 2
  };
}

// One member translated by the group delta: the plan rect to preview, plus the
// commit payload (wall members carry a new wall-local x with yMm omitted; floor
// members carry a new floor center). A wall member's moved world center is
// re-projected onto its OWN wall via projectPointToWall, which already clamps
// the along-wall distance to [0, lengthMm] — so a member dragged past a wall's
// end reads as sitting at that end, never off the line, and its preview rect
// stays glued to the wall.
export function resolvePlanGroupMemberMove(
  member: PlanGroupMember,
  deltaMm: Vector2
): { rect: PlanRect; commit: { id: string; xMm: number; yMm?: number } } {
  if (member.anchor === "floor") {
    const centerMm: Vector2 = {
      xMm: member.centerMm.xMm + deltaMm.xMm,
      yMm: member.centerMm.yMm + deltaMm.yMm
    };
    return {
      rect: {
        centerXMm: centerMm.xMm,
        centerYMm: centerMm.yMm,
        widthMm: member.widthMm,
        depthMm: member.depthMm,
        angleDeg: member.rotationDeg
      },
      commit: { id: member.id, xMm: centerMm.xMm, yMm: centerMm.yMm }
    };
  }

  const movedCenterMm: Vector2 = {
    xMm: member.worldCenterMm.xMm + deltaMm.xMm,
    yMm: member.worldCenterMm.yMm + deltaMm.yMm
  };
  const projection = projectPointToWall(movedCenterMm, member.wall);
  const rect = getWallObjectPlanRect(
    member.wall,
    { xMm: projection.xAlongMm, widthMm: member.widthMm },
    member.depthMm ?? WALL_OBJECT_PLAN_DEPTH_MM
  );

  return { rect, commit: { id: member.id, xMm: projection.xAlongMm } };
}
