import { describe, expect, it } from "vitest";
import type { Project, Room, RoomPlacement } from "../project";
import { changedWallLengthIdsForProject, findVertex } from "./wallLoop";

function room(lengthMm: number): Room {
  return {
    id: "room-1",
    name: "Room",
    heightMm: 3000,
    freestandingWalls: [],
    vertices: [
      { id: "v-a", xMm: 0, yMm: 0 },
      { id: "v-b", xMm: lengthMm, yMm: 0 }
    ],
    walls: [
      {
        id: "wall-1",
        roomId: "room-1",
        name: "Wall 1",
        startVertexId: "v-a",
        endVertexId: "v-b",
        heightMm: 3000
      }
    ]
  };
}

function placement(theRoom: Room): RoomPlacement {
  return {
    roomId: theRoom.id,
    offsetXMm: 0,
    offsetYMm: 0,
    rotationDeg: 0,
    room: theRoom
  };
}

function wrapInProject(placements: RoomPlacement[]): Project {
  return {
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
    floor: { rooms: placements }
  };
}

describe("findVertex", () => {
  it("returns the vertex when it exists on the room", () => {
    const theRoom = room(1000);
    expect(findVertex(theRoom, "v-a")).toEqual({ id: "v-a", xMm: 0, yMm: 0 });
  });

  it("throws when the vertex id isn't on the room", () => {
    const theRoom = room(1000);
    expect(() => findVertex(theRoom, "no-such-vertex")).toThrow();
  });
});

describe("changedWallLengthIdsForProject", () => {
  it("reports a wall whose length changed", () => {
    const previous = wrapInProject([placement(room(1000))]);
    const next = wrapInProject([placement(room(1500))]);

    expect(changedWallLengthIdsForProject(previous, next)).toEqual(["wall-1"]);
  });

  it("reports nothing for an unchanged wall", () => {
    const previous = wrapInProject([placement(room(1000))]);
    const next = wrapInProject([placement(room(1000))]);

    expect(changedWallLengthIdsForProject(previous, next)).toEqual([]);
  });

  it("counts a wall that exists only in `next` as changed", () => {
    const emptyRoom: Room = { ...room(1000), walls: [] };
    const previous = wrapInProject([placement(emptyRoom)]);
    const next = wrapInProject([placement(room(1000))]);

    expect(changedWallLengthIdsForProject(previous, next)).toEqual(["wall-1"]);
  });

  it("ignores a length delta exactly at the 0.5mm epsilon", () => {
    const previous = wrapInProject([placement(room(1000))]);
    const next = wrapInProject([placement(room(1000.5))]);

    expect(changedWallLengthIdsForProject(previous, next)).toEqual([]);
  });

  it("reports a length delta just past the 0.5mm epsilon", () => {
    const previous = wrapInProject([placement(room(1000))]);
    const next = wrapInProject([placement(room(1000.51))]);

    expect(changedWallLengthIdsForProject(previous, next)).toEqual(["wall-1"]);
  });
});
