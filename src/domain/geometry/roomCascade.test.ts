import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "./createRoom";
import { faceWallIdsOf } from "./freestandingWalls";
import { deleteRoomFromProject, getRoomCascadeScope } from "./roomCascade";
import type {
  FloorObject,
  FreestandingWall,
  Project,
  RoomPlacement,
  WallObject
} from "../project";

const PARTITION: FreestandingWall = {
  id: "room-1-partition-1",
  roomId: "room-1",
  name: "Partition 1",
  startXMm: 1000,
  startYMm: 2000,
  endXMm: 3000,
  endYMm: 2000,
  heightMm: 3000,
  thicknessMm: 100
};

const [FACE_A, FACE_B] = faceWallIdsOf(PARTITION.id);

function room(
  roomId: string,
  name: string,
  offsetXMm: number,
  partitions: FreestandingWall[] = []
): RoomPlacement {
  const base = createRectangularRoomPlacement({
    roomId,
    name,
    widthMm: 6000,
    depthMm: 4000,
    heightMm: 3000,
    offsetXMm,
    offsetYMm: 0
  });
  return { ...base, room: { ...base.room, freestandingWalls: partitions } };
}

function artwork(id: string, wallId: string): WallObject {
  return {
    id,
    kind: "artwork",
    artworkId: `art-${id}`,
    wallId,
    xMm: 1000,
    yMm: 1400,
    widthMm: 500,
    heightMm: 400
  };
}

function door(id: string, wallId: string, connectsToObjectId?: string): WallObject {
  return {
    id,
    kind: "door",
    blocksPlacement: true,
    wallId,
    xMm: 3000,
    yMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    ...(connectsToObjectId ? { connectsToObjectId } : {})
  };
}

function buildProject({
  wallObjects = [],
  floorObjects = []
}: {
  wallObjects?: WallObject[];
  floorObjects?: FloorObject[];
} = {}): Project {
  return {
    id: "p",
    schemaVersion: 3,
    title: "t",
    unit: "cm",
    defaultWallHeightMm: 3000,
    defaultCenterlineHeightMm: 1450,
    checklistArtworkIds: [],
    wallObjects,
    floorObjects,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    floor: { rooms: [room("room-1", "East Gallery", 0, [PARTITION]), room("room-2", "West Gallery", 8000)] }
  };
}

describe("getRoomCascadeScope", () => {
  it("collects perimeter wall ids, both partition face ids, and objects on either", () => {
    const project = buildProject({
      wallObjects: [
        artwork("a1", "room-1-wall-north"),
        door("d1", "room-1-wall-south"),
        artwork("a2", FACE_A),
        artwork("a3", FACE_B),
        artwork("other", "room-2-wall-north")
      ]
    });

    const scope = getRoomCascadeScope(project, "room-1");

    expect(scope.wallIds.has("room-1-wall-north")).toBe(true);
    expect(scope.wallIds.has("room-2-wall-north")).toBe(false);
    expect(scope.faceIds.has(FACE_A)).toBe(true);
    expect(scope.faceIds.has(FACE_B)).toBe(true);
    expect([...scope.cascadedWallObjectIds].sort()).toEqual(["a1", "a2", "a3", "d1"]);
  });

  it("returns empty sets for an unknown room", () => {
    const scope = getRoomCascadeScope(buildProject(), "no-such-room");
    expect(scope.wallIds.size).toBe(0);
    expect(scope.faceIds.size).toBe(0);
    expect(scope.cascadedWallObjectIds.size).toBe(0);
  });
});

describe("deleteRoomFromProject", () => {
  it("removes the room, drops its cascaded objects, and leaves other rooms/objects", () => {
    const floorObjects: FloorObject[] = [
      {
        id: "f1",
        kind: "artwork",
        artworkId: "art-f1",
        xMm: 2000,
        yMm: 2000,
        widthMm: 500,
        depthMm: 400,
        rotationDeg: 0,
        heightMm: 400,
        wallYMm: 1400
      }
    ];
    const project = buildProject({
      wallObjects: [
        artwork("a1", "room-1-wall-north"),
        artwork("faceObj", FACE_A),
        artwork("survivor", "room-2-wall-north")
      ],
      floorObjects
    });

    const { project: next, removedObjectIds } = deleteRoomFromProject(project, "room-1");

    expect(next.floor.rooms.map((placement) => placement.roomId)).toEqual(["room-2"]);
    expect(next.wallObjects.map((wallObject) => wallObject.id)).toEqual(["survivor"]);
    expect([...removedObjectIds].sort()).toEqual(["a1", "faceObj"]);
    // Floor objects are deliberately untouched by the cascade.
    expect(next.floorObjects).toBe(project.floorObjects);
  });

  it("clears a surviving opening's partner ref that pointed at a removed opening", () => {
    const project = buildProject({
      wallObjects: [
        door("removed", "room-1-wall-north", "survivor"),
        door("survivor", "room-2-wall-north", "removed")
      ]
    });

    const { project: next } = deleteRoomFromProject(project, "room-1");
    const survivor = next.wallObjects.find((wallObject) => wallObject.id === "survivor");

    expect(next.wallObjects).toHaveLength(1);
    expect(survivor && "connectsToObjectId" in survivor).toBe(false);
  });
});
