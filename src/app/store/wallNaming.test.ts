import { beforeEach, describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../../domain/geometry/createRoom";
import { faceWallId } from "../../domain/geometry/freestandingWalls";
import type { Project } from "../../domain/project";
import { createTestAppStore } from "../../test/testAppStore";
import { createAppStore } from "../store";

// A single rectangle room, born with the compass names — the shape both
// actions are about.
const ROOM_ID = "room-a";
const NORTH = "room-a-wall-north";
const EAST = "room-a-wall-east";

describe("renameWall / setRoomNorthWall", () => {
  let store: ReturnType<typeof createAppStore>;

  beforeEach(async () => {
    store = createTestAppStore().store;
    await store.getState().boot();
    const base = store.getState().project!;
    const next: Project = {
      ...base,
      wallObjects: [],
      floorObjects: [],
      floor: {
        rooms: [
          createRectangularRoomPlacement({
            roomId: ROOM_ID,
            name: "Room A",
            widthMm: 6000,
            depthMm: 4000,
            heightMm: 2500,
            offsetXMm: 0,
            offsetYMm: 0
          })
        ]
      }
    };
    store.setState({ project: next });
  });

  const wallNames = () =>
    store.getState().project!.floor.rooms[0]!.room.walls.map((wall) => wall.name);

  it("trims the new name and commits one undo entry", async () => {
    const undoBefore = store.getState().undoStack.length;

    await store.getState().renameWall(NORTH, "  Entrance wall  ");

    expect(wallNames()[0]).toBe("Entrance wall");
    expect(store.getState().undoStack.length).toBe(undoBefore + 1);

    await store.getState().undo();
    expect(wallNames()[0]).toBe("North wall");
  });

  it("no-ops on an empty name, an unchanged name, and an unknown wall", async () => {
    const undoBefore = store.getState().undoStack.length;

    await store.getState().renameWall(NORTH, "   ");
    await store.getState().renameWall(NORTH, "North wall");
    await store.getState().renameWall("room-a-wall-missing", "Anything");

    expect(wallNames()).toEqual(["North wall", "East wall", "South wall", "West wall"]);
    expect(store.getState().undoStack.length).toBe(undoBefore);
  });

  // Partition faces are derived from the freestanding wall, so there is no
  // stored name here to change.
  it("refuses to rename a partition face", async () => {
    const undoBefore = store.getState().undoStack.length;

    await store
      .getState()
      .renameWall(faceWallId("partition-1", "a"), "Projection face");

    expect(store.getState().undoStack.length).toBe(undoBefore);
  });

  it("relabels all four walls in one undo entry, and undo restores every name", async () => {
    await store.getState().renameWall(NORTH, "Entrance wall");
    const undoBefore = store.getState().undoStack.length;

    await store.getState().setRoomNorthWall(ROOM_ID, EAST);

    expect(wallNames()).toEqual([
      "West wall",
      "North wall",
      "East wall",
      "South wall"
    ]);
    expect(store.getState().undoStack.length).toBe(undoBefore + 1);

    await store.getState().undo();
    expect(wallNames()).toEqual([
      "Entrance wall",
      "East wall",
      "South wall",
      "West wall"
    ]);
  });

  it("no-ops for an unknown room, a foreign wall, and a partition face", async () => {
    const undoBefore = store.getState().undoStack.length;

    await store.getState().setRoomNorthWall("room-missing", EAST);
    await store.getState().setRoomNorthWall(ROOM_ID, "room-b-wall-north");
    await store.getState().setRoomNorthWall(ROOM_ID, faceWallId("partition-1", "b"));

    expect(wallNames()).toEqual(["North wall", "East wall", "South wall", "West wall"]);
    expect(store.getState().undoStack.length).toBe(undoBefore);
  });

  it("leaves a room that is not a quadrilateral alone", async () => {
    const base = store.getState().project!;
    const placement = base.floor.rooms[0]!;
    // Drop one wall so the room stops being a quadrilateral, without touching
    // any other invariant this test reads.
    store.setState({
      project: {
        ...base,
        floor: {
          rooms: [
            {
              ...placement,
              room: { ...placement.room, walls: placement.room.walls.slice(0, 3) }
            }
          ]
        }
      }
    });
    const undoBefore = store.getState().undoStack.length;

    await store.getState().setRoomNorthWall(ROOM_ID, EAST);

    expect(store.getState().undoStack.length).toBe(undoBefore);
  });
});
