import { describe, expect, it } from "vitest";
import type { FloorWall } from "../geometry/planObjects";
import {
  getPlanGroupCenterMm,
  resolvePlanGroupMemberMove,
  resolvePlanGroupMove,
  resolvePlanGroupReanchorWall,
  resolvePlanObjectNudge,
  type PlanGroupMember
} from "./planGroupMove";

// Same FloorWall builder shape as planSnapTargets.test.ts: the room offset is
// baked into start/end (offset 0), so startFloorMm === start.
function makeWall(
  id: string,
  startMm: { xMm: number; yMm: number },
  endMm: { xMm: number; yMm: number }
): FloorWall {
  const dx = endMm.xMm - startMm.xMm;
  const dy = endMm.yMm - startMm.yMm;
  return {
    id,
    roomId: "room-1",
    name: id,
    startVertexId: `${id}-a`,
    endVertexId: `${id}-b`,
    heightMm: 3000,
    start: { id: `${id}-a`, ...startMm },
    end: { id: `${id}-b`, ...endMm },
    lengthMm: Math.hypot(dx, dy),
    angleRad: Math.atan2(dy, dx),
    startFloorMm: startMm,
    endFloorMm: endMm
  };
}

const HORIZONTAL_WALL = makeWall("wall-1", { xMm: 0, yMm: 0 }, { xMm: 4000, yMm: 0 });
// A second wall parallel to the first, 1000mm below it (its own start→end runs
// in the same direction), used as the foreign re-anchor target.
const FAR_WALL = makeWall("wall-2", { xMm: 0, yMm: 1000 }, { xMm: 4000, yMm: 1000 });

describe("getPlanGroupCenterMm", () => {
  it("is the bounding-box center of the members' rest centers", () => {
    const members: PlanGroupMember[] = [
      { id: "a", anchor: "floor", centerMm: { xMm: 0, yMm: 0 }, widthMm: 100, depthMm: 100, rotationDeg: 0 },
      { id: "b", anchor: "floor", centerMm: { xMm: 400, yMm: 200 }, widthMm: 100, depthMm: 100, rotationDeg: 0 }
    ];

    expect(getPlanGroupCenterMm(members)).toEqual({ xMm: 200, yMm: 100 });
  });
});

