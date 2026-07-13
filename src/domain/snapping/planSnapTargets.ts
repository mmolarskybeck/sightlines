import type { WallObject, WallObjectBase } from "../project";
import type { PlacementForm } from "../placement/artworkForm";
import {
  getWallObjectPlanRect,
  projectPointToWall,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type FloorWall,
  type PlanRect
} from "../geometry/planObjects";
import { clamp } from "../geometry/scalar";
import { cross, subtract } from "../geometry/vector";
import { getNeighborXSnapTargets } from "./artworkSnapTargets";
import {
  resolveSnap,
  type Guide,
  type Point,
  type SnapTarget,
  type SnapTargetIds
} from "./resolveSnap";

// Pixel radius (screen space) within which a plan drag captures onto a wall.
// Lives here as the canonical default so PlanView imports it and converts
// px→mm with the live zoom before calling resolvePlanPlacement — the domain
// only ever deals in mm.
export const WALL_CAPTURE_PX = 24;

// Mirrors resolveSnap's breakFreeMultiplier default: the wall an object is
// currently anchored to gets 1.5× the capture radius so plan drags don't
// flicker between wall and floor at the boundary.
const WALL_BREAK_FREE_MULTIPLIER = 1.5;

// A committed plan placement. `wall` means the object is anchored to a wall
// with its center at xMm along that wall (wall-local, distance from start);
// `floor` means a free floor-space center. Callers persist exactly this.
export type PlanPlacement =
  | { anchor: "wall"; wallId: string; xMm: number }
  | { anchor: "floor"; xMm: number; yMm: number };

// A drag that cannot commit anywhere: a 2D artwork (wall-only, USER DECISION)
// dragged with no wall in capture range. It is deliberately NOT a PlanPlacement
// — nothing gets persisted — so the `anchor: "none"` variant forces every caller
// to handle the rejected case rather than silently floor-placing. The result
// still carries a planRect so the caller can paint the danger ghost under the
// cursor; release is a no-op.
export type ResolvedPlacement = PlanPlacement | { anchor: "none" };

// How a placement behaves relative to walls. `float` resolves a free
// floor-space center when no wall captures (blocked zones); `capture-any` never
// floats and grabs the globally nearest wall at any distance (doors/windows);
// `reject` refuses the drop (a WALL artwork off every wall — wall-only);
// `floor-only` never even attempts a wall capture — it goes straight to the
// floor stage (a FLOOR artwork, which sits on the floor and never hangs). See
// floatPolicyForKind.
export type FloatPolicy = "float" | "capture-any" | "reject" | "floor-only";

// The per-kind policy that used to be spread across callers as
// `canFloat: kind === ...`. Blocked zones float, doors/windows capture at any
// distance. Artwork is the one kind that depends on the artwork RECORD, not the
// kind alone: a wall work is wall-only (reject), a floor work is floor-only.
// The effective form is passed in (see effectivePlacementForm); it defaults to
// the wall-only behavior when a caller has no form to hand (e.g. a placeholder
// drag whose artwork hasn't resolved yet).
export function floatPolicyForKind(
  kind: WallObject["kind"],
  artworkForm?: PlacementForm
): FloatPolicy {
  if (kind === "artwork") return artworkForm === "floor" ? "floor-only" : "reject";
  if (kind === "blocked-zone") return "float";
  return "capture-any"; // door | window
}

export type PlanPlacementResult = {
  placement: ResolvedPlacement;
  // Ready-to-render preview geometry, so preview and commit agree.
  planRect: PlanRect;
  // Hysteresis state the caller threads back in via previousSnapTargetIds.
  snapTargetIds: SnapTargetIds;
  // Floor-space guides; always [] for wall placements (see below).
  activeGuides: Guide[];
};

export type PlanMovingSize = {
  widthMm: number;
  heightMm: number;
  depthMm: number;
};

