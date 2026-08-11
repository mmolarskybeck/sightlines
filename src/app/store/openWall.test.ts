import { beforeEach, describe, expect, it } from "vitest";
import { CURRENT_ARTWORK_SCHEMA_VERSION, type Project } from "../../domain/project";
import { createRectangularRoomPlacement } from "../../domain/geometry/createRoom";
import { isWallOpen } from "../../domain/geometry/wallCascade";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository
} from "../../test/inMemoryRepositories";
import { createInertCrossTabSync } from "../crossTabSync";
import { createAppStore } from "../store";
import { NO_SELECTION } from "./selectionSlice";

// Two abutting rooms: room-a's east wall and room-b's west wall are a
// coincident twin pair that fully covers both walls.
const A_EAST = "room-a-wall-east";
const A_NORTH = "room-a-wall-north";
const B_WEST = "room-b-wall-west";

describe("openWall / restoreWall", () => {
  let store: ReturnType<typeof createAppStore>;

  beforeEach(async () => {
    store = createAppStore({
      projectRepository: new InMemoryProjectRepository(),
      artworkLibraryRepository: new InMemoryArtworkLibraryRepository(),
      assetRepository: new InMemoryAssetRepository(),
      imageProcessor: new FakeImageProcessor(),
      projectSnapshotRepository: new InMemoryProjectSnapshotRepository(),
      // Every store in this process would otherwise share one BroadcastChannel.
      crossTabSync: createInertCrossTabSync()
    });
    await store.getState().boot();
  });

  function setupRooms(secondRoom: { offsetXMm: number; depthMm?: number } | null): void {
    const base = store.getState().project!;
    const rooms = [
      createRectangularRoomPlacement({
        roomId: "room-a",
        name: "Room A",
        widthMm: 4000,
        depthMm: 3000,
        heightMm: 2500,
        offsetXMm: 0,
        offsetYMm: 0
      })
    ];
    if (secondRoom) {
      rooms.push(
        createRectangularRoomPlacement({
          roomId: "room-b",
          name: "Room B",
          widthMm: 4000,
          depthMm: secondRoom.depthMm ?? 3000,
          heightMm: 2500,
          offsetXMm: secondRoom.offsetXMm,
          offsetYMm: 0
        })
      );
    }
    const next: Project = { ...base, wallObjects: [], floorObjects: [], floor: { rooms } };
    store.setState({ project: next });
  }

  it("opens an exterior wall in one undo entry and reverses cleanly", async () => {
    setupRooms(null);
    const undoBefore = store.getState().undoStack.length;

    const blocked = await store.getState().openWall(A_NORTH);

    expect(blocked).toBeNull();
    expect(isWallOpen(store.getState().project!, A_NORTH)).toBe(true);
    expect(store.getState().undoStack.length).toBe(undoBefore + 1);

    await store.getState().undo();
    expect(isWallOpen(store.getState().project!, A_NORTH)).toBe(false);
  });

  it("unhangs artwork to the checklist while deleting fixtures, and undo restores both", async () => {
    setupRooms(null);
    await store.getState().addOpening(A_NORTH, "door");
    const base = store.getState().project!;
    store.setState({
      project: {
        ...base,
        checklistArtworkIds: ["work-1"],
        wallObjects: [
          ...base.wallObjects,
          {
            id: "art-1",
            kind: "artwork",
            artworkId: "work-1",
            wallId: A_NORTH,
            xMm: 1000,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          }
        ]
      }
    });

    await store.getState().openWall(A_NORTH);

    const after = store.getState().project!;
    expect(after.wallObjects.filter((o) => o.wallId === A_NORTH)).toEqual([]);
    // The unhang: the placement is gone, the work is still on the checklist.
    expect(after.checklistArtworkIds).toContain("work-1");

    await store.getState().undo();
    const restored = store.getState().project!;
    expect(restored.wallObjects.some((o) => o.id === "art-1")).toBe(true);
    expect(restored.wallObjects.some((o) => o.kind === "door")).toBe(true);
  });

  it("opens both twins and both doors in a single undo entry", async () => {
    setupRooms({ offsetXMm: 4000 });
    await store.getState().addOpening(A_EAST, "door");
    expect(store.getState().project!.wallObjects).toHaveLength(2);
    const undoBefore = store.getState().undoStack.length;

    const blocked = await store.getState().openWall(A_EAST);

    expect(blocked).toBeNull();
    const after = store.getState().project!;
    expect(isWallOpen(after, A_EAST)).toBe(true);
    expect(isWallOpen(after, B_WEST)).toBe(true);
    expect(after.wallObjects).toEqual([]);
    // Both sides, both halves, one step.
    expect(store.getState().undoStack.length).toBe(undoBefore + 1);

    await store.getState().undo();
    const undone = store.getState().project!;
    expect(isWallOpen(undone, A_EAST)).toBe(false);
    expect(isWallOpen(undone, B_WEST)).toBe(false);
    expect(undone.wallObjects).toHaveLength(2);
  });

  // The alcove case, end to end: selecting the SHORT wall splits the long one
  // and opens only the segment behind it — all in a single undo entry.
  it("splits an outrunning counterpart and opens only the backing segment", async () => {
    setupRooms({ offsetXMm: 4000, depthMm: 1500 });
    const undoBefore = store.getState().undoStack.length;

    const blocked = await store.getState().openWall(B_WEST);

    expect(blocked).toBeNull();
    const after = store.getState().project!;
    expect(isWallOpen(after, B_WEST)).toBe(true);

    const roomA = after.floor.rooms.find((r) => r.roomId === "room-a")!.room;
    // The long east wall became two: one open segment, one still solid.
    expect(roomA.walls).toHaveLength(5);
    expect(roomA.walls.filter((w) => w.isOpenSide === true)).toHaveLength(1);

    // The split AND both opens are one step.
    expect(store.getState().undoStack.length).toBe(undoBefore + 1);

    await store.getState().undo();
    const undone = store.getState().project!;
    expect(undone.floor.rooms.find((r) => r.roomId === "room-a")!.room.walls).toHaveLength(4);
    expect(isWallOpen(undone, B_WEST)).toBe(false);
  });

  it("opening the LONG wall instead takes the whole side, no split", async () => {
    setupRooms({ offsetXMm: 4000, depthMm: 1500 });

    const blocked = await store.getState().openWall(A_EAST);

    expect(blocked).toBeNull();
    const after = store.getState().project!;
    expect(isWallOpen(after, A_EAST)).toBe(true);
    expect(isWallOpen(after, B_WEST)).toBe(true);
    expect(after.floor.rooms.find((r) => r.roomId === "room-a")!.room.walls).toHaveLength(4);
  });

  it("is inert on an already-open wall", async () => {
    setupRooms(null);
    await store.getState().openWall(A_NORTH);
    const undoBefore = store.getState().undoStack.length;

    const blocked = await store.getState().openWall(A_NORTH);

    expect(blocked).toBe("already-open");
    expect(store.getState().undoStack.length).toBe(undoBefore);
  });

  it("keeps wall context on the opened wall but drops the deliberate pick", async () => {
    setupRooms(null);
    store.getState().selectWall(A_NORTH);
    expect(store.getState().selection).toEqual({ kind: "wall", wallId: A_NORTH });

    await store.getState().openWall(A_NORTH);

    // Context survives so the inspector flips straight to the Restore state...
    expect(store.getState().wallContextId).toBe(A_NORTH);
    // ...but the wall is no longer Delete-eligible.
    expect(store.getState().selection).toEqual(NO_SELECTION);
  });

  it("restores both twins, without bringing contents back", async () => {
    setupRooms({ offsetXMm: 4000 });
    await store.getState().addOpening(A_EAST, "door");
    await store.getState().openWall(A_EAST);

    await store.getState().restoreWall(A_EAST);

    const after = store.getState().project!;
    expect(isWallOpen(after, A_EAST)).toBe(false);
    expect(isWallOpen(after, B_WEST)).toBe(false);
    // Restore returns the wall, never its contents — only undo does that.
    expect(after.wallObjects).toEqual([]);
  });

  it("restore is a no-op on a solid wall", async () => {
    setupRooms(null);
    const before = store.getState().project!;
    const undoBefore = store.getState().undoStack.length;

    await store.getState().restoreWall(A_NORTH);

    expect(store.getState().project).toBe(before);
    expect(store.getState().undoStack.length).toBe(undoBefore);
  });
});

