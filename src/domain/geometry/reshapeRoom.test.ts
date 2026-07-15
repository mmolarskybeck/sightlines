import { describe, expect, it } from "vitest";
import { parseProject } from "../schema/projectSchema";
import { createSampleProject } from "../sample/sampleProject";
import { createBlankProject } from "../newProject";
import { feetToMm } from "../units/length";
import type { Project, RoomPlacement, RoomVertex, Wall } from "../project";
import { createPolygonRoomPlacement } from "./createRoom";
import { getWallsWithGeometry, type WallWithGeometry } from "./walls";
import {
  canMoveRoomVertex,
  deleteRoomVertex,
  moveRoomVertex,
  moveRoomWall,
  splitWall
} from "./reshapeRoom";

// Clockwise L-shape; construction normalizes it to CCW room-local geometry.
const L_SHAPE = [
  { xMm: 1000, yMm: 1000 },
  { xMm: 1000, yMm: 4000 },
  { xMm: 3000, yMm: 4000 },
  { xMm: 3000, yMm: 2000 },
  { xMm: 5000, yMm: 2000 },
  { xMm: 5000, yMm: 1000 }
];

function polygonRoomProject(): Project {
  const base = createBlankProject("Polygon test");
  const placement = createPolygonRoomPlacement({
    roomId: "room-l",
    name: "Gallery L",
    heightMm: feetToMm(12),
    pointsFloorMm: L_SHAPE
  });
  return { ...base, floor: { rooms: [placement] } };
}

describe("moveRoomVertex", () => {
  it("turns a rectangle into a non-rectangular quadrilateral and revalidates", () => {
    const project = createSampleProject();

    const result = moveRoomVertex(project, "room-main", "v-ne", {
      xMm: feetToMm(10),
      yMm: feetToMm(4)
    });

    expect(result.changedWallIds.sort()).toEqual(["wall-east", "wall-north"].sort());
    expect(result.anchorVertexId).toBe("v-ne");
    // A skewed quad must stop qualifying as a rectangle.
    const walls = getWallsWithGeometry(result.project.floor.rooms[0].room);
    expect(walls.find((wall) => wall.id === "wall-north")?.lengthMm).toBeCloseTo(
      Math.hypot(feetToMm(10), feetToMm(4))
    );
    expect(() => parseProject(result.project)).not.toThrow();

    expect(
      project.floor.rooms[0].room.vertices.find((vertex) => vertex.id === "v-ne")
    ).toMatchObject({ xMm: feetToMm(28), yMm: 0 });
  });

  it("never touches wall objects — overhang is left for the store's bounds warning", () => {
    const project = createSampleProject();
    const withObject: Project = {
      ...project,
      wallObjects: [
        {
          id: "art-1",
          wallId: "wall-north",
          kind: "artwork",
          artworkId: "artwork-1",
          xMm: feetToMm(15),
          yMm: feetToMm(5),
          widthMm: 600,
          heightMm: 800
        }
      ]
    };

    const result = moveRoomVertex(withObject, "room-main", "v-ne", {
      xMm: feetToMm(10),
      yMm: 0
    });

    const artwork = result.project.wallObjects[0];
    expect(artwork.xMm).toBe(feetToMm(15));
    expect(artwork.wallId).toBe("wall-north");
  });

  it("rejects a move that would make the room self-intersect", () => {
    const project = createSampleProject();

    expect(() =>
      moveRoomVertex(project, "room-main", "v-ne", {
        xMm: feetToMm(10),
        yMm: feetToMm(28)
      })
    ).toThrow();
  });

  it("rejects a move landing within 10mm of a neighbouring vertex", () => {
    const project = createSampleProject();
    const neighbor = project.floor.rooms[0].room.vertices.find((v) => v.id === "v-nw")!;

    expect(() =>
      moveRoomVertex(project, "room-main", "v-ne", { xMm: neighbor.xMm + 5, yMm: neighbor.yMm })
    ).toThrow();
  });

  it("throws for an unknown room or vertex", () => {
    const project = createSampleProject();
    expect(() => moveRoomVertex(project, "no-such-room", "v-ne", { xMm: 0, yMm: 0 })).toThrow();
    expect(() =>
      moveRoomVertex(project, "room-main", "no-such-vertex", { xMm: 0, yMm: 0 })
    ).toThrow();
  });
});