// THE single composed entry point for every plan-view placement — move drag,
// click-to-place ghost, artwork drop ghost — so the preview a user sees and
// the value that gets committed can never disagree, the same discipline as
// resolveArtworkSnap. Two stages: try to capture onto a wall (with per-object
// cross-boundary hysteresis); if nothing captures, the floatPolicy decides
// whether to float onto the floor, reject the drop, or (doors/windows) there
// was simply no wall to capture at all.
export function resolvePlanPlacement(
  proposedCenterFloorMm: Point,
  args: {
    walls: FloorWall[];
    // ALL wall objects across all walls; the moving object is already excluded
    // by the caller. Filtered to the captured wall for neighbor targets.
    wallObjects: WallObjectBase[];
    movingSize: PlanMovingSize;
    // Optional wall-only rendered footprint. Artwork storage stays image-sized,
    // but framing widens the edges used by wall snapping, clamping, and ghosts —
    // including the REJECTED ghost, which is still a wall work under the cursor.
    // Only the genuine floor stage (float / floor-only) keeps movingSize: floor
    // geometry is framing-agnostic by decision (docs/framing-dimension-contract.md
    // §3, Phase 6b), and callers do not even supply this field for a floor work.
    wallFootprintWidthMm?: number;
    movingKind: WallObject["kind"];
    // Per-kind behavior when no wall captures — see FloatPolicy /
    // floatPolicyForKind.
    floatPolicy: FloatPolicy;
    // The wall the object is currently anchored to, for the wider break-free
    // capture radius; null when it isn't currently on any wall.
    currentAnchorWallId: string | null;
    captureDistanceMm: number;
    // Floor-space grid targets from getGridSnapTargets; only consulted when
    // snapToGrid and the object is floating.
    gridTargets: SnapTarget[];
    snapToGrid: boolean;
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
    // The object's live rotation, passed through to a floor placement's rect so
    // the preview matches the rendered object (wall placements take the wall's
    // angle instead). Defaults to 0 for fresh placements.
    rotationDeg?: number;
  }
): PlanPlacementResult {
  // A floor work never hangs (USER DECISION): skip wall capture entirely and
  // resolve on the floor stage below — the wall an off-form drag happens to
  // pass over must never grab it.
  const capturedWall =
    args.floatPolicy === "floor-only"
      ? null
      : captureWall(
          proposedCenterFloorMm,
          args.walls,
          args.captureDistanceMm,
          args.floatPolicy === "capture-any",
          args.currentAnchorWallId
        );

  if (capturedWall) {
    return resolveOnWall(proposedCenterFloorMm, capturedWall, args);
  }

  // Nothing captured. Artwork is wall-only (USER DECISION): reject the drop so
  // the caller paints the danger ghost and release is a no-op — a 2D artwork can
  // never land mid-room as a floor object.
  if (args.floatPolicy === "reject") {
    return resolveRejected(proposedCenterFloorMm, args);
  }

  // Floor stage. Reached when nothing captured: the object floats (blocked zone
  // far from every wall), it's floor-only (a floor artwork, which never even
  // attempted a capture above), or (invariant break, e.g. a room with no walls)
  // there was no wall to capture at all. In the last case we fall back
  // to a floor placement even for doors/windows rather than crash — rooms always
  // have walls in practice, so a "capture-any" kind reaching here only ever
  // means "no walls exist."
  return resolveOnFloor(proposedCenterFloorMm, args);
}

// Small distance window (mm — a window, not exact equality, because these are
// floats) inside which two walls count as tied for capture. Coincident twin
// walls (spec §5.5: one wall record per abutting room, geometrically identical)
// tie at EXACTLY the same distance for any cursor position, so capturePrefers
// must decide which room's wall wins by side rather than by a hair of distance.
const DISTANCE_TIE_EPSILON_MM = 1;

