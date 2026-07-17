import { describe, expect, it } from "vitest";
import type { FloorWall } from "../geometry/planObjects";
import {
  getPlanGroupCenterMm,
  resolvePlanGroupMemberMove,
  resolvePlanGroupReanchorWall,
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
