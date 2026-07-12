import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "./createRoom";
import {
  centerFreestandingWallBetweenWalls,
  createFreestandingWall,
  faceWallId,
  faceWallIdsOf,
  getFloorPartitions,
  getFreestandingFaces,
  getFreestandingLengthMm,
  moveFreestandingEndpoint,
  moveFreestandingWall,
  parseFaceWallId,
  roomIdContainingPoint,
  rotateFreestandingWall,
  setFreestandingLength,
  setFreestandingThickness
} from "./freestandingWalls";
import { getFloorWalls, findNearestWall } from "./planObjects";
import type { FreestandingWall, Project, Room } from "../project";

function roomWithPartition(partition?: Partial<FreestandingWall>): {
  project: Project;
  room: Room;
} {
  const placement = createRectangularRoomPlacement({
    roomId: "room-1",
    name: "Gallery 1",
    widthMm: 4000,
    depthMm: 3000,
    heightMm: 3000,
    offsetXMm: 0,
    offsetYMm: 0
  });
  const room: Room = {
    ...placement.room,
    freestandingWalls: partition
      ? [
          {
            id: "room-1-partition-1",
            roomId: "room-1",
            name: "Partition 1",
            startXMm: 1000,
            startYMm: 1500,
            endXMm: 3000,
            endYMm: 1500,
            heightMm: 3000,
            thicknessMm: 100,
            ...partition
          }
        ]
      : []
  };
  const project: Project = {
    id: "p",
    schemaVersion: 3,
    title: "t",
    unit: "m",
    defaultWallHeightMm: 3000,
    defaultCenterlineHeightMm: 1450,
    checklistArtworkIds: [],
    wallObjects: [],
    floorObjects: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    floor: { rooms: [{ ...placement, room }] }
  };
  return { project, room };
}

describe("faceWallId / parseFaceWallId", () => {
  it("round-trips", () => {
    expect(faceWallId("room-1-partition-1", "a")).toBe("room-1-partition-1#a");
    expect(parseFaceWallId("room-1-partition-1#a")).toEqual({
      freestandingWallId: "room-1-partition-1",
      face: "a"
    });
    expect(parseFaceWallId("room-1-partition-1#b")?.face).toBe("b");
  });

  it("returns null for a perimeter wall id (no '#')", () => {
    expect(parseFaceWallId("room-1-wall-north")).toBeNull();
  });

  it("faceWallIdsOf returns both faces in a/b order", () => {
    expect(faceWallIdsOf("x")).toEqual(["x#a", "x#b"]);
  });
});