describe("reference measurements through wall splits", () => {
  it("rehomes one-sided references and deletes cross-split references", () => {
    const project = createSampleProject();
    project.referenceMeasurements = [
      { id: "left", kind: "elevation", wallId: "wall-north", visible: true, locked: false, start: { xMm: 100, yMm: 100 }, end: { xMm: 200, yMm: 100 } },
      { id: "right", kind: "elevation", wallId: "wall-north", visible: true, locked: false, start: { xMm: 700, yMm: 100 }, end: { xMm: 900, yMm: 100 } },
      { id: "cross", kind: "elevation", wallId: "wall-north", visible: true, locked: false, start: { xMm: 200, yMm: 100 }, end: { xMm: 800, yMm: 100 } }
    ];
    const result = splitWall(project, "wall-north", 500);
    expect(result.project.referenceMeasurements?.map((item) => item.id)).toEqual(["left", "right"]);
    expect(result.project.referenceMeasurements?.find((item) => item.id === "right")).toMatchObject({
      wallId: result.newWallId,
      start: { xMm: 200 },
      end: { xMm: 400 }
    });
  });
});

describe("canMoveRoomVertex", () => {
  it("mirrors moveRoomVertex's accept/reject decision", () => {
    const room = createSampleProject().floor.rooms[0].room;
    expect(canMoveRoomVertex(room, "v-ne", { xMm: feetToMm(10), yMm: feetToMm(4) })).toBe(true);
    expect(canMoveRoomVertex(room, "v-ne", { xMm: feetToMm(10), yMm: feetToMm(28) })).toBe(false);
  });
});

function directionOf(wall: WallWithGeometry): { xMm: number; yMm: number } {
  const dx = wall.end.xMm - wall.start.xMm;
  const dy = wall.end.yMm - wall.start.yMm;
  const len = Math.hypot(dx, dy);
  return { xMm: dx / len, yMm: dy / len };
}

// Asymmetric trapezoid with distinct wall lengths.
function trapezoidRoomProject(): Project {
  const base = createBlankProject("Trapezoid test");
  const placement = createPolygonRoomPlacement({
    roomId: "room-trap",
    name: "Trapezoid Room",
    heightMm: feetToMm(12),
    pointsFloorMm: [
      { xMm: 0, yMm: 0 },
      { xMm: 4000, yMm: 0 },
      { xMm: 3500, yMm: 2000 },
      { xMm: 500, yMm: 2500 }
    ]
  });
  return { ...base, floor: { rooms: [placement] } };
}

// Hand-built because the constructor removes this straight-through vertex.
function collinearNeighbourProject(): Project {
  const base = createBlankProject("Collinear neighbour test");
  const roomId = "room-col";
  const heightMm = feetToMm(10);
  const vertices: RoomVertex[] = [
    { id: "v0", xMm: 0, yMm: 0 },
    { id: "v1", xMm: 2000, yMm: 0 },
    { id: "v2", xMm: 4000, yMm: 0 },
    { id: "v3", xMm: 4000, yMm: 2000 },
    { id: "v4", xMm: 0, yMm: 2000 }
  ];
  const walls: Wall[] = [
    { id: "wall0", roomId, name: "Wall 1", startVertexId: "v0", endVertexId: "v1", heightMm },
    { id: "wall1", roomId, name: "Wall 2", startVertexId: "v1", endVertexId: "v2", heightMm },
    { id: "wall2", roomId, name: "Wall 3", startVertexId: "v2", endVertexId: "v3", heightMm },
    { id: "wall3", roomId, name: "Wall 4", startVertexId: "v3", endVertexId: "v4", heightMm },
    { id: "wall4", roomId, name: "Wall 5", startVertexId: "v4", endVertexId: "v0", heightMm }
  ];
  const placement: RoomPlacement = {
    roomId,
    offsetXMm: 0,
    offsetYMm: 0,
    rotationDeg: 0,
    room: { id: roomId, name: "Collinear room", heightMm, freestandingWalls: [], vertices, walls }
  };
  return { ...base, floor: { rooms: [placement] } };
}

