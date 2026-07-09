import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "./createRoom";
import { getFreestandingFaces } from "./freestandingWalls";
import { getProjectPlaceableWalls, getRoomPlaceableWalls } from "./placeableWalls";
import { getWallsWithGeometry } from "./walls";
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
    freestandingWalls: [
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

describe("getRoomPlaceableWalls", () => {
  it("returns the 4 perimeter walls followed by the partition's 2 faces, in that order", () => {
    const { room } = roomWithPartition();

    const placeable = getRoomPlaceableWalls(room);
    const perimeter = getWallsWithGeometry(room);
    const faces = getFreestandingFaces(room);

    expect(placeable).toHaveLength(6);
    expect(perimeter).toHaveLength(4);
    expect(faces).toHaveLength(2);
    expect(placeable).toEqual([...perimeter, ...faces]);
    expect(placeable.slice(0, 4)).toEqual(perimeter);
    expect(placeable.slice(4)).toEqual(faces);
  });

  it("returns just the perimeter walls when a room has no partitions", () => {
    const placement = createRectangularRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      widthMm: 4000,
      depthMm: 3000,
      heightMm: 3000,
      offsetXMm: 0,
      offsetYMm: 0
    });

    const placeable = getRoomPlaceableWalls(placement.room);

    expect(placeable).toHaveLength(4);
    expect(placeable).toEqual(getWallsWithGeometry(placement.room));
  });
});

describe("getProjectPlaceableWalls", () => {
  it("flatMaps getRoomPlaceableWalls across every room on the floor", () => {
    const { project: projectA, room: roomA } = roomWithPartition();
    const placementB = createRectangularRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      widthMm: 2000,
      depthMm: 2000,
      heightMm: 3000,
      offsetXMm: 5000,
      offsetYMm: 0
    });

    const project: Project = {
      ...projectA,
      floor: { rooms: [...projectA.floor.rooms, placementB] }
    };

    const placeable = getProjectPlaceableWalls(project);

    expect(placeable).toEqual([
      ...getRoomPlaceableWalls(roomA),
      ...getRoomPlaceableWalls(placementB.room)
    ]);
    expect(placeable).toHaveLength(6 + 4);
  });
});