describe("getFreestandingFaces", () => {
  it("offsets each face ±thickness/2 along the outward normal", () => {
    const { room } = roomWithPartition({});
    const [faceA, faceB] = getFreestandingFaces(room);

    // Horizontal partition start→end; left normal is +y. Face A offset +y50.
    expect(faceA.face).toBe("a");
    expect(faceA.id).toBe("room-1-partition-1#a");
    expect(faceA.start.xMm).toBeCloseTo(1000);
    expect(faceA.start.yMm).toBeCloseTo(1550);
    expect(faceA.end.xMm).toBeCloseTo(3000);
    expect(faceA.end.yMm).toBeCloseTo(1550);

    // Face B offset -y50 AND runs end→start (endpoints swapped).
    expect(faceB.face).toBe("b");
    expect(faceB.start.xMm).toBeCloseTo(3000);
    expect(faceB.start.yMm).toBeCloseTo(1450);
    expect(faceB.end.xMm).toBeCloseTo(1000);
    expect(faceB.end.yMm).toBeCloseTo(1450);

    // Both faces have the same length as the centerline.
    expect(faceA.lengthMm).toBeCloseTo(2000);
    expect(faceB.lengthMm).toBeCloseTo(2000);
  });

  it("names faces '<partition> — side A/B'", () => {
    const { room } = roomWithPartition({});
    const [faceA, faceB] = getFreestandingFaces(room);
    expect(faceA.name).toBe("Partition 1 — side A");
    expect(faceB.name).toBe("Partition 1 — side B");
  });

  it("face B's panel-local x mirrors face A's (measured from the physical end)", () => {
    const { project } = roomWithPartition({});
    const floorWalls = getFloorWalls(project.floor);
    const faceA = floorWalls.find((w) => w.id === "room-1-partition-1#a")!;
    const faceB = floorWalls.find((w) => w.id === "room-1-partition-1#b")!;

    // A physical point 500 mm along the centerline from the start.
    const pointFloorMm = { xMm: 1500, yMm: 1500 };
    const nearestFace = findNearestWall(pointFloorMm, [faceA, faceB], 100);
    // Both faces are 50 mm off the centerline, so distance ties; either wins,
    // but the mirror relationship holds regardless of which.
    expect(nearestFace).not.toBeNull();

    const projectOntoA = getFloorWalls(project.floor)
      .filter((w) => w.id === "room-1-partition-1#a")
      .map((w) => findNearestWall(pointFloorMm, [w], 1000)!.xAlongMm)[0];
    const projectOntoB = getFloorWalls(project.floor)
      .filter((w) => w.id === "room-1-partition-1#b")
      .map((w) => findNearestWall(pointFloorMm, [w], 1000)!.xAlongMm)[0];

    expect(projectOntoA).toBeCloseTo(500);
    // Mirror: xB = length - xA.
    expect(projectOntoA + projectOntoB).toBeCloseTo(2000);
  });
});

describe("getFloorPartitions", () => {
  it("lifts each room's partitions into floor space by its placement offset, preserving ids", () => {
    const placementA = createRectangularRoomPlacement({
      roomId: "room-a",
      name: "Room A",
      widthMm: 4000,
      depthMm: 3000,
      heightMm: 3000,
      offsetXMm: 1000,
      offsetYMm: 500
    });
    const roomA: Room = {
      ...placementA.room,
      freestandingWalls: [
        {
          id: "room-a-partition-1",
          roomId: "room-a",
          name: "Partition A1",
          startXMm: 100,
          startYMm: 200,
          endXMm: 900,
          endYMm: 200,
          heightMm: 3000,
          thicknessMm: 100
        }
      ]
    };

    const placementB = createRectangularRoomPlacement({
      roomId: "room-b",
      name: "Room B",
      widthMm: 4000,
      depthMm: 3000,
      heightMm: 3000,
      offsetXMm: -2000,
      offsetYMm: 4000
    });
    const roomB: Room = {
      ...placementB.room,
      freestandingWalls: [
        {
          id: "room-b-partition-1",
          roomId: "room-b",
          name: "Partition B1",
          startXMm: 300,
          startYMm: 300,
          endXMm: 300,
          endYMm: 1300,
          heightMm: 3000,
          thicknessMm: 120
        }
      ]
    };

    const project: Project = {
      id: "p",
      schemaVersion: 3,
      title: "t",
      unit: "m",
      defaultWallHeightMm: 3000,
      defaultCenterlineHeightMm: 1450,
      checklistArtworkIds: [],
      wallObjects: [],
      floorObjects: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      floor: {
        rooms: [
          { ...placementA, room: roomA },
          { ...placementB, room: roomB }
        ]
      }
    };

    const partitions = getFloorPartitions(project);
    expect(partitions).toHaveLength(2);

    const partitionA = partitions.find((p) => p.wallId === "room-a-partition-1")!;
    expect(partitionA.roomId).toBe("room-a");
    expect(partitionA.startMm).toEqual({ xMm: 1100, yMm: 700 });
    expect(partitionA.endMm).toEqual({ xMm: 1900, yMm: 700 });
    expect(partitionA.thicknessMm).toBe(100);
    expect(partitionA.name).toBe("Partition A1");

    const partitionB = partitions.find((p) => p.wallId === "room-b-partition-1")!;
    expect(partitionB.roomId).toBe("room-b");
    expect(partitionB.startMm).toEqual({ xMm: -1700, yMm: 4300 });
    expect(partitionB.endMm).toEqual({ xMm: -1700, yMm: 5300 });
    expect(partitionB.thicknessMm).toBe(120);
  });
});

