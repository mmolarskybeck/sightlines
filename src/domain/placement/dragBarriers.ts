import type { RectBoundsMm } from "./collision";

// A macOS-window-style drag barrier. During an elevation-view drag we run this
// pass AFTER snapping/quantization (see resolveSnap) as a separate concern: a
// dragged rect that runs into an obstacle clamps flush against its nearest
// face, and a deliberate push past `breakThresholdMm` "pops" through — but only
// for `yielding` barriers. Hard barriers never yield; they clamp at any depth.
//
// `boundsMm` is the axis-aligned obstacle rect in the same center-anchored mm
// space validatePlacement/collision use (x from wall start, y up from floor).
// It mirrors collision.RectBoundsMm exactly so obstacle rects can be produced
// straight from getWallObjectBoundsMm.
export type BarrierObstacle = {
  id: string;
  boundsMm: RectBoundsMm;
  hardness: "hard" | "yielding";
};

type Point = { xMm: number; yMm: number };
type Size = { widthMm: number; heightMm: number };

// Bounded iteration count. Each pass resolves the single deepest overlap, so a
// rect wedged between several obstacles needs a few passes to settle (or to
// prove unresolvable). Four is comfortably past any realistic elevation layout
// and keeps the whole resolve O(passes · obstacles) with no risk of a runaway
// loop if two clamps happen to ping-pong the point between them.
const MAX_PASSES = 4;

// Center-anchored point + size → axis-aligned faces, matching
// getWallObjectBoundsMm's convention so the moving rect and obstacle rects live
// in one comparable space.
function boundsFromCenter(center: Point, size: Size): RectBoundsMm {
  return {
    leftMm: center.xMm - size.widthMm / 2,
    rightMm: center.xMm + size.widthMm / 2,
    bottomMm: center.yMm - size.heightMm / 2,
    topMm: center.yMm + size.heightMm / 2
  };
}

// Per-axis overlap depth of two rects. A value is > 0 only when the rects truly
// intersect on that axis; a flush edge-touch yields exactly 0 (STRICT overlap
// convention — see doWallObjectsOverlap). Both axes must be > 0 for a real
// collision, at which point min(x, y) is the 2D minimum-translation distance.
function overlapDepth(
  moving: RectBoundsMm,
  obstacle: RectBoundsMm
): { xMm: number; yMm: number } {
  return {
    xMm: Math.min(moving.rightMm, obstacle.rightMm) - Math.max(moving.leftMm, obstacle.leftMm),
    yMm: Math.min(moving.topMm, obstacle.topMm) - Math.max(moving.bottomMm, obstacle.bottomMm)
  };
}

function overlaps(depth: { xMm: number; yMm: number }): boolean {
  return depth.xMm > 0 && depth.yMm > 0;
}

// The four synthetic edge ids for the optional wall-container barrier. They live
// in the same broken-set namespace as obstacle ids; callers must not collide
// with them (obstacle ids are wall-object uuids, never "wall:*"). Exported so a
// caller pre-seeding the broken set (e.g. an object grabbed already overhanging
// the wall) can name the same edges the rebuild step re-arms against.
export const WALL_BARRIER_EDGE_IDS = {
  left: "wall:left",
  right: "wall:right",
  bottom: "wall:bottom",
  top: "wall:top"
} as const;

const WALL_LEFT = WALL_BARRIER_EDGE_IDS.left;
const WALL_RIGHT = WALL_BARRIER_EDGE_IDS.right;
const WALL_BOTTOM = WALL_BARRIER_EDGE_IDS.bottom;
const WALL_TOP = WALL_BARRIER_EDGE_IDS.top;

