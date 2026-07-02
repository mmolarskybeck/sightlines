import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import { getWallsWithGeometry } from "./walls";
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

  it("can rectify a skewed four-wall room on the next numeric edit", () => {
    const project = createSampleProject();
    project.floor.rooms[0].room.vertices = project.floor.rooms[0].room.vertices.map(
      (vertex) =>
        vertex.id === "v-se" ? { ...vertex, xMm: feetToMm(29) } : vertex
    );
    const result = resizeWallPreservingAngles(
      project,
      "wall-north",
      feetToMm(30)
    );
    const walls = getWallsWithGeometry(result.project.floor.rooms[0].room);
    const northWall = walls.find((wall) => wall.id === "wall-north");
    const eastWall = walls.find((wall) => wall.id === "wall-east");
    const southWall = walls.find((wall) => wall.id === "wall-south");
    const westWall = walls.find((wall) => wall.id === "wall-west");

    expect(northWall?.lengthMm).toBeCloseTo(feetToMm(30));
    expect(southWall?.lengthMm).toBeCloseTo(feetToMm(30));
    expect(dot(northWall!, eastWall!)).toBeCloseTo(0);
    expect(dot(southWall!, westWall!)).toBeCloseTo(0);
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

function dot(
  a: { start: { xMm: number; yMm: number }; end: { xMm: number; yMm: number } },
  b: { start: { xMm: number; yMm: number }; end: { xMm: number; yMm: number } }
): number {
  return (
    (a.end.xMm - a.start.xMm) * (b.end.xMm - b.start.xMm) +
    (a.end.yMm - a.start.yMm) * (b.end.yMm - b.start.yMm)
  );
}
