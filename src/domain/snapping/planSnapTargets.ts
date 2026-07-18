import type { FloorObject, WallObject, WallObjectBase } from "../project";
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
import { getFloorAlignSnapTargets } from "./floorSnapTargets";
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
  // A case floats like a blocked zone: it captures a wall only within capture
  // distance and otherwise resolves a free floor-space center. placeCaseFromPlan
  // decides wall-case vs floor-case from the resolved anchor, so a case near a
  // wall becomes a wall case and one on open floor becomes a floor case.
  if (kind === "case") return "float";
  // door | window | wall-text: capture the nearest wall at any distance.
  return "capture-any";
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
    // Floor alignment targets (Phase 3): room centerlines + wall-object/
    // floor-object alignment, from getFloorAlignSnapTargets. Only consulted on
    // the genuine floor stage (resolveOnFloor) — resolveRejected explicitly
    // strips this so a wall-only work that lost capture never draws alignment
    // guides for a placement that isn't actually committing anywhere.
    floorAlign?: {
      roomId: string | null;
      // Moving object already excluded + filtered to the same room by the caller.
      floorObjects: FloorObject[];
    };
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

// How close a wall's delta must be to zero on one axis to count as
// axis-aligned for wall-grid purposes — mirrors floorSnapTargets'
// AXIS_EPSILON_MM policy (floats lifted through a room offset are floats, not
// exact integers).
const WALL_GRID_AXIS_EPSILON_MM = 1e-6;

// Cap on wall-grid candidates kept after range-filtering, so a long wall at a
// fine grid interval doesn't flood resolveSnap with candidates far from the
// cursor — the nearest N to the proposed along-wall position win.
const MAX_WALL_GRID_CANDIDATES = 40;

// Wall-anchored grid snap (Phase 5a): a wall-anchored object (case, door,
// window, artwork, wall text) never had a grid tier before this — only
// same-wall neighbors. This projects the floor-space grid lines PERPENDICULAR
// to an axis-aligned wall into wall-local along-wall crossings, then expands
// each crossing into two edge-based CENTER candidates (the moving object's
// left/right edge lands on the crossing) — the same edge-based policy as the
// floor stage's buildFloorGridCandidates. An angled wall has no well-defined
// perpendicular grid family (its along-wall axis isn't parallel to either
// world axis) and is skipped entirely, keeping the pre-existing behavior
// there. Every candidate carries showGuide:false — grid never draws a guide.
function buildWallGridCandidates(
  wall: FloorWall,
  gridTargets: SnapTarget[],
  widthMm: number,
  proposedXAlongMm: number
): SnapTarget[] {
  const dx = wall.endFloorMm.xMm - wall.startFloorMm.xMm;
  const dy = wall.endFloorMm.yMm - wall.startFloorMm.yMm;
  const isHorizontal =
    Math.abs(dy) <= WALL_GRID_AXIS_EPSILON_MM && Math.abs(dx) > WALL_GRID_AXIS_EPSILON_MM;
  const isVertical =
    Math.abs(dx) <= WALL_GRID_AXIS_EPSILON_MM && Math.abs(dy) > WALL_GRID_AXIS_EPSILON_MM;
  if (!isHorizontal && !isVertical) return [];

  // A horizontal wall (constant y) crosses vertical grid lines (x-axis
  // targets); a vertical wall crosses horizontal grid lines (y-axis targets).
  const relevantAxis: "x" | "y" = isHorizontal ? "x" : "y";
  const dirSign = isHorizontal ? Math.sign(dx) : Math.sign(dy);
  const startCoordMm = isHorizontal ? wall.startFloorMm.xMm : wall.startFloorMm.yMm;

  const halfWMm = widthMm / 2;
  const minAlongMm = halfWMm;
  const maxAlongMm = wall.lengthMm - halfWMm;
  if (maxAlongMm < minAlongMm) return [];

  const candidates: { target: SnapTarget; distanceMm: number }[] = [];
  for (const gridTarget of gridTargets) {
    if (gridTarget.axis !== relevantAxis) continue;
    const gridCoordMm = relevantAxis === "x" ? gridTarget.point.xMm : gridTarget.point.yMm;
    // xAlong = (gridCoord - start) / dir, dir = ±1 (wall's direction sign on
    // the relevant axis) — the wall-local distance from start at which the
    // wall crosses this grid line.
    const crossingAlongMm = (gridCoordMm - startCoordMm) / dirSign;

    // Edge-lo: center = crossing + halfW (moving object's LEFT edge on the
    // line). Edge-hi: center = crossing − halfW (RIGHT edge on the line) —
    // same convention as buildFloorGridCandidates.
    for (const suffix of ["lo", "hi"] as const) {
      const centerAlongMm =
        suffix === "lo" ? crossingAlongMm + halfWMm : crossingAlongMm - halfWMm;
      if (centerAlongMm < minAlongMm || centerAlongMm > maxAlongMm) continue;
      candidates.push({
        target: {
          id: `wall-grid:${gridTarget.id}:edge-${suffix}`,
          kind: "grid",
          axis: "x",
          point: { xMm: centerAlongMm, yMm: 0 },
          showGuide: false
        },
        distanceMm: Math.abs(centerAlongMm - proposedXAlongMm)
      });
    }
  }

  return candidates
    .sort((a, b) => a.distanceMm - b.distanceMm)
    .slice(0, MAX_WALL_GRID_CANDIDATES)
    .map((entry) => entry.target);
}