export function resolveDragBarriers(args: {
  proposedCenterMm: Point; // post-snap/quantize proposal
  movingSizeMm: Size;
  obstacles: BarrierObstacle[];
  wallSizeMm?: { lengthMm: number; heightMm: number }; // optional yielding container
  breakThresholdMm: number;
  brokenBarrierIds: ReadonlySet<string>; // hysteresis carried across drag frames
  includeYielding: boolean; // false under precision (⌘/Ctrl) bypass
}): {
  point: Point;
  brokenBarrierIds: string[];
  blocked: boolean;
} {
  const { movingSizeMm, obstacles, wallSizeMm, breakThresholdMm, includeYielding } = args;

  const point: Point = { ...args.proposedCenterMm };

  // Working broken set, seeded from the previous frame. An id that arrives here
  // stays "broken" (barrier disabled) until step 4 proves the object has pulled
  // clear — that's what lets a drag started already-overlapping (or a soft
  // barrier the user just popped) slide out smoothly instead of being yanked
  // flush the moment resolution runs.
  const broken = new Set(args.brokenBarrierIds);

  // ── Obstacle passes ──────────────────────────────────────────────────────
  // Each pass finds the SINGLE deepest still-colliding obstacle and either pops
  // it (yielding + pushed past threshold) or clamps flush against it, then
  // re-evaluates. Resolving one obstacle can nudge the rect into another, which
  // the next pass catches; if they can't all be satisfied the loop simply runs
  // out and step 5 reports `blocked`.
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const movingBounds = boundsFromCenter(point, movingSizeMm);

    let deepest: BarrierObstacle | null = null;
    let deepestDepth = { xMm: 0, yMm: 0 };
    let deepestMagnitude = 0;

    for (const obstacle of obstacles) {
      if (obstacle.hardness === "yielding") {
        // Yielding barriers are pure resistance: skipped wholesale under the
        // precision bypass, and skipped while already broken so a popped/leaving
        // rect passes through unimpeded. Hard barriers below get neither escape.
        if (!includeYielding) continue;
        if (broken.has(obstacle.id)) continue;
      }

      const depth = overlapDepth(movingBounds, obstacle.boundsMm);
      if (!overlaps(depth)) continue;

      const magnitude = Math.min(depth.xMm, depth.yMm);
      if (magnitude > deepestMagnitude || deepest === null) {
        deepest = obstacle;
        deepestDepth = depth;
        deepestMagnitude = magnitude;
      }
    }

    if (!deepest) break;

    if (deepest.hardness === "yielding" && deepestMagnitude > breakThresholdMm) {
      // The macOS "pop": the user pushed deeper than the break threshold, so the
      // soft barrier gives way. Record it broken and leave the point untouched;
      // subsequent passes ignore it (it's now in `broken`). With a 0 threshold
      // this fires on the first sliver of penetration — soft barriers become
      // effectively frictionless while hard ones still clamp.
      broken.add(deepest.id);
      continue;
    }

    // Clamp flush along the axis of LEAST penetration only — the 2D minimum
    // translation vector. Pushing out on both axes at once would teleport the
    // rect diagonally to a corner; resolving the shallower axis slides it out
    // the nearest face. Ties resolve on x (arbitrary but deterministic).
    const movingBounds2 = movingBounds; // faces frozen for this clamp
    if (deepestDepth.xMm <= deepestDepth.yMm) {
      // Nearer horizontal face wins: exit left (our right face → obstacle left)
      // or right (our left face → obstacle right), whichever is the shorter
      // push. Landing exactly flush is legal under the strict convention.
      const pushLeft = movingBounds2.rightMm - deepest.boundsMm.leftMm;
      const pushRight = deepest.boundsMm.rightMm - movingBounds2.leftMm;
      point.xMm =
        pushLeft <= pushRight
          ? deepest.boundsMm.leftMm - movingSizeMm.widthMm / 2
          : deepest.boundsMm.rightMm + movingSizeMm.widthMm / 2;
    } else {
      const pushDown = movingBounds2.topMm - deepest.boundsMm.bottomMm;
      const pushUp = deepest.boundsMm.topMm - movingBounds2.bottomMm;
      point.yMm =
        pushDown <= pushUp
          ? deepest.boundsMm.bottomMm - movingSizeMm.heightMm / 2
          : deepest.boundsMm.topMm + movingSizeMm.heightMm / 2;
    }
  }

  // ── Wall container barrier ───────────────────────────────────────────────
  // The wall interior is [0, lengthMm] × [0, heightMm]. Unlike obstacle MTV
  // resolution this is applied per axis independently — a container clamp on x
  // must not disturb a valid y. The container is always yielding; under the
  // precision bypass we skip it entirely (matching the yielding-obstacle rule).
  if (wallSizeMm && includeYielding) {
    // Each edge: if it's already broken, let the rect hang past it; if the
    // overhang exceeds the threshold, pop it (mark broken); otherwise clamp the
    // rect flush inside. Left/right share the x axis and top/bottom the y axis;
    // only one of each pair can overhang unless the rect is larger than the
    // wall, in which case the later clamp simply wins.
    const clampEdge = (
      edgeId: string,
      overhangMm: number,
      clampedCoord: number,
      assign: (v: number) => void
    ) => {
      if (overhangMm <= 0) return; // inside on this edge, nothing to do
      if (broken.has(edgeId)) return; // already popped — let it hang out
      if (overhangMm > breakThresholdMm) {
        broken.add(edgeId); // deliberate push past the wall edge → pop
        return;
      }
      assign(clampedCoord);
    };

    const b = boundsFromCenter(point, movingSizeMm);
    const halfW = movingSizeMm.widthMm / 2;
    const halfH = movingSizeMm.heightMm / 2;

    clampEdge(WALL_LEFT, 0 - b.leftMm, halfW, (v) => (point.xMm = v));
    clampEdge(WALL_RIGHT, b.rightMm - wallSizeMm.lengthMm, wallSizeMm.lengthMm - halfW, (v) => (point.xMm = v));
    clampEdge(WALL_BOTTOM, 0 - b.bottomMm, halfH, (v) => (point.yMm = v));
    clampEdge(WALL_TOP, b.topMm - wallSizeMm.heightMm, wallSizeMm.heightMm - halfH, (v) => (point.yMm = v));
  }

  // ── Rebuild the broken set (step 4) ──────────────────────────────────────
  // Re-arm any barrier the rect has separated from: an id survives to the next
  // frame only if it is STILL overlapping (obstacle) or overhanging (wall edge)
  // at the resolved point. This is what makes separation re-enable a barrier
  // and lets pre-seeded ids drop off exactly when the object clears them; stale
  // ids that match nothing fall out naturally.
  const finalBounds = boundsFromCenter(point, movingSizeMm);
  const obstaclesById = new Map(obstacles.map((o) => [o.id, o]));

  const nextBroken: string[] = [];
  for (const id of broken) {
    const obstacle = obstaclesById.get(id);
    if (obstacle) {
      if (overlaps(overlapDepth(finalBounds, obstacle.boundsMm))) nextBroken.push(id);
      continue;
    }
    if (wallSizeMm) {
      const stillOut =
        (id === WALL_LEFT && finalBounds.leftMm < 0) ||
        (id === WALL_RIGHT && finalBounds.rightMm > wallSizeMm.lengthMm) ||
        (id === WALL_BOTTOM && finalBounds.bottomMm < 0) ||
        (id === WALL_TOP && finalBounds.topMm > wallSizeMm.heightMm);
      if (stillOut) nextBroken.push(id);
    }
    // Unknown id (no matching obstacle, no wall) → dropped.
  }

  // ── blocked (step 5) ─────────────────────────────────────────────────────
  // A hard obstacle still overlapping the best-effort point means resolution
  // failed — e.g. the rect is squeezed between two hard obstacles with no gap,
  // or clamping off A shoved it into B unresolvably. We still hand back the
  // point (the caller uses it as a hint) but signal that it must hold the last
  // legal preview instead of committing this one. Hard barriers ignore the
  // precision bypass, so this check is unconditional.
  const blocked = obstacles.some(
    (o) => o.hardness === "hard" && overlaps(overlapDepth(finalBounds, o.boundsMm))
  );

  return { point, brokenBarrierIds: nextBroken, blocked };
}