describe("resolvePlanGroupMemberMove", () => {
  it("translates a floor member by the delta and commits its new center", () => {
    const member: PlanGroupMember = {
      id: "floor-1",
      anchor: "floor",
      centerMm: { xMm: 1000, yMm: 500 },
      widthMm: 300,
      depthMm: 400,
      rotationDeg: 45
    };

    const { rect, commit } = resolvePlanGroupMemberMove(member, { xMm: 100, yMm: -50 });

    expect(rect.centerXMm).toBeCloseTo(1100);
    expect(rect.centerYMm).toBeCloseTo(450);
    expect(rect.angleDeg).toBe(45);
    expect(commit).toEqual({ id: "floor-1", xMm: 1100, yMm: 450 });
  });

  it("re-projects a wall member onto its own wall and commits a wall-local x", () => {
    // Center sits at x=1000 along a horizontal wall; a +200x/+300y delta moves
    // it off the line, but it must reproject back onto the wall (y snaps to the
    // wall line, x advances by 200).
    const member: PlanGroupMember = {
      id: "wall-1-obj",
      anchor: "wall",
      kind: "artwork",
      wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 1000, yMm: 0 },
      widthMm: 300,
      depthMm: 100
    };

    const { rect, commit } = resolvePlanGroupMemberMove(member, { xMm: 200, yMm: 300 });

    expect(commit.id).toBe("wall-1-obj");
    expect(commit.xMm).toBeCloseTo(1200);
    expect(commit.yMm).toBeUndefined();
    expect(rect.centerXMm).toBeCloseTo(1200);
    expect(rect.centerYMm).toBeCloseTo(0);
  });

  it("previews a wall member at its OWN depth, so a case/deep work keeps its protrusion", () => {
    // The builders (PlanView's nudge, beginObjectDrag's group path) resolve
    // this per member via effectiveWallObjectPlanDepthMm; both used to hard-code
    // the nominal band, which flattened a vitrine for the whole gesture.
    const member: PlanGroupMember = {
      id: "wall-case",
      anchor: "wall",
      kind: "case",
      wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 1000, yMm: 0 },
      widthMm: 300,
      depthMm: 450
    };

    const { rect } = resolvePlanGroupMemberMove(member, { xMm: 200, yMm: 0 });

    expect(rect.depthMm).toBe(450);
  });

  it("clamps a wall member's along-wall x to the wall extent", () => {
    const member: PlanGroupMember = {
      id: "wall-1-obj",
      anchor: "wall",
      kind: "artwork",
      wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 3800, yMm: 0 },
      widthMm: 300,
      depthMm: 100
    };

    // A +1000 delta would push it to x=4800, past the 4000-long wall's end.
    const { commit } = resolvePlanGroupMemberMove(member, { xMm: 1000, yMm: 0 });

    expect(commit.xMm).toBeCloseTo(4000);
  });

  it("re-anchors an artwork member onto the target wall, carrying its wallId", () => {
    // A work at x=1000 on the horizontal wall, dragged +900 in y onto FAR_WALL
    // (1000 below): its translated center projects onto FAR_WALL, and the commit
    // carries the new wallId plus the projected along-wall x.
    const member: PlanGroupMember = {
      id: "art",
      anchor: "wall",
      kind: "artwork",
      wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 1000, yMm: 0 },
      widthMm: 300,
      depthMm: 100
    };

    const { rect, commit } = resolvePlanGroupMemberMove(member, { xMm: 200, yMm: 900 }, FAR_WALL);

    expect(commit).toEqual({ id: "art", xMm: 1200, wallId: "wall-2" });
    expect(commit.yMm).toBeUndefined();
    expect(rect.centerXMm).toBeCloseTo(1200);
    expect(rect.centerYMm).toBeCloseTo(1000);
  });

  it("preserves relative order and spacing when re-anchoring a group of artwork", () => {
    // Two works 1500mm apart along the horizontal wall re-anchor onto FAR_WALL;
    // an independent projection of each translated center keeps their order and
    // 1500mm spacing on the target wall.
    const a: PlanGroupMember = {
      id: "a", anchor: "wall", kind: "artwork", wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 1000, yMm: 0 }, widthMm: 200, depthMm: 100
    };
    const b: PlanGroupMember = {
      id: "b", anchor: "wall", kind: "artwork", wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 2500, yMm: 0 }, widthMm: 200, depthMm: 100
    };

    const delta = { xMm: 0, yMm: 900 };
    const ca = resolvePlanGroupMemberMove(a, delta, FAR_WALL).commit;
    const cb = resolvePlanGroupMemberMove(b, delta, FAR_WALL).commit;

    expect(ca.xMm).toBeCloseTo(1000);
    expect(cb.xMm).toBeCloseTo(2500);
    expect(cb.xMm - ca.xMm).toBeCloseTo(1500);
  });

  it("clamps a re-anchored artwork's x to the target wall's ends", () => {
    const member: PlanGroupMember = {
      id: "art", anchor: "wall", kind: "artwork", wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 3800, yMm: 0 }, widthMm: 300, depthMm: 100
    };

    // +1000 x pushes the projected center past FAR_WALL's 4000 end → clamped.
    const { commit } = resolvePlanGroupMemberMove(member, { xMm: 1000, yMm: 900 }, FAR_WALL);

    expect(commit.wallId).toBe("wall-2");
    expect(commit.xMm).toBeCloseTo(4000);
  });

  it("never re-anchors a non-artwork wall member (openings slide on their own wall)", () => {
    const door: PlanGroupMember = {
      id: "door", anchor: "wall", kind: "door", wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 1000, yMm: 0 }, widthMm: 900, depthMm: 150
    };

    // Even with a target wall offered, the door stays on HORIZONTAL_WALL: no
    // wallId in the commit, and its rect stays on the original wall line (y=0).
    const { rect, commit } = resolvePlanGroupMemberMove(door, { xMm: 200, yMm: 900 }, FAR_WALL);

    expect(commit.wallId).toBeUndefined();
    expect(commit.xMm).toBeCloseTo(1200);
    expect(rect.centerYMm).toBeCloseTo(0);
  });

  it("leaves a floor member untouched by a re-anchor target", () => {
    const floor: PlanGroupMember = {
      id: "floor", anchor: "floor", centerMm: { xMm: 1000, yMm: 500 },
      widthMm: 300, depthMm: 400, rotationDeg: 0
    };

    const { commit } = resolvePlanGroupMemberMove(floor, { xMm: 100, yMm: 900 }, FAR_WALL);

    expect(commit).toEqual({ id: "floor", xMm: 1100, yMm: 1400 });
  });

  it("is identity with the old behavior when no target wall is supplied", () => {
    const member: PlanGroupMember = {
      id: "art", anchor: "wall", kind: "artwork", wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 1000, yMm: 0 }, widthMm: 300, depthMm: 100
    };

    // No reanchorWall → reproject onto the own wall, no wallId in the commit.
    const { commit } = resolvePlanGroupMemberMove(member, { xMm: 200, yMm: 900 });

    expect(commit).toEqual({ id: "art", xMm: 1200 });
  });
});