// Hiding the affordance is not enough: these actions are reachable from drops,
// group drags, the elevation canvas and the inspector. Every one must refuse,
// and say why rather than silently doing nothing.
describe("open walls refuse every placement and re-anchor path", () => {
  let store: ReturnType<typeof createAppStore>;

  beforeEach(async () => {
    store = createAppStore({
      projectRepository: new InMemoryProjectRepository(),
      artworkLibraryRepository: new InMemoryArtworkLibraryRepository(),
      assetRepository: new InMemoryAssetRepository(),
      imageProcessor: new FakeImageProcessor(),
      projectSnapshotRepository: new InMemoryProjectSnapshotRepository(),
      // Every store in this process would otherwise share one BroadcastChannel.
      crossTabSync: createInertCrossTabSync()
    });
    await store.getState().boot();
    const base = store.getState().project!;
    store.setState({
      project: {
        ...base,
        wallObjects: [],
        floorObjects: [],
        floor: {
          rooms: [
            createRectangularRoomPlacement({
              roomId: "room-a",
              name: "Room A",
              widthMm: 4000,
              depthMm: 3000,
              heightMm: 2500,
              offsetXMm: 0,
              offsetYMm: 0
            })
          ]
        }
      }
    });
    await store.getState().openWall(A_NORTH);
    store.setState({ error: null });
  });

  const cases: Array<{ name: string; act: (s: typeof store) => Promise<unknown> }> = [
    { name: "addOpening (door)", act: (s) => s.getState().addOpening(A_NORTH, "door") },
    { name: "addOpening (window)", act: (s) => s.getState().addOpening(A_NORTH, "window") },
    {
      name: "addOpening (blocked zone)",
      act: (s) => s.getState().addOpening(A_NORTH, "blocked-zone")
    },
    { name: "addOpening (wall text)", act: (s) => s.getState().addOpening(A_NORTH, "wall-text") },
    { name: "addWallCase", act: (s) => s.getState().addWallCase(A_NORTH) },
    {
      name: "placeOpeningOnElevation",
      act: (s) => s.getState().placeOpeningOnElevation("door", A_NORTH, 1000, 1000)
    },
    {
      name: "placeOpeningFromPlan",
      act: (s) =>
        s.getState().placeOpeningFromPlan("door", { anchor: "wall", wallId: A_NORTH, xMm: 1000 })
    },
    {
      name: "placeCaseFromPlan",
      act: (s) => s.getState().placeCaseFromPlan({ anchor: "wall", wallId: A_NORTH, xMm: 1000 })
    }
  ];

  for (const testCase of cases) {
    it(`${testCase.name} refuses and explains`, async () => {
      const before = store.getState().project!.wallObjects.length;

      await testCase.act(store);

      expect(store.getState().project!.wallObjects).toHaveLength(before);
      // A silent no-op reads as a broken app.
      expect(store.getState().error).toMatch(/open/i);
    });
  }

  it("placeArtwork refuses and explains", async () => {
    // Must be a REAL library artwork: placeArtwork returns early on an unknown
    // id, so a bogus one would pass this test without ever reaching the guard.
    store.setState({
      libraryArtworks: [
        {
          id: "work-1",
          schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
          title: "Test work",
          dimensions: { widthMm: 600, heightMm: 800, status: "known" },
          metadata: {}
        }
      ]
    });
    const before = store.getState().project!.wallObjects.length;

    await store.getState().placeArtwork("work-1", A_NORTH, 1000, 1450);

    expect(store.getState().project!.wallObjects).toHaveLength(before);
    expect(store.getState().error).toMatch(/open/i);
  });

  it("a group re-anchor onto an open wall refuses the whole move", async () => {
    // Place a work on a solid wall, then try to drag it onto the open one.
    const base = store.getState().project!;
    store.setState({
      project: {
        ...base,
        wallObjects: [
          {
            id: "art-1",
            kind: "artwork",
            artworkId: "work-1",
            wallId: A_EAST,
            xMm: 1000,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          }
        ]
      }
    });

    await store.getState().movePlanObjectsGroup([
      { id: "art-1", xMm: 1200, wallId: A_NORTH }
    ]);

    expect(store.getState().project!.wallObjects[0].wallId).toBe(A_EAST);
    expect(store.getState().error).toMatch(/open/i);
  });
});