describe("moveRoomWall", () => {
  it("slides an orthogonal wall along its perpendicular — only its two neighbours change length, everything else is untouched", () => {
    const project = createSampleProject();
    const before = project.floor.rooms[0].room;
    const originalSw = before.vertices.find((vertex) => vertex.id === "v-sw")!;
    const originalSe = before.vertices.find((vertex) => vertex.id === "v-se")!;

    const result = moveRoomWall(project, "room-main", "wall-north", 1000);

    expect(result.changedWallIds.sort()).toEqual(["wall-east", "wall-north", "wall-west"].sort());
    expect(result.anchorVertexId).toBe("v-nw");

    const room = result.project.floor.rooms[0].room;
    const walls = getWallsWithGeometry(room);
    expect(walls.find((wall) => wall.id === "wall-north")!.lengthMm).toBeCloseTo(feetToMm(28));
    expect(walls.find((wall) => wall.id === "wall-west")!.lengthMm).toBeCloseTo(feetToMm(18) - 1000);
    expect(walls.find((wall) => wall.id === "wall-east")!.lengthMm).toBeCloseTo(feetToMm(18) - 1000);

    expect(room.vertices.find((vertex) => vertex.id === "v-sw")).toEqual(originalSw);
    expect(room.vertices.find((vertex) => vertex.id === "v-se")).toEqual(originalSe);

    const nw = room.vertices.find((vertex) => vertex.id === "v-nw")!;
    const ne = room.vertices.find((vertex) => vertex.id === "v-ne")!;
    expect(nw.yMm).toBeCloseTo(1000);
    expect(ne.yMm).toBeCloseTo(1000);
    expect(() => parseProject(result.project)).not.toThrow();
  });

  it("keeps a slanted neighbour on its original line (direction unchanged, length changes) and changes the dragged wall's own length too", () => {
    const project = trapezoidRoomProject();
    const walls = getWallsWithGeometry(project.floor.rooms[0].room);
    const dragged = walls.find((wall) => Math.abs(wall.lengthMm - 4000) < 1)!;
    const idx = walls.findIndex((wall) => wall.id === dragged.id);
    const n = walls.length;
    const previous = walls[(idx - 1 + n) % n];
    const next = walls[(idx + 1) % n];
    const previousDirBefore = directionOf(previous);
    const nextDirBefore = directionOf(next);

    const result = moveRoomWall(project, "room-trap", dragged.id, 300);

    const afterWalls = getWallsWithGeometry(result.project.floor.rooms[0].room);
    const previousAfter = afterWalls.find((wall) => wall.id === previous.id)!;
    const nextAfter = afterWalls.find((wall) => wall.id === next.id)!;
    const draggedAfter = afterWalls.find((wall) => wall.id === dragged.id)!;

    const previousDirAfter = directionOf(previousAfter);
    expect(previousDirAfter.xMm).toBeCloseTo(previousDirBefore.xMm, 5);
    expect(previousDirAfter.yMm).toBeCloseTo(previousDirBefore.yMm, 5);
    expect(Math.abs(previousAfter.lengthMm - previous.lengthMm)).toBeGreaterThan(1);

    const nextDirAfter = directionOf(nextAfter);
    expect(nextDirAfter.xMm).toBeCloseTo(nextDirBefore.xMm, 5);
    expect(nextDirAfter.yMm).toBeCloseTo(nextDirBefore.yMm, 5);
    expect(Math.abs(nextAfter.lengthMm - next.lengthMm)).toBeGreaterThan(1);

    expect(Math.abs(draggedAfter.lengthMm - dragged.lengthMm)).toBeGreaterThan(1);
    expect(() => parseProject(result.project)).not.toThrow();
  });

  it("rejects a drag whose adjacent wall runs parallel to it", () => {
    const project = collinearNeighbourProject();
    expect(() => moveRoomWall(project, "room-col", "wall1", 500)).toThrow();
  });

  it("rejects an offset that makes the re-intersected loop self-crossing", () => {
    const project = polygonRoomProject();
    const room = project.floor.rooms[0].room;
    const wallId = room.walls[1].id; // v1->v2, the L's inner horizontal leg

    expect(() => moveRoomWall(project, "room-l", wallId, 2000)).toThrow();
  });

  it("never touches wall objects — an overhanging object is left for the store's bounds warning", () => {
    const project = createSampleProject();
    const withObject: Project = {
      ...project,
      wallObjects: [
        {
          id: "art-1",
          wallId: "wall-east",
          kind: "artwork",
          artworkId: "artwork-1",
          xMm: 5400,
          yMm: feetToMm(5),
          widthMm: 600,
          heightMm: 800
        }
      ]
    };

    const result = moveRoomWall(withObject, "room-main", "wall-north", 1000);

    const artwork = result.project.wallObjects[0];
    expect(artwork.xMm).toBe(5400);
    expect(artwork.wallId).toBe("wall-east");
  });

  it("throws for an unknown room or wall", () => {
    const project = createSampleProject();
    expect(() => moveRoomWall(project, "no-such-room", "wall-north", 500)).toThrow();
    expect(() => moveRoomWall(project, "room-main", "no-such-wall", 500)).toThrow();
  });
});