function resolveOnWall(
  proposedCenterFloorMm: Point,
  captured: { wall: FloorWall; xAlongMm: number },
  args: {
    wallObjects: WallObjectBase[];
    movingSize: PlanMovingSize;
    wallFootprintWidthMm?: number;
    movingKind: WallObject["kind"];
    thresholdMm: number;
    previousSnapTargetIds?: SnapTargetIds;
    // Floor-space grid targets from getGridSnapTargets, reused here (Phase 5a)
    // to derive wall-local crossings for an axis-aligned wall — see
    // buildWallGridCandidates. Only consulted when snapToGrid.
    gridTargets: SnapTarget[];
    snapToGrid: boolean;
  }
): PlanPlacementResult {
  const wall = captured.wall;
  const widthMm = args.wallFootprintWidthMm ?? args.movingSize.widthMm;

  // Neighbor targets are wall-local x only: objects on this wall, positioned by
  // their own xMm-along-the-wall. No y candidates (there is no cross-wall axis
  // in wall-local space).
  const neighbors = args.wallObjects.filter((object) => object.wallId === wall.id);
  const gridCandidates = args.snapToGrid
    ? buildWallGridCandidates(wall, args.gridTargets, widthMm, captured.xAlongMm)
    : [];
  const candidates = [...getNeighborXSnapTargets(neighbors, widthMm), ...gridCandidates];

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
    // A case protrudes its real depth into the room, so its wall-anchored
    // preview must carry movingSize.depthMm — mirroring buildPlanScene, which
    // passes object.depthMm for cases, and resolvePlanGroupMemberMove's
    // member.depthMm. Every other kind renders the thin through-wall band.
    planRect: getWallObjectPlanRect(
      wall,
      { xMm, widthMm },
      args.movingKind === "case" ? args.movingSize.depthMm : WALL_OBJECT_PLAN_DEPTH_MM
    ),
    snapTargetIds: resolved.snapTargetIds,
    // Wall-local guides are omitted in v1: the resolve above ran in wall-local
    // coordinates, so its guides are in the wrong space to draw over the
    // floor-space plan. Emitting them would misplace the guide lines.
    activeGuides: []
  };
}

