import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import { getWallsWithGeometry, isRectangleRoom } from "./walls";
import { resizeWallPreservingAngles } from "./editRoom";

describe("resizeWallPreservingAngles", () => {
  it("resizes a four-wall room without skewing adjacent walls", () => {
    const project = createSampleProject();
    const result = resizeWallPreservingAngles(
      project,
      "wall-north",
      feetToMm(30)
    );
    const walls = getWallsWithGeometry(result.project.floor.rooms[0].room);
    const northWall = walls.find((wall) => wall.id === "wall-north");
    const eastWall = walls.find((wall) => wall.id === "wall-east");
    const southWall = walls.find((wall) => wall.id === "wall-south");

    expect(result.anchorVertexId).toBe("v-nw");
    expect(result.changedWallIds).toEqual(["wall-north", "wall-south"]);
    expect(northWall?.lengthMm).toBeCloseTo(feetToMm(30));
    expect(southWall?.lengthMm).toBeCloseTo(feetToMm(30));
    expect(eastWall?.lengthMm).toBeCloseTo(feetToMm(18));
    expect(dot(northWall!, eastWall!)).toBeCloseTo(0);
  });

  it("refuses a skewed four-wall room instead of silently squaring it", () => {
    // This used to "rectify" the skew — reasonable when a skewed quad could
    // only mean drift or corruption, wrong now that polygon drawing makes
    // non-rectangular quads deliberate geometry. resizeOrthogonalQuad would
    // rebuild this as a rectangle, so it must never run on one.
    const project = createSampleProject();
    project.floor.rooms[0].room.vertices = project.floor.rooms[0].room.vertices.map(
      (vertex) =>
        vertex.id === "v-se" ? { ...vertex, xMm: feetToMm(29) } : vertex
    );

    expect(() =>
      resizeWallPreservingAngles(project, "wall-north", feetToMm(30))
    ).toThrow(/isn't a simple rectangle/);
  });

  it("keeps the original project immutable", () => {
    const project = createSampleProject();
    const result = resizeWallPreservingAngles(
      project,
      "wall-north",
      feetToMm(30)
    );

    expect(project.floor.rooms[0].room.vertices).not.toBe(
      result.project.floor.rooms[0].room.vertices
    );
    expect(
      project.floor.rooms[0].room.vertices.find((vertex) => vertex.id === "v-ne")
        ?.xMm
    ).toBeCloseTo(feetToMm(28));
  });

  it("anchor \"end\" holds a width wall's end vertex fixed in world space while the start side moves", () => {
    const project = createSampleProject();
    const worldEndBefore = worldVertex(project, "v-ne");
    const worldStartBefore = worldVertex(project, "v-nw");

    const result = resizeWallPreservingAngles(
      project,
      "wall-north",
      feetToMm(30),
      "end"
    );

    const walls = getWallsWithGeometry(result.project.floor.rooms[0].room);
    const northWall = walls.find((wall) => wall.id === "wall-north");
    expect(northWall?.lengthMm).toBeCloseTo(feetToMm(30));
    expect(result.anchorVertexId).toBe("v-ne");

    // The end side is pinned in world space; the start side absorbs the growth.
    const worldEndAfter = worldVertex(result.project, "v-ne");
    expect(worldEndAfter.xMm).toBeCloseTo(worldEndBefore.xMm);
    expect(worldEndAfter.yMm).toBeCloseTo(worldEndBefore.yMm);
    expect(worldVertex(result.project, "v-nw").xMm).toBeCloseTo(
      worldStartBefore.xMm - feetToMm(2)
    );
    // Since the merge into moveRoomWall, an "end" anchor is a slide of the
    // PREVIOUS wall in room-local space — the placement offset is never
    // touched (pre-merge it was shifted to compensate a start-anchored
    // local resize).
    expect(result.project.floor.rooms[0].offsetXMm).toBe(0);
    expect(result.project.floor.rooms[0].offsetYMm).toBe(0);
  });

  it("anchor \"end\" holds a depth wall's end vertex fixed in world space too", () => {
    const project = createSampleProject();
    const worldEndBefore = worldVertex(project, "v-se");
    const worldStartBefore = worldVertex(project, "v-ne");

    const result = resizeWallPreservingAngles(
      project,
      "wall-east",
      feetToMm(20),
      "end"
    );

    const walls = getWallsWithGeometry(result.project.floor.rooms[0].room);
    const eastWall = walls.find((wall) => wall.id === "wall-east");
    expect(eastWall?.lengthMm).toBeCloseTo(feetToMm(20));
    expect(result.anchorVertexId).toBe("v-se");

    const worldEndAfter = worldVertex(result.project, "v-se");
    expect(worldEndAfter.xMm).toBeCloseTo(worldEndBefore.xMm);
    expect(worldEndAfter.yMm).toBeCloseTo(worldEndBefore.yMm);
    expect(worldVertex(result.project, "v-ne").yMm).toBeCloseTo(
      worldStartBefore.yMm - feetToMm(2)
    );
  });

  it("anchor \"start\" is unchanged from the default: end vertex moves, offset untouched", () => {
    const project = createSampleProject();
    const explicit = resizeWallPreservingAngles(
      project,
      "wall-north",
      feetToMm(30),
      "start"
    );
    const defaulted = resizeWallPreservingAngles(project, "wall-north", feetToMm(30));

    expect(explicit.anchorVertexId).toBe("v-nw");
    expect(explicit.project.floor.rooms[0].offsetXMm).toBe(0);
    expect(explicit.project.floor.rooms[0].offsetYMm).toBe(0);
    expect(explicit.project).toEqual(defaulted.project);
  });

  it("rejects non-positive lengths", () => {
    const project = createSampleProject();

    expect(() => resizeWallPreservingAngles(project, "wall-north", 0)).toThrow(
      /greater than zero/
    );
  });

  it("rejects numeric resize on a non-rectangular room instead of skewing it", () => {
    const project = createSampleProject();
    const room = project.floor.rooms[0].room;
    // Turn the sample rectangle into a triangle (still a valid closed loop
    // per the schema) by dropping the west wall and rejoining south to nw.
    project.floor.rooms[0].room = {
      ...room,
      vertices: room.vertices.filter((vertex) => vertex.id !== "v-sw"),
      walls: [
        room.walls[0],
        room.walls[1],
        { ...room.walls[2], endVertexId: "v-nw" }
      ]
    };

    expect(() => resizeWallPreservingAngles(project, "wall-north", feetToMm(30))).toThrow(
      /only supports rectangular rooms/
    );
  });
});

// Characterization tests for the rectangle-only numeric resize pipeline
// (RoomResizeHandles -> dragResize -> resizeWallPreservingAngles). Since
// 2026-07-12 that path delegates into the general polygon wall-move core
// (reshapeRoom.moveRoomWall) — the merge this suite was built to gate —
// and these tests now pin the wrapper's contract. Anchor semantics (which
// vertex is held fixed in world space for "start" vs "end"), non-rectangle
// rejection, and a width-wall resize's changedWallIds are already covered
// by the tests above; this block fills in what wasn't: full-quad
// orthogonality (all four corners, not just one adjacent pair) and the
// depth-wall (perpendicular-dimension) counterpart of the paired-dimension
// and changed-wall-ids promises.
describe("rectangle resize characterization (pipeline-merge gate)", () => {
  it("resizing the width wall keeps the whole quad rectangular, not just the one adjacent corner already checked above", () => {
    const project = createSampleProject();
    const result = resizeWallPreservingAngles(project, "wall-north", feetToMm(30));

    expect(isRectangleRoom(result.project.floor.rooms[0].room)).toBe(true);
  });

  it("resizing a depth wall (east) changes exactly the two depth walls' lengths, leaves the width walls' lengths unchanged, and keeps all four corners square", () => {
    const project = createSampleProject();
    const result = resizeWallPreservingAngles(project, "wall-east", feetToMm(10));

    expect(result.changedWallIds.slice().sort()).toEqual(
      ["wall-east", "wall-west"].sort()
    );
    expect(isRectangleRoom(result.project.floor.rooms[0].room)).toBe(true);

    const walls = getWallsWithGeometry(result.project.floor.rooms[0].room);
    const north = walls.find((wall) => wall.id === "wall-north");
    const east = walls.find((wall) => wall.id === "wall-east");
    const south = walls.find((wall) => wall.id === "wall-south");
    const west = walls.find((wall) => wall.id === "wall-west");

    // The resized wall and its opposite (parallel) wall both land on the
    // new length — a rectangle's opposite sides must match.
    expect(east?.lengthMm).toBeCloseTo(feetToMm(10));
    expect(west?.lengthMm).toBeCloseTo(feetToMm(10));
    // The perpendicular dimension (width) is untouched.
    expect(north?.lengthMm).toBeCloseTo(feetToMm(28));
    expect(south?.lengthMm).toBeCloseTo(feetToMm(28));
  });
});

// A vertex's position in world/floor space is its room-local position plus
// the placement offset — the invariant an "end"-anchored resize must hold.
function worldVertex(
  project: ReturnType<typeof createSampleProject>,
  vertexId: string
): { xMm: number; yMm: number } {
  const placement = project.floor.rooms[0];
  const vertex = placement.room.vertices.find((candidate) => candidate.id === vertexId)!;
  return {
    xMm: vertex.xMm + placement.offsetXMm,
    yMm: vertex.yMm + placement.offsetYMm
  };
}

function dot(
  a: { start: { xMm: number; yMm: number }; end: { xMm: number; yMm: number } },
  b: { start: { xMm: number; yMm: number }; end: { xMm: number; yMm: number } }
): number {
  return (
    (a.end.xMm - a.start.xMm) * (b.end.xMm - b.start.xMm) +
    (a.end.yMm - a.start.yMm) * (b.end.yMm - b.start.yMm)
  );
}