describe("splitWall", () => {
  it("keeps the original wall's id/context on the first segment and gives the second a fresh id", () => {
    const project = createSampleProject();
    const wallLengthMm = getWallsWithGeometry(project.floor.rooms[0].room).find(
      (wall) => wall.id === "wall-north"
    )!.lengthMm;

    const result = splitWall(project, "wall-north", 3000);

    const room = result.project.floor.rooms[0].room;
    const first = room.walls.find((wall) => wall.id === "wall-north")!;
    const second = room.walls.find((wall) => wall.id === result.newWallId)!;
    expect(first.startVertexId).toBe("v-nw");
    expect(second.endVertexId).toBe("v-ne");
    expect(first.endVertexId).toBe(second.startVertexId);
    expect(result.changedWallIds.sort()).toEqual(["wall-north", result.newWallId].sort());

    const walls = getWallsWithGeometry(room);
    const firstGeom = walls.find((wall) => wall.id === "wall-north")!;
    const secondGeom = walls.find((wall) => wall.id === result.newWallId)!;
    expect(firstGeom.lengthMm).toBeCloseTo(3000);
    expect(secondGeom.lengthMm).toBeCloseTo(wallLengthMm - 3000);
    expect(() => parseProject(result.project)).not.toThrow();
  });

  it("reassigns objects past the split point to the new wall with xMm shifted", () => {
    const project = createSampleProject();
    const withObjects: Project = {
      ...project,
      wallObjects: [
        {
          id: "before",
          wallId: "wall-north",
          kind: "artwork",
          artworkId: "artwork-1",
          xMm: 1000,
          yMm: feetToMm(5),
          widthMm: 600,
          heightMm: 800
        },
        {
          id: "after",
          wallId: "wall-north",
          kind: "artwork",
          artworkId: "artwork-2",
          xMm: 5000,
          yMm: feetToMm(5),
          widthMm: 600,
          heightMm: 800
        }
      ]
    };

    const result = splitWall(withObjects, "wall-north", 3000);

    const before = result.project.wallObjects.find((object) => object.id === "before")!;
    const after = result.project.wallObjects.find((object) => object.id === "after")!;
    expect(before.wallId).toBe("wall-north");
    expect(before.xMm).toBe(1000);
    expect(after.wallId).toBe(result.newWallId);
    expect(after.xMm).toBe(2000);
  });

  it("rejects a split too close to either end of the wall", () => {
    const project = createSampleProject();
    expect(() => splitWall(project, "wall-north", 5)).toThrow();

    const lengthMm = getWallsWithGeometry(project.floor.rooms[0].room).find(
      (wall) => wall.id === "wall-north"
    )!.lengthMm;
    expect(() => splitWall(project, "wall-north", lengthMm - 5)).toThrow();
  });

  it("splits a wall on a polygon room and the result round-trips parseProject", () => {
    const project = polygonRoomProject();
    const wallId = project.floor.rooms[0].room.walls[4].id;

    const result = splitWall(project, wallId, 1500);

    expect(result.project.floor.rooms[0].room.vertices).toHaveLength(7);
    expect(result.project.floor.rooms[0].room.walls).toHaveLength(7);
    expect(() => parseProject(result.project)).not.toThrow();
  });

  it("throws for an unknown wall", () => {
    const project = createSampleProject();
    expect(() => splitWall(project, "no-such-wall", 1000)).toThrow();
  });
});