// Grid snapping on the floor stage snaps the moving object's EDGE onto a grid
// line, not its center (USER DECISION — Phase 1 of the grid-snap plan): an
// object's outer boundary landing on the lattice is what reads as "aligned to
// the grid" in plan view, not its centroid landing on it. Each raw grid target
// (one per visible line, center-on-line) expands into two edge candidates —
// center shifted by the moving object's half-extent so one edge or the other
// coincides with the line. A rotated object (not a multiple of 90°) has no
// axis-aligned edges to align, so it falls back to the original center-on-line
// candidate. Every returned candidate carries showGuide:false: grid snapping
// must never draw a guide line in the floor stage (the grid itself IS the
// visual reference), only the wall/neighbor tiers draw guides.
function buildFloorGridCandidates(
  gridTargets: SnapTarget[],
  movingSize: PlanMovingSize | undefined,
  rotationDeg: number | undefined
): SnapTarget[] {
  const asHidden = (target: SnapTarget): SnapTarget => ({ ...target, showGuide: false });

  if (!movingSize) {
    return gridTargets.map(asHidden);
  }

  const normalizedDeg = (((rotationDeg ?? 0) % 360) + 360) % 360;
  const nearestQuarterTurn = Math.round(normalizedDeg / 90);
  const deviationDeg = Math.abs(normalizedDeg - nearestQuarterTurn * 90);
  const isAxisAligned = deviationDeg < 0.5;

  if (!isAxisAligned) {
    // A rotated rect has no axis-aligned edges to snap — fall back to
    // center-on-line, same as the old raw-target behavior, just guide-free.
    return gridTargets.map(asHidden);
  }

  // At 90°/270° the object's width and depth are swapped relative to the
  // floor axes (a quarter-turn rect's "width" now runs along floor-y).
  const swapped = (((nearestQuarterTurn % 4) + 4) % 4) % 2 === 1;
  const halfWMm = (swapped ? movingSize.depthMm : movingSize.widthMm) / 2;
  const halfDMm = (swapped ? movingSize.widthMm : movingSize.depthMm) / 2;

  const candidates: SnapTarget[] = [];
  for (const target of gridTargets) {
    if (target.axis === "x") {
      // Center = line + half-extent → the object's LEFT edge sits on the line.
      candidates.push({
        ...target,
        id: `${target.id}:edge-lo`,
        point: { xMm: target.point.xMm + halfWMm, yMm: target.point.yMm },
        showGuide: false
      });
      // Center = line − half-extent → the object's RIGHT edge sits on the line.
      candidates.push({
        ...target,
        id: `${target.id}:edge-hi`,
        point: { xMm: target.point.xMm - halfWMm, yMm: target.point.yMm },
        showGuide: false
      });
    } else if (target.axis === "y") {
      candidates.push({
        ...target,
        id: `${target.id}:edge-lo`,
        point: { xMm: target.point.xMm, yMm: target.point.yMm + halfDMm },
        showGuide: false
      });
      candidates.push({
        ...target,
        id: `${target.id}:edge-hi`,
        point: { xMm: target.point.xMm, yMm: target.point.yMm - halfDMm },
        showGuide: false
      });
    } else {
      candidates.push(asHidden(target));
    }
  }
  return candidates;
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
    // Only present when the caller opted into alignment (see
    // resolvePlanPlacement's floorAlign) — walls/wallObjects are optional here
    // (rather than required) so resolveRejected, which never supplies
    // floorAlign, doesn't need to supply these either.
    walls?: FloorWall[];
    wallObjects?: WallObjectBase[];
    floorAlign?: {
      roomId: string | null;
      floorObjects: FloorObject[];
    };
  }
): PlanPlacementResult {
  // Alignment targets (room centerlines + wall-/floor-object alignment) are
  // NOT preference-gated — they're always active when floorAlign is present,
  // same as resolveArtworkSnap's centerline/neighbor tiers, and keep their
  // visible guides. Grid is the only floor tier gated by snapToGrid and is
  // always guide-free (see buildFloorGridCandidates); the raw per-line targets
  // are expanded into edge-based candidates. Alignment (priority 1-3 via
  // KIND_PRIORITY) naturally outranks grid (4).
  const alignCandidates = args.floorAlign
    ? getFloorAlignSnapTargets({
        proposedCenterMm: proposedCenterFloorMm,
        roomId: args.floorAlign.roomId,
        walls: args.walls ?? [],
        wallObjects: args.wallObjects ?? [],
        floorObjects: args.floorAlign.floorObjects,
        movingSize: args.movingSize,
        rotationDeg: args.rotationDeg ?? 0
      })
    : [];
  const gridCandidates = args.snapToGrid
    ? buildFloorGridCandidates(args.gridTargets, args.movingSize, args.rotationDeg)
    : [];
  const candidates = [...alignCandidates, ...gridCandidates];

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
  // Explicitly omit floorAlign even though resolvePlanPlacement forwards its
  // whole args object here (which may still carry it at runtime) — a rejected
  // drop commits nothing, so it must never draw alignment guides that imply a
  // placement that isn't happening. This type's args never declares
  // floorAlign, but the spread below is the actual enforcement.
  const floor = resolveOnFloor(proposedCenterFloorMm, { ...args, floorAlign: undefined });
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
