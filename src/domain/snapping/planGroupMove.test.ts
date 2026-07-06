import { describe, expect, it } from "vitest";
import type { FloorWall } from "../geometry/planObjects";
import {
  getPlanGroupCenterMm,
  resolvePlanGroupMemberMove,
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
      wall: HORIZONTAL_WALL,
      worldCenterMm: { xMm: 3800, yMm: 0 },
      widthMm: 300,
      depthMm: 100
    };

    // A +1000 delta would push it to x=4800, past the 4000-long wall's end.
    const { commit } = resolvePlanGroupMemberMove(member, { xMm: 1000, yMm: 0 });

    expect(commit.xMm).toBeCloseTo(4000);
  });
});