describe("operations", () => {
  it("createFreestandingWall assigns the room by segment midpoint and stores room-local endpoints", () => {
    const { project } = roomWithPartition();
    const result = createFreestandingWall(
      project,
      "room-1",
      { xMm: 1000, yMm: 1000 },
      { xMm: 2000, yMm: 1000 }
    );
    const partition = result.project.floor.rooms[0].room.freestandingWalls[0];
    expect(partition.id).toBe("room-1-partition-1");
    expect(partition.thicknessMm).toBe(100);
    expect(partition.heightMm).toBe(3000);
    expect(partition.startXMm).toBe(1000);
    expect(getFreestandingLengthMm(partition)).toBeCloseTo(1000);
  });

  it("roomIdContainingPoint finds the room whose polygon contains the point", () => {
    const { project } = roomWithPartition();
    expect(roomIdContainingPoint(project, { xMm: 2000, yMm: 1500 })).toBe("room-1");
    expect(roomIdContainingPoint(project, { xMm: 9000, yMm: 9000 })).toBeNull();
  });

  it("moveFreestandingWall translates both endpoints and reports both face ids", () => {
    const { project } = roomWithPartition({});
    const result = moveFreestandingWall(project, "room-1-partition-1", { xMm: 100, yMm: 200 });
    const partition = result.project.floor.rooms[0].room.freestandingWalls[0];
    expect(partition.startXMm).toBe(1100);
    expect(partition.startYMm).toBe(1700);
    expect(partition.endXMm).toBe(3100);
    expect(result.changedWallIds).toEqual(["room-1-partition-1#a", "room-1-partition-1#b"]);
  });

  it("moveFreestandingEndpoint moves one endpoint (floor→room-local)", () => {
    const { project } = roomWithPartition({});
    const result = moveFreestandingEndpoint(project, "room-1-partition-1", "end", {
      xMm: 3000,
      yMm: 2500
    });
    const partition = result.project.floor.rooms[0].room.freestandingWalls[0];
    expect(partition.endYMm).toBe(2500);
    expect(partition.startYMm).toBe(1500);
  });

  it("rotateFreestandingWall rotates about the midpoint to an absolute angle", () => {
    const { project } = roomWithPartition({});
    const result = rotateFreestandingWall(project, "room-1-partition-1", 90);
    const partition = result.project.floor.rooms[0].room.freestandingWalls[0];
    // Midpoint (2000, 1500), half-length 1000 → vertical segment.
    expect(partition.startXMm).toBeCloseTo(2000);
    expect(partition.startYMm).toBeCloseTo(500);
    expect(partition.endXMm).toBeCloseTo(2000);
    expect(partition.endYMm).toBeCloseTo(2500);
  });

  it("setFreestandingLength honors the anchor", () => {
    const { project } = roomWithPartition({});
    const fromStart = setFreestandingLength(project, "room-1-partition-1", 1000, "start");
    const p1 = fromStart.project.floor.rooms[0].room.freestandingWalls[0];
    expect(p1.startXMm).toBe(1000); // start pinned
    expect(p1.endXMm).toBeCloseTo(2000);

    const fromEnd = setFreestandingLength(project, "room-1-partition-1", 1000, "end");
    const p2 = fromEnd.project.floor.rooms[0].room.freestandingWalls[0];
    expect(p2.endXMm).toBe(3000); // end pinned
    expect(p2.startXMm).toBeCloseTo(2000);
  });

  it("setFreestandingThickness widens both faces symmetrically", () => {
    const { project } = roomWithPartition({});
    const result = setFreestandingThickness(project, "room-1-partition-1", 300);
    const room = result.project.floor.rooms[0].room;
    const [faceA, faceB] = getFreestandingFaces(room);
    expect(faceA.start.yMm).toBeCloseTo(1650); // +150
    expect(faceB.start.yMm).toBeCloseTo(1350); // -150
  });
});