describe("resolvePlanGroupReanchorWall", () => {
  const walls = [HORIZONTAL_WALL, FAR_WALL];

  it("returns null when the group center is near only the members' own walls", () => {
    // Group center sits right on HORIZONTAL_WALL (a member wall) — that's not a
    // foreign wall, so nothing re-anchors and today's own-wall slide holds.
    const result = resolvePlanGroupReanchorWall({
      groupCenterMm: { xMm: 2000, yMm: 0 },
      walls,
      memberWallIds: new Set(["wall-1"]),
      captureDistanceMm: 100,
      previousTargetWallId: null
    });

    expect(result).toBeNull();
  });

  it("captures a foreign wall once the group center comes within its radius", () => {
    // Center 80mm from FAR_WALL (a non-member wall), inside the 100mm radius.
    const result = resolvePlanGroupReanchorWall({
      groupCenterMm: { xMm: 2000, yMm: 920 },
      walls,
      memberWallIds: new Set(["wall-1"]),
      captureDistanceMm: 100,
      previousTargetWallId: null
    });

    expect(result?.id).toBe("wall-2");
  });

  it("does not capture a foreign wall still outside the base radius", () => {
    // 200mm from FAR_WALL, beyond the 100mm base radius, with no sticky target.
    const result = resolvePlanGroupReanchorWall({
      groupCenterMm: { xMm: 2000, yMm: 800 },
      walls,
      memberWallIds: new Set(["wall-1"]),
      captureDistanceMm: 100,
      previousTargetWallId: null
    });

    expect(result).toBeNull();
  });

  it("holds a sticky previous target past the base radius (break-free hysteresis)", () => {
    // 130mm from FAR_WALL: beyond the 100mm base radius but inside the 1.5×
    // break-free radius (150mm) because wall-2 is the sticky previous target.
    const result = resolvePlanGroupReanchorWall({
      groupCenterMm: { xMm: 2000, yMm: 870 },
      walls,
      memberWallIds: new Set(["wall-1"]),
      captureDistanceMm: 100,
      previousTargetWallId: "wall-2"
    });

    expect(result?.id).toBe("wall-2");
  });
});

// ── Rigid shelf assemblies ─────────────────────────────────────────────────
// A shelf plus the works standing on it is ONE body (USER DECISION). These pin
// the two things that make it one: the rider offsets never change, and the
// clamp is applied ONCE to the union instead of per member.

const SHORT_WALL = makeWall("wall-short", { xMm: 0, yMm: 2000 }, { xMm: 1000, yMm: 2000 });
const OPEN_WALL: FloorWall = {
  ...makeWall("wall-open", { xMm: 0, yMm: 3000 }, { xMm: 8000, yMm: 3000 }),
  isOpenSide: true
};

// A 1200-wide shelf centred at x=2000 carrying two 300-wide works at ±400.
function shelfAssembly(
  wall: FloorWall = HORIZONTAL_WALL,
  shelfXMm = 2000
): PlanGroupMember[] {
  const at = (xAlongMm: number) => ({
    xMm: wall.startFloorMm.xMm + xAlongMm,
    yMm: wall.startFloorMm.yMm
  });
  return [
    {
      id: "shelf",
      anchor: "wall",
      kind: "shelf",
      wall,
      worldCenterMm: at(shelfXMm),
      widthMm: 1200,
      depthMm: 300
    },
    {
      id: "rider-left",
      anchor: "wall",
      kind: "artwork",
      ridesShelfId: "shelf",
      wall,
      worldCenterMm: at(shelfXMm - 400),
      widthMm: 300,
      depthMm: 100
    },
    {
      id: "rider-right",
      anchor: "wall",
      kind: "artwork",
      ridesShelfId: "shelf",
      wall,
      worldCenterMm: at(shelfXMm + 400),
      widthMm: 300,
      depthMm: 100
    }
  ];
}

