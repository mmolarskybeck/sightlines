import type { Vector2 } from "../geometry/dragResize";
import {
  getWallObjectPlanRect,
  projectPointToWall,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type FloorWall,
  type PlanRect
} from "../geometry/planObjects";
import type { WallObject } from "../project";

// Plan-view group drag is translation-only for everything EXCEPT wall-anchored
// artwork: the whole multi-selection moves rigidly by a floor-space delta, and
// members that stay on their own wall (openings, blocked zones) or on the floor
// keep that rigid behavior — a wall member slides along (and stays glued to) its
// own wall line, a floor member translates freely. Wall-anchored ARTWORK is the
// one exception: when the dragged group lands near a foreign wall (resolved from
// the group's translated center, see resolvePlanGroupReanchorWall — same
// nearest-wall radius + break-free hysteresis the single-object drag uses), the
// artwork members re-anchor to that wall, each projected onto it independently
// so their relative along-wall order and spacing survive (as far as end-clamping
// allows). When no foreign wall is near, the artwork path is byte-for-byte the
// old own-wall reprojection. These pure helpers hold that per-member math so
// PlanView's preview and commit can't disagree, and so the geometry is
// unit-testable without the component.

export type PlanGroupMember =
  | {
      id: string;
      anchor: "wall";
      // Only artwork re-anchors across walls; openings/blocked zones stay on
      // their own wall regardless of a resolved target (see resolvePlanGroup-
      // MemberMove). Carried so the pure helper can make that call without a
      // project lookup.
      kind: WallObject["kind"];
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

// Mirrors resolveSnap / planSnapTargets' breakFreeMultiplier default: the wall
// the group is currently re-anchored to (this gesture) gets 1.5× the capture
// radius so the target doesn't flicker at the boundary between two candidate
// walls. Kept local rather than imported so this module stays free of
// planSnapTargets' placement machinery.
const GROUP_WALL_BREAK_FREE_MULTIPLIER = 1.5;

// The foreign wall a group's artwork members should re-anchor onto, or null to
// keep them on their own walls (today's rigid slide). Driven by the group's
// translated center — the natural driver here, since the delta is already
// resolved against getPlanGroupCenterMm and one target per gesture keeps the
// members' relative spacing coherent (a per-member pointer has no single
// pointer to read). Walls the artwork already sits on (memberWallIds) are
// skipped so "no foreign wall near" reproduces today's own-wall behavior
// exactly; the one exception is the sticky previous target, which is kept in
// the running with the wider break-free radius so a held re-anchor doesn't
// chatter. Every other wall uses the base radius, so re-anchoring only fires
// once a genuinely new wall is close. Ties break on wallId, matching
// findNearestWall's determinism.
export function resolvePlanGroupReanchorWall(args: {
  groupCenterMm: Vector2;
  walls: FloorWall[];
  memberWallIds: Set<string>;
  captureDistanceMm: number;
  previousTargetWallId: string | null;
}): FloorWall | null {
  let best: { wall: FloorWall; distanceMm: number } | null = null;

  for (const wall of args.walls) {
    const isSticky = wall.id === args.previousTargetWallId;
    // A wall the group already occupies is never a re-anchor target — unless
    // it's the sticky previous target being held past its base radius.
    if (args.memberWallIds.has(wall.id) && !isSticky) continue;

    const radius = isSticky
      ? args.captureDistanceMm * GROUP_WALL_BREAK_FREE_MULTIPLIER
      : args.captureDistanceMm;
    const projection = projectPointToWall(args.groupCenterMm, wall);
    if (projection.distanceMm > radius) continue;

    if (
      !best ||
      projection.distanceMm < best.distanceMm ||
      (projection.distanceMm === best.distanceMm && wall.id.localeCompare(best.wall.id) < 0)
    ) {
      best = { wall, distanceMm: projection.distanceMm };
    }
  }

  return best?.wall ?? null;
}

// One member translated by the group delta: the plan rect to preview, plus the
// commit payload. Floor members carry a new floor center. Wall members carry a
// new wall-local x with yMm omitted (the plan has no notion of hang height, so
// an artwork keeps its elevation across the move) and, when they re-anchor to a
// different wall, that wall's id. A wall member's moved world center is
// projected via projectPointToWall, which already clamps the along-wall distance
// to [0, lengthMm] — so a member dragged past a wall's end reads as sitting at
// that end, never off the line, and its preview rect stays glued to the wall.
//
// reanchorWall re-anchors ARTWORK only: when supplied, an artwork member
// projects onto that foreign wall instead of its own (order/spacing preserved
// because each member projects independently). Openings and blocked zones ignore
// it and stay on their own wall — matching the single-drag rule that only
// artwork crosses walls freely. Omit it (the default) and every member reprojects
// onto its own wall, the original rigid-translation behavior nudges still use.
export function resolvePlanGroupMemberMove(
  member: PlanGroupMember,
  deltaMm: Vector2,
  reanchorWall: FloorWall | null = null
): { rect: PlanRect; commit: { id: string; xMm: number; yMm?: number; wallId?: string } } {
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
  const targetWall = reanchorWall && member.kind === "artwork" ? reanchorWall : member.wall;
  const projection = projectPointToWall(movedCenterMm, targetWall);
  const rect = getWallObjectPlanRect(
    targetWall,
    { xMm: projection.xAlongMm, widthMm: member.widthMm },
    member.depthMm ?? WALL_OBJECT_PLAN_DEPTH_MM
  );

  return {
    rect,
    commit: {
      id: member.id,
      xMm: projection.xAlongMm,
      // Only a genuine wall change carries a wallId, so a same-wall slide stays
      // a pure x update (and the store's no-op detection is unaffected).
      ...(targetWall.id !== member.wall.id ? { wallId: targetWall.id } : {})
    }
  };
}