describe("deleteRoomVertex", () => {
  it("merges the two adjoining walls, keeping the entering wall's id", () => {
    const project = polygonRoomProject();
    const room = project.floor.rooms[0].room;
    const vertexId = room.vertices[1].id;
    const enteringWallId = room.walls[0].id;
    const exitingWallId = room.walls[1].id;

    const result = deleteRoomVertex(project, "room-l", vertexId);

    const nextRoom = result.project.floor.rooms[0].room;
    expect(nextRoom.vertices).toHaveLength(5);
    expect(nextRoom.vertices.some((vertex) => vertex.id === vertexId)).toBe(false);
    expect(nextRoom.walls.some((wall) => wall.id === exitingWallId)).toBe(false);
    const merged = nextRoom.walls.find((wall) => wall.id === enteringWallId)!;
    expect(merged.startVertexId).toBe(room.walls[0].startVertexId);
    expect(merged.endVertexId).toBe(room.walls[1].endVertexId);
    expect(() => parseProject(result.project)).not.toThrow();
  });

  it("reprojects objects from both merged walls by floor-space center", () => {
    const project = polygonRoomProject();
    const room = project.floor.rooms[0].room;
    const vertexId = room.vertices[1].id;
    const enteringWallId = room.walls[0].id; // length 1000mm, ends at the shared vertex
    const exitingWallId = room.walls[1].id; // length 2000mm, starts at the shared vertex

    const withObjects: Project = {
      ...project,
      wallObjects: [
        {
          id: "on-entering",
          wallId: enteringWallId,
          kind: "artwork",
          artworkId: "artwork-1",
          xMm: 900, // near the shared vertex (wall is only 1000mm long)
          yMm: feetToMm(5),
          widthMm: 600,
          heightMm: 800
        },
        {
          id: "on-exiting",
          wallId: exitingWallId,
          kind: "artwork",
          artworkId: "artwork-2",
          xMm: 100, // near the shared vertex
          yMm: feetToMm(5),
          widthMm: 600,
          heightMm: 800
        }
      ]
    };

    const result = deleteRoomVertex(withObjects, "room-l", vertexId);

    const onEntering = result.project.wallObjects.find((object) => object.id === "on-entering")!;
    const onExiting = result.project.wallObjects.find((object) => object.id === "on-exiting")!;
    expect(onEntering.wallId).toBe(enteringWallId);
    expect(onExiting.wallId).toBe(enteringWallId);
    // Objects on both old walls project independently onto the merged diagonal.
    const mergedLengthMm = Math.hypot(2000, 1000);
    expect(onEntering.xMm).toBeGreaterThan(0);
    expect(onEntering.xMm).toBeLessThan(mergedLengthMm);
    expect(onExiting.xMm).toBeGreaterThan(0);
    expect(onExiting.xMm).toBeLessThan(mergedLengthMm);
    expect(Math.abs(onEntering.xMm - onExiting.xMm)).toBeLessThan(200);
  });

  it("rejects deleting a vertex that would leave fewer than three corners", () => {
    const project = createSampleProject();
    const room = project.floor.rooms[0].room;
    project.floor.rooms[0].room = {
      ...room,
      vertices: room.vertices.filter((vertex) => vertex.id !== "v-sw"),
      walls: [room.walls[0], room.walls[1], { ...room.walls[2], endVertexId: "v-nw" }]
    };

    expect(() => deleteRoomVertex(project, "room-main", "v-ne")).toThrow();
  });

  it("rejects a merge that would self-intersect", () => {
    // Bridging over vertex 4 in this simple hexagon crosses the opposite edge.
    const base = createBlankProject("Reflex hexagon");
    const placement = createPolygonRoomPlacement({
      roomId: "room-z",
      name: "Gallery Z",
      heightMm: feetToMm(12),
      pointsFloorMm: [
        { xMm: 14000, yMm: 2000 },
        { xMm: 11000, yMm: 6000 },
        { xMm: 9000, yMm: 10000 },
        { xMm: 12000, yMm: 10000 },
        { xMm: 3000, yMm: 14000 },
        { xMm: 9000, yMm: 7000 }
      ]
    });
    const project: Project = { ...base, floor: { rooms: [placement] } };
    const room = project.floor.rooms[0].room;
    const reflexVertex = room.vertices[4];

    expect(() => deleteRoomVertex(project, "room-z", reflexVertex.id)).toThrow();
  });

  it("throws for an unknown room or vertex", () => {
    const project = createSampleProject();
    expect(() => deleteRoomVertex(project, "no-such-room", "v-ne")).toThrow();
    expect(() =>
      deleteRoomVertex(project, "room-main", "no-such-vertex")
    ).toThrow();
  });
});