function offsetsFrom(moves: { id: string; commit: { xMm: number } }[]): number[] {
  const shelfXMm = moves.find((move) => move.id === "shelf")?.commit.xMm ?? NaN;
  return moves
    .filter((move) => move.id !== "shelf")
    .map((move) => move.commit.xMm - shelfXMm);
}

describe("resolvePlanGroupMove — shelf assemblies", () => {
  it("carries riders rigidly on an ordinary slide", () => {
    const { moves, refusedShelfIds } = resolvePlanGroupMove(shelfAssembly(), {
      xMm: 500,
      yMm: 0
    });

    expect(refusedShelfIds).toEqual([]);
    expect(moves.map((move) => move.commit.xMm)).toEqual([2500, 2100, 2900]);
    expect(offsetsFrom(moves)).toEqual([-400, 400]);
    // Same-wall slide ⇒ a pure x update, exactly as before shelves existed.
    for (const move of moves) expect(move.commit.wallId).toBeUndefined();
  });

  it("keeps rider offsets byte-identical at BOTH wall ends", () => {
    // Union spans shelf ±600 (the slab is the widest member), so the assembly
    // must come to rest with its union edge on the wall end, never squashed.
    const atStart = resolvePlanGroupMove(shelfAssembly(), { xMm: -9000, yMm: 0 });
    expect(offsetsFrom(atStart.moves)).toEqual([-400, 400]);
    expect(atStart.moves[0].commit.xMm).toBe(600);

    const atEnd = resolvePlanGroupMove(shelfAssembly(), { xMm: 9000, yMm: 0 });
    expect(offsetsFrom(atEnd.moves)).toEqual([-400, 400]);
    expect(atEnd.moves[0].commit.xMm).toBe(HORIZONTAL_WALL.lengthMm - 600);

    // Per-member clamping is what this replaces: clamped alone, the riders
    // would pile up on the wall end and the spacing would collapse.
    const perMember = shelfAssembly().map(
      (member) => resolvePlanGroupMemberMove(member, { xMm: 9000, yMm: 0 }).commit.xMm
    );
    expect(perMember).toEqual([4000, 4000, 4000]);
  });

  it("re-anchors the whole assembly onto a foreign wall with one common delta", () => {
    const { moves, refusedShelfIds } = resolvePlanGroupMove(
      shelfAssembly(),
      { xMm: 0, yMm: 900 },
      FAR_WALL
    );

    expect(refusedShelfIds).toEqual([]);
    expect(moves.map((move) => move.commit)).toEqual([
      { id: "shelf", xMm: 2000, wallId: "wall-2" },
      { id: "rider-left", xMm: 1600, wallId: "wall-2" },
      { id: "rider-right", xMm: 2400, wallId: "wall-2" }
    ]);
    // Every preview rect landed on the target wall's line.
    for (const move of moves) expect(move.rect.centerYMm).toBeCloseTo(1000);
  });

  it("clamps one common delta when the target wall is SHORTER than the source", () => {
    // Narrow enough to fit SHORT_WALL: a 600 shelf with 100-wide riders at
    // ±400 gives a union of 600..-300..+450 → 900mm on a 1000mm wall.
    const narrow = shelfAssembly().map((member) =>
      member.id === "shelf"
        ? { ...member, widthMm: 600 }
        : { ...member, widthMm: 100 }
    );
    const { moves, refusedShelfIds } = resolvePlanGroupMove(
      narrow,
      { xMm: 0, yMm: 2000 },
      SHORT_WALL
    );

    expect(refusedShelfIds).toEqual([]);
    // The projected shelf centre would be 2000 on a 1000-long wall; the
    // union's right edge (shelf + 450) pins it at 550, riders following.
    expect(moves[0].commit).toEqual({ id: "shelf", xMm: 550, wallId: "wall-short" });
    expect(offsetsFrom(moves)).toEqual([-400, 400]);
  });

  it("REFUSES a target wall the union cannot fit, leaving the assembly on its own wall", () => {
    const { moves, refusedShelfIds } = resolvePlanGroupMove(
      shelfAssembly(),
      { xMm: 0, yMm: 2000 },
      SHORT_WALL
    );

    expect(refusedShelfIds).toEqual(["shelf"]);
    for (const move of moves) {
      expect(move.commit.wallId).toBeUndefined();
      expect(move.rect.centerYMm).toBeCloseTo(0);
    }
    // Still rigid, still on wall-1: only the along-wall slide took effect.
    expect(offsetsFrom(moves)).toEqual([-400, 400]);
  });

  it("REFUSES an open wall, which has no surface to stand on", () => {
    const { moves, refusedShelfIds } = resolvePlanGroupMove(
      shelfAssembly(),
      { xMm: 0, yMm: 3000 },
      OPEN_WALL
    );

    expect(refusedShelfIds).toEqual(["shelf"]);
    for (const move of moves) expect(move.commit.wallId).toBeUndefined();
  });

  it("re-anchors a lone shelf (an assembly of one) and never a door or a case", () => {
    const [shelf] = shelfAssembly();
    const door: PlanGroupMember = {
      id: "door", anchor: "wall", kind: "door", wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 1000, yMm: 0 }, widthMm: 900, depthMm: 150
    };
    const wallCase: PlanGroupMember = {
      id: "case", anchor: "wall", kind: "case", wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 3000, yMm: 0 }, widthMm: 500, depthMm: 450
    };

    const { moves } = resolvePlanGroupMove([shelf, door, wallCase], { xMm: 0, yMm: 900 }, FAR_WALL);

    expect(moves[0].commit.wallId).toBe("wall-2");
    expect(moves[1].commit.wallId).toBeUndefined();
    expect(moves[2].commit.wallId).toBeUndefined();
  });

  it("treats a declared rider whose shelf is not in the set as an ordinary member", () => {
    const [, riderLeft] = shelfAssembly();
    const { moves, refusedShelfIds } = resolvePlanGroupMove([riderLeft], { xMm: 9000, yMm: 0 });

    expect(refusedShelfIds).toEqual([]);
    // Clamped on its own, exactly like any lone artwork: centre pinned to the
    // wall end rather than held half a shelf-width inside it.
    expect(moves[0].commit.xMm).toBeCloseTo(4000);
  });

  it("gives preview rects and commits from ONE pass", () => {
    const { moves } = resolvePlanGroupMove(shelfAssembly(), { xMm: 250, yMm: 0 });
    for (const move of moves) {
      expect(move.rect.centerXMm).toBeCloseTo(move.commit.xMm);
    }
  });
});

