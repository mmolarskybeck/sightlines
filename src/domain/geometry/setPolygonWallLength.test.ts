import { describe, expect, it } from "vitest";
import { createBlankProject } from "../newProject";
import { createSampleProject } from "../sample/sampleProject";
import type { Project } from "../project";
import { createPolygonRoomPlacement } from "./createRoom";
import { resizeWallPreservingAngles, setPolygonWallLength } from "./editRoom";
import { getWallGeometry, getWallsWithGeometry } from "./walls";

function polygonProject(points: Array<{ xMm: number; yMm: number }>): Project {
  const project = createBlankProject("Polygon length test");
  const placement = createPolygonRoomPlacement({
    roomId: "room-polygon",
    name: "Irregular gallery",
    heightMm: 3000,
    pointsFloorMm: points
  });
  return { ...project, floor: { rooms: [placement] } };
}

const L_SHAPE = [
  { xMm: 0, yMm: 0 },
  { xMm: 5000, yMm: 0 },
  { xMm: 5000, yMm: 4000 },
  { xMm: 3000, yMm: 4000 },
  { xMm: 3000, yMm: 2000 },
  { xMm: 0, yMm: 2000 }
];

describe("setPolygonWallLength", () => {
  it("sets an orthogonal L-shape segment exactly with the start anchored", () => {
    const project = polygonProject(L_SHAPE);
    const room = project.floor.rooms[0].room;
    const wall = room.walls[0];
    const before = getWallGeometry(room, wall);

    const result = setPolygonWallLength(project, wall.id, 4200, "start");
    const afterRoom = result.project.floor.rooms[0].room;
    const after = getWallGeometry(afterRoom, wall);

    expect(after.lengthMm).toBeCloseTo(4200, 8);
    expect(result.anchorVertexId).toBe(wall.startVertexId);
    expect(after.start).toMatchObject({ xMm: before.start.xMm, yMm: before.start.yMm });
    expect(after.end.xMm - after.start.xMm).toBeCloseTo(
      ((before.end.xMm - before.start.xMm) / before.lengthMm) * 4200,
      8
    );
    expect(after.end.yMm - after.start.yMm).toBeCloseTo(
      ((before.end.yMm - before.start.yMm) / before.lengthMm) * 4200,
      8
    );
  });

  it("supports the end anchor and leaves that endpoint fixed", () => {
    const project = polygonProject(L_SHAPE);
    const room = project.floor.rooms[0].room;
    const wall = room.walls[0];
    const before = getWallGeometry(room, wall);

    const result = setPolygonWallLength(project, wall.id, 4200, "end");
    const after = getWallGeometry(result.project.floor.rooms[0].room, wall);

    expect(after.lengthMm).toBeCloseTo(4200, 8);
    expect(result.anchorVertexId).toBe(wall.endVertexId);
    expect(after.end).toMatchObject({ xMm: before.end.xMm, yMm: before.end.yMm });
  });

  it("uses the same closed-form operation for slanted polygons", () => {
    const project = polygonProject([
      { xMm: 0, yMm: 0 },
      { xMm: 4000, yMm: 1000 },
      { xMm: 5200, yMm: 3300 },
      { xMm: 700, yMm: 4200 }
    ]);
    const room = project.floor.rooms[0].room;
    const wall = room.walls[0];
    const beforeWalls = getWallsWithGeometry(room);
    const target = 5000;

    const result = setPolygonWallLength(project, wall.id, target, "start");
    const afterWalls = getWallsWithGeometry(result.project.floor.rooms[0].room);
    const resized = afterWalls.find((candidate) => candidate.id === wall.id)!;

    expect(resized.lengthMm).toBeCloseTo(target, 8);
    for (const candidate of afterWalls) {
      const before = beforeWalls.find((item) => item.id === candidate.id)!;
      const cross =
        (before.end.xMm - before.start.xMm) * (candidate.end.yMm - candidate.start.yMm) -
        (before.end.yMm - before.start.yMm) * (candidate.end.xMm - candidate.start.xMm);
      expect(cross).toBeCloseTo(0, 6);
    }
  });

  it.each(["start", "end"] as const)(
    "is equivalent to the characterized rectangle resize for the %s anchor",
    (anchor) => {
      const project = createSampleProject();
      const target = 9000;

      const polygonResult = setPolygonWallLength(project, "wall-north", target, anchor);
      const rectangleResult = resizeWallPreservingAngles(project, "wall-north", target, anchor);

      expect(polygonResult).toEqual(rectangleResult);
    }
  );

  it("handles polygon input supplied in the reverse winding", () => {
    const project = polygonProject([...L_SHAPE].reverse());
    const wall = project.floor.rooms[0].room.walls[0];

    const result = setPolygonWallLength(project, wall.id, 4200, "start");

    expect(getWallGeometry(result.project.floor.rooms[0].room, wall).lengthMm).toBeCloseTo(
      4200,
      8
    );
  });

  it("rejects geometry that would collapse the selected segment", () => {
    const project = polygonProject(L_SHAPE);
    const wallId = project.floor.rooms[0].room.walls[0].id;
    expect(() => setPolygonWallLength(project, wallId, 5, "start")).toThrow(/collapse|too close/);
  });

  it("rejects invalid numeric lengths", () => {
    const project = polygonProject(L_SHAPE);
    const wallId = project.floor.rooms[0].room.walls[0].id;
    expect(() => setPolygonWallLength(project, wallId, 0)).toThrow(/greater than zero/);
    expect(() => setPolygonWallLength(project, wallId, Number.NaN)).toThrow(/greater than zero/);
  });

  it("preserves an exact edit smaller than the drag-preview tolerance", () => {
    const project = polygonProject(L_SHAPE);
    const wall = project.floor.rooms[0].room.walls[0];

    const result = setPolygonWallLength(project, wall.id, 5000.4, "start");

    expect(getWallGeometry(result.project.floor.rooms[0].room, wall).lengthMm).toBeCloseTo(
      5000.4,
      8
    );
    expect(result.changedWallIds).toContain(wall.id);
  });

  it("does not mutate the source project", () => {
    const project = polygonProject(L_SHAPE);
    const wall = project.floor.rooms[0].room.walls[0];
    const originalVertices = structuredClone(project.floor.rooms[0].room.vertices);

    const result = setPolygonWallLength(project, wall.id, 4200, "start");

    expect(project.floor.rooms[0].room.vertices).toEqual(originalVertices);
    expect(result.project).not.toBe(project);
    expect(result.project.floor.rooms[0].room.vertices).not.toBe(
      project.floor.rooms[0].room.vertices
    );
  });
});