// Nearest wall the object should capture onto, or null to fall through to the
// floor/reject stage. Each wall carries its own effective radius: the current
// anchor wall gets the wider break-free radius (so it stays sticky), every other
// wall gets the base radius (so re-anchoring only happens once a wall is
// genuinely close). Doors/windows (capturesAtAnyDistance) capture the globally
// nearest wall at any distance — they never float.
function captureWall(
  pointMm: Point,
  walls: FloorWall[],
  captureDistanceMm: number,
  capturesAtAnyDistance: boolean,
  currentAnchorWallId: string | null
) {
  let best: { wall: FloorWall; xAlongMm: number; distanceMm: number } | null = null;

  for (const wall of walls) {
    const projection = projectPointToWall(pointMm, wall);
    const radius = capturesAtAnyDistance
      ? Infinity
      : wall.id === currentAnchorWallId
        ? captureDistanceMm * WALL_BREAK_FREE_MULTIPLIER
        : captureDistanceMm;

    if (projection.distanceMm > radius) continue;

    const candidate = { wall, xAlongMm: projection.xAlongMm, distanceMm: projection.distanceMm };
    if (!best || capturePrefers(candidate, best, pointMm)) {
      best = candidate;
    }
  }

  return best;
}

// Should `candidate` replace the current `best`? Strictly closer (beyond the tie
// window) wins outright. Within DISTANCE_TIE_EPSILON_MM it's a tie — the case
// two coincident twin walls hit for EVERY cursor position — broken side-aware:
// prefer the wall whose interior (the LEFT of its start→end direction, spec
// §5.3) contains the cursor, so a drag inside room B captures room B's face of a
// shared wall instead of room A's. Only when the side can't discriminate (cursor
// on the wall line, or the same interior answer for both — e.g. two offset
// partition faces that don't actually coincide) does it fall back to the
// deterministic wallId order the code used before.
function capturePrefers(
  candidate: { wall: FloorWall; distanceMm: number },
  best: { wall: FloorWall; distanceMm: number },
  pointMm: Point
): boolean {
  if (candidate.distanceMm < best.distanceMm - DISTANCE_TIE_EPSILON_MM) return true;
  if (candidate.distanceMm > best.distanceMm + DISTANCE_TIE_EPSILON_MM) return false;

  const candidateInterior = cursorOnInteriorSide(candidate.wall, pointMm);
  const bestInterior = cursorOnInteriorSide(best.wall, pointMm);
  if (candidateInterior !== bestInterior) return candidateInterior;

  return candidate.wall.id.localeCompare(best.wall.id) < 0;
}

// Is the cursor on a wall's interior side — the LEFT of start→end? The sign of
// the cross product (end−start) × (point−start) is > 0 exactly when the point is
// to the left, which is the codebase's standing interior convention (matches
// unitLeftNormal's (-dy, dx) and scene3d's wallInwardNormal). Exactly 0 (point
// on the line) reads as "not interior", so it falls through to the id tie-break
// rather than arbitrarily claiming a side. Verified against unitLeftNormal in
// planSnapTargets.test.ts.
function cursorOnInteriorSide(wall: FloorWall, pointMm: Point): boolean {
  return (
    cross(subtract(wall.endFloorMm, wall.startFloorMm), subtract(pointMm, wall.startFloorMm)) > 0
  );
}

function resolveOnWall(
  proposedCenterFloorMm: Point,
  captured: { wall: FloorWall; xAlongMm: number },
  args: {
    wallObjects: WallObjectBase[];
    movingSize: PlanMovingSize;
    wallFootprintWidthMm?: number;
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
  }
): PlanPlacementResult {
  const wall = captured.wall;
  const widthMm = args.wallFootprintWidthMm ?? args.movingSize.widthMm;

  // Neighbor targets are wall-local x only: objects on this wall, positioned by
  // their own xMm-along-the-wall. No grid tier along the wall (floor grid is
  // meaningless projected onto an angled wall) and no y candidates.
  const neighbors = args.wallObjects.filter((object) => object.wallId === wall.id);
  const candidates = getNeighborXSnapTargets(neighbors, widthMm);

  const resolved = resolveSnap(
    { xMm: captured.xAlongMm, yMm: 0 },
    candidates,
    {
      thresholdMm: args.thresholdMm,
      previousSnapTargetIds: args.previousSnapTargetIds
    }
  );

  // Clamp the object's center so its full width stays on the wall; if the wall
  // is shorter than the object there's no valid range, so center it.
  const minXMm = widthMm / 2;
  const maxXMm = wall.lengthMm - widthMm / 2;
  const xMm = maxXMm < minXMm ? wall.lengthMm / 2 : clamp(resolved.point.xMm, minXMm, maxXMm);

  return {
    placement: { anchor: "wall", wallId: wall.id, xMm },
    planRect: getWallObjectPlanRect(wall, { xMm, widthMm }, WALL_OBJECT_PLAN_DEPTH_MM),
    snapTargetIds: resolved.snapTargetIds,
    // Wall-local guides are omitted in v1: the resolve above ran in wall-local
    // coordinates, so its guides are in the wrong space to draw over the
    // floor-space plan. Emitting them would misplace the guide lines.
    activeGuides: []
  };
}