describe("resolvePlanObjectNudge with a shelf in the selection", () => {
  it("nudges the assembly rigidly, in one group commit", () => {
    const nudge = resolvePlanObjectNudge(shelfAssembly(), { xMm: 10, yMm: 0 });

    expect(nudge?.kind).toBe("group");
    const moves = nudge?.kind === "group" ? nudge.moves : [];
    expect(moves.map((move) => move.id)).toEqual(["shelf", "rider-left", "rider-right"]);
    expect(moves[0].xMm).toBeCloseTo(2010);
    expect(moves[1].xMm).toBeCloseTo(1610);
    expect(moves[2].xMm).toBeCloseTo(2410);
    // No wall change and no floor y on a wall member.
    for (const move of moves) expect(move.yMm).toBeUndefined();
  });

  it("holds the offsets when the nudge runs the assembly into the wall end", () => {
    const nudge = resolvePlanObjectNudge(shelfAssembly(HORIZONTAL_WALL, 3350), {
      xMm: 100,
      yMm: 0
    });

    const moves = nudge?.kind === "group" ? nudge.moves : [];
    // The union's right edge stops at the 4000 wall end (shelf at 3400), and
    // the riders keep their ±400 offsets rather than piling up behind it.
    expect(moves.map((move) => move.xMm)).toEqual([3400, 3000, 3800]);
  });
});