describe("centerFreestandingWallBetweenWalls", () => {
  function findPartition(project: Project, wallId: string): FreestandingWall {
    const wall = project.floor.rooms
      .flatMap((placement) => placement.room.freestandingWalls)
      .find((candidate) => candidate.id === wallId);
    if (!wall) throw new Error("partition missing");
    return wall;
  }

  it("centers across the normal (equal gap to the walls it faces)", () => {
    // 4000x3000 room; partition horizontal at y=1000 → 2000 below, 1000 above.
    const { project } = roomWithPartition({ startYMm: 1000, endYMm: 1000 });
    const result = centerFreestandingWallBetweenWalls(
      project,
      "room-1-partition-1",
      "normal"
    );
    const moved = findPartition(result.project, "room-1-partition-1");
    expect(moved.startYMm).toBeCloseTo(1500, 6); // room center of a 3000-deep room
    expect(moved.endYMm).toBeCloseTo(1500, 6);
    expect(moved.startXMm).toBeCloseTo(1000, 6); // x untouched by a normal center
    expect(result.changedWallIds).toEqual(["room-1-partition-1#a", "room-1-partition-1#b"]);
  });

  it("centers along the span (equal gap to the end walls)", () => {
    // 4000-wide room; centerline x 500..1500. End cap gaps: east cap 2500 to
    // the east wall, west cap 500 to the west wall → shift +1000 to equalize.
    const { project } = roomWithPartition({ startXMm: 500, endXMm: 1500 });
    const result = centerFreestandingWallBetweenWalls(project, "room-1-partition-1", "axis");
    const moved = findPartition(result.project, "room-1-partition-1");
    expect(moved.startXMm).toBeCloseTo(1500, 6);
    expect(moved.endXMm).toBeCloseTo(2500, 6);
    expect(getFreestandingLengthMm(moved)).toBeCloseTo(1000, 6); // length preserved
  });

  it("counts a neighboring partition as a boundary (normal)", () => {
    // Subject horizontal at y=1000; a sibling partition at y=500 bounds the −y
    // side while the south wall (y=3000) bounds the +y side. Centering
    // equalizes the two FACE gaps: +y face → wall 3000, −y face → sibling near
    // face 550, solving to a midpoint of y=1775 (face gaps 1175 each).
    const { project } = roomWithPartition({ startYMm: 1000, endYMm: 1000 });
    const base = project.floor.rooms[0];
    const withSibling: Project = {
      ...project,
      floor: {
        rooms: [
          {
            ...base,
            room: {
              ...base.room,
              freestandingWalls: [
                ...base.room.freestandingWalls,
                {
                  id: "room-1-partition-2",
                  roomId: "room-1",
                  name: "Partition 2",
                  startXMm: 1000,
                  startYMm: 500,
                  endXMm: 3000,
                  endYMm: 500,
                  heightMm: 3000,
                  thicknessMm: 100
                }
              ]
            }
          }
        ]
      }
    };
    const result = centerFreestandingWallBetweenWalls(
      withSibling,
      "room-1-partition-1",
      "normal"
    );
    const moved = findPartition(result.project, "room-1-partition-1");
    expect(moved.startYMm).toBeCloseTo(1775, 6);
    expect(moved.endYMm).toBeCloseTo(1775, 6);
  });

  it("throws when a ray misses (nothing on both sides)", () => {
    // Midpoint outside the room polygon → both normal rays escape.
    const { project } = roomWithPartition({
      startXMm: 4500,
      startYMm: 1500,
      endXMm: 5500,
      endYMm: 1500
    });
    expect(() =>
      centerFreestandingWallBetweenWalls(project, "room-1-partition-1", "normal")
    ).toThrow("Nothing on both sides to center between.");
  });
});