// The floor stage. movingSize is the image size and stays that way: floor
// geometry never expands by mat/frame (Phase 6b decision — a floor work has no
// settled physical orientation, so an outer height cannot be mapped onto plan
// depth). wallFootprintWidthMm is deliberately absent from this signature.
function resolveOnFloor(
  proposedCenterFloorMm: Point,
  args: {
    movingSize: PlanMovingSize;
    gridTargets: SnapTarget[];
    snapToGrid: boolean;
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
    rotationDeg?: number;
  }
): PlanPlacementResult {
  // Grid is the only floor tier and is preference-gated; with snap off there
  // are no candidates and the proposed center passes through unchanged.
  const candidates = args.snapToGrid ? args.gridTargets : [];

  const resolved = resolveSnap(proposedCenterFloorMm, candidates, {
    thresholdMm: args.thresholdMm,
    previousSnapTargetIds: args.previousSnapTargetIds
  });

  const centerXMm = resolved.point.xMm;
  const centerYMm = resolved.point.yMm;

  return {
    placement: { anchor: "floor", xMm: centerXMm, yMm: centerYMm },
    planRect: {
      centerXMm,
      centerYMm,
      widthMm: args.movingSize.widthMm,
      depthMm: args.movingSize.depthMm,
      angleDeg: args.rotationDeg ?? 0
    },
    snapTargetIds: resolved.snapTargetIds,
    // These guides ARE floor-space (the resolve ran on the floor-space center),
    // so they're correct to draw over the plan.
    activeGuides: resolved.activeGuides
  };
}

// A rejected drop (floatPolicy "reject", nothing captured). Nothing commits —
// the placement is `{ anchor: "none" }` — but we still hand back a planRect at
// the cursor (reusing the floor resolve's cursor tracking, which is all we want
// from it) so the caller can paint the danger ghost right where the release was
// refused. Alignment guides are suppressed: there is no placement to align, so
// drawing them would imply a commit that never happens.
//
// The rect is WALL-sized, not floor-sized: a reject is a wall-only artwork that
// lost wall capture, so the thing under the cursor is still the same framed wall
// work and its ghost must keep its outer width (otherwise it visibly shrinks by
// 2·(mat+frame) the instant capture breaks, then grows back on re-capture). Do
// NOT unify this with the floor stage's movingSize.widthMm — that stage serves
// genuine floor objects, whose geometry is framing-agnostic by decision
// (docs/framing-dimension-contract.md §3, Phase 6b).
function resolveRejected(
  proposedCenterFloorMm: Point,
  args: {
    movingSize: PlanMovingSize;
    wallFootprintWidthMm?: number;
    gridTargets: SnapTarget[];
    snapToGrid: boolean;
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
    rotationDeg?: number;
  }
): PlanPlacementResult {
  const floor = resolveOnFloor(proposedCenterFloorMm, args);
  return {
    ...floor,
    placement: { anchor: "none" },
    planRect: {
      ...floor.planRect,
      widthMm: args.wallFootprintWidthMm ?? args.movingSize.widthMm
    },
    activeGuides: []
  };
}
