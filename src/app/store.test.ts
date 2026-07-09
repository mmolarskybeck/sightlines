import { beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_FLOOR_OBJECT_DEPTH_MM
} from "../domain/project";
import type { Project } from "../domain/project";
import type { ArtworkImportDraft } from "../domain/import/types";
import {
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../domain/placement/placeArtwork";
import {
  arrangeOnWall,
  arrangeOnWallInZone,
  getSpacingSegments,
  solveEqualArrangement,
  solveEqualArrangementInZone
} from "../domain/placement/arrangeOnWall";
import { createSampleProject } from "../domain/sample/sampleProject";
import { MAX_IMPORT_JSON_LENGTH } from "../domain/schema/projectSchema";
import { feetToMm } from "../domain/units/length";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  makeImageFile
} from "../test/inMemoryRepositories";
import type { AppStoreDeps } from "./store";
import {
  createAppStore,
  exportProjectJson,
  freestandingWallIdOf,
  getSelectedArtworkId,
  getSelectedOpeningId,
  getSelectedWall,
  objectIdsOf,
  roomIdOf
} from "./store";

describe("app store", () => {
  let repository: InMemoryProjectRepository;
  let artworkLibraryRepository: InMemoryArtworkLibraryRepository;
  let assetRepository: InMemoryAssetRepository;
  let imageProcessor: FakeImageProcessor;
  let store: ReturnType<typeof createAppStore>;

  function makeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
    return {
      projectRepository: repository,
      artworkLibraryRepository,
      assetRepository,
      imageProcessor,
      ...overrides
    };
  }

  beforeEach(async () => {
    repository = new InMemoryProjectRepository();
    artworkLibraryRepository = new InMemoryArtworkLibraryRepository();
    assetRepository = new InMemoryAssetRepository();
    imageProcessor = new FakeImageProcessor();
    store = createAppStore(makeDeps());
    await store.getState().boot();
  });

  it("boots an empty repository into a persisted sample project", () => {
    const state = store.getState();

    expect(state.project?.title).toBe("Untitled Exhibition");
    expect(state.saveState).toBe("saved");
    expect(repository.projects.size).toBe(1);
    expect(state.wallContextId).toBe("wall-north");
  });

  it("resize creates one undo entry and undo/redo round-trips the document", async () => {
    const state = store.getState();
    const originalLength = getSelectedWall(
      state.project!,
      state.wallContextId
    )!.lengthMm;

    await state.resizeSelectedWall(10_000);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(
      getSelectedWall(store.getState().project!, "wall-north")!.lengthMm
    ).toBeCloseTo(10_000);

    await store.getState().undo();
    expect(
      getSelectedWall(store.getState().project!, "wall-north")!.lengthMm
    ).toBeCloseTo(originalLength);
    expect(store.getState().redoStack).toHaveLength(1);

    await store.getState().redo();
    expect(
      getSelectedWall(store.getState().project!, "wall-north")!.lengthMm
    ).toBeCloseTo(10_000);

    const persisted = repository.projects.get(store.getState().project!.id)!;
    expect(getSelectedWall(persisted, "wall-north")!.lengthMm).toBeCloseTo(10_000);
  });

  it("resizeWall edits a wall other than the current selection", async () => {
    await store.getState().resizeWall("wall-east", 6_000);

    expect(
      getSelectedWall(store.getState().project!, "wall-east")!.lengthMm
    ).toBeCloseTo(6_000);
    expect(store.getState().wallContextId).toBe("wall-north");
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("resizeRoomHeight updates the room and every wall in that room", async () => {
    const nextHeightMm = feetToMm(10);

    await store.getState().resizeRoomHeight("room-main", nextHeightMm);

    const room = store.getState().project!.floor.rooms[0].room;
    expect(room.heightMm).toBeCloseTo(nextHeightMm);
    expect(room.walls.map((wall) => wall.heightMm)).toEqual(
      room.walls.map(() => nextHeightMm)
    );
    expect(store.getState().undoStack.at(-1)?.label).toBe("Resize room height");
  });

  it("addFreestandingWall assigns the room by midpoint and selects the partition", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });

    const state = store.getState();
    const partitions = state.project!.floor.rooms[0].room.freestandingWalls;
    expect(partitions).toHaveLength(1);
    expect(partitions[0].roomId).toBe("room-main");
    expect(freestandingWallIdOf(state.selection)).toBe(partitions[0].id);
    expect(state.undoStack.at(-1)?.label).toBe("Add partition");

    await store.getState().undo();
    expect(store.getState().project!.floor.rooms[0].room.freestandingWalls).toHaveLength(0);
  });

  it("addFreestandingWall refuses a partition drawn outside every room", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 90_000, yMm: 90_000 }, { xMm: 92_000, yMm: 90_000 });
    expect(store.getState().project!.floor.rooms[0].room.freestandingWalls).toHaveLength(0);
    expect(store.getState().error).toMatch(/inside a room/i);
  });

  it("deleteFreestandingWall removes both faces' objects in one undo step", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });
    const partitionId = store.getState().project!.floor.rooms[0].room.freestandingWalls[0].id;

    // Hang a work on each face at the same x — different face ids, so no warning.
    const project = store.getState().project!;
    store.setState({
      project: {
        ...project,
        wallObjects: [
          {
            id: "art-a",
            kind: "artwork",
            artworkId: "art-a",
            wallId: `${partitionId}#a`,
            xMm: 500,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          },
          {
            id: "art-b",
            kind: "artwork",
            artworkId: "art-b",
            wallId: `${partitionId}#b`,
            xMm: 500,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          }
        ]
      }
    });

    const undoBefore = store.getState().undoStack.length;
    await store.getState().deleteFreestandingWall(partitionId);

    expect(store.getState().project!.wallObjects).toHaveLength(0);
    expect(store.getState().project!.floor.rooms[0].room.freestandingWalls).toHaveLength(0);
    expect(store.getState().undoStack.length).toBe(undoBefore + 1);

    await store.getState().undo();
    expect(store.getState().project!.wallObjects).toHaveLength(2);
    expect(store.getState().project!.floor.rooms[0].room.freestandingWalls).toHaveLength(1);
  });

  it("deleteRoom cascades to a partition's face objects", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });
    const partitionId = store.getState().project!.floor.rooms[0].room.freestandingWalls[0].id;
    const project = store.getState().project!;
    store.setState({
      project: {
        ...project,
        wallObjects: [
          {
            id: "art-a",
            kind: "artwork",
            artworkId: "art-a",
            wallId: `${partitionId}#a`,
            xMm: 500,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          }
        ]
      }
    });

    await store.getState().deleteRoom("room-main");
    expect(store.getState().project!.floor.rooms).toHaveLength(0);
    expect(store.getState().project!.wallObjects).toHaveLength(0);
  });

  it("refuses a door on a partition face but allows a blocked zone", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });
    const partitionId = store.getState().project!.floor.rooms[0].room.freestandingWalls[0].id;
    const faceId = `${partitionId}#a`;

    await store.getState().addOpening(faceId, "door");
    expect(store.getState().project!.wallObjects).toHaveLength(0);
    expect(store.getState().error).toMatch(/can't be placed on a partition/i);

    await store.getState().addOpening(faceId, "blocked-zone");
    const objects = store.getState().project!.wallObjects;
    expect(objects).toHaveLength(1);
    expect(objects[0].kind).toBe("blocked-zone");
    expect(objects[0].wallId).toBe(faceId);
  });

  it("resizeRoomHeight carries a default-height partition but leaves an overridden one alone", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 3500 }, { xMm: 5000, yMm: 3500 });
    const room = () => store.getState().project!.floor.rooms[0].room;
    const [defaultPartition, overriddenPartition] = room().freestandingWalls;
    const previousRoomHeightMm = room().heightMm;

    // Override the second partition's height to something shorter than ceiling.
    await store.getState().setFreestandingWallHeight(overriddenPartition.id, 2000);
    expect(defaultPartition.heightMm).toBe(previousRoomHeightMm);

    const nextHeightMm = feetToMm(10);
    await store.getState().resizeRoomHeight("room-main", nextHeightMm);

    const partitions = room().freestandingWalls;
    const followed = partitions.find((p) => p.id === defaultPartition.id)!;
    const overridden = partitions.find((p) => p.id === overriddenPartition.id)!;
    expect(followed.heightMm).toBeCloseTo(nextHeightMm); // followed the room
    expect(overridden.heightMm).toBe(2000); // kept its explicit height
  });

  it("resizeRoomHeight surfaces placement warnings for objects above the new height", async () => {
    const project = store.getState().project!;
    store.setState({
      project: {
        ...project,
        wallObjects: [
          {
            id: "high-blocked-zone",
            wallId: "wall-north",
            kind: "blocked-zone",
            blocksPlacement: true,
            xMm: feetToMm(4),
            yMm: feetToMm(11),
            widthMm: feetToMm(2),
            heightMm: feetToMm(2)
          }
        ]
      }
    });

    await store.getState().resizeRoomHeight("room-main", feetToMm(10));

    expect(
      store.getState().placementWarnings.some(
        (warning) =>
          warning.wallObjectId === "high-blocked-zone" &&
          warning.type === "bounds" &&
          warning.message === "Placement is outside the wall height."
      )
    ).toBe(true);
  });

  it("a new edit clears the redo stack", async () => {
    await store.getState().resizeSelectedWall(10_000);
    await store.getState().undo();
    expect(store.getState().redoStack).toHaveLength(1);

    await store.getState().renameProject("Winter Show");
    expect(store.getState().redoStack).toHaveLength(0);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("setUnit updates the project's display unit, persists, and is undoable", async () => {
    const project = store.getState().project!;
    expect(project.unit).toBe("ft");

    await store.getState().setUnit("m");

    const state = store.getState();
    expect(state.project?.unit).toBe("m");
    expect(state.undoStack).toHaveLength(1);

    const persisted = repository.projects.get(state.project!.id)!;
    expect(persisted.unit).toBe("m");

    await store.getState().undo();
    expect(store.getState().project?.unit).toBe("ft");
  });

  it("skips a setUnit call that does not change the unit", async () => {
    const before = store.getState().project!;

    await store.getState().setUnit(before.unit);

    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project).toBe(before);
  });

  it("skips no-op and empty renames instead of recording undo entries", async () => {
    const before = store.getState().project!;

    await store.getState().renameProject("   ");
    await store.getState().renameProject(before.title);

    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project).toBe(before);
  });

  it("renames a room, persists the change, and is undoable", async () => {
    await store.getState().renameRoom("room-main", "East Gallery");

    let state = store.getState();
    expect(state.project!.floor.rooms[0].room.name).toBe("East Gallery");
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack.at(-1)?.label).toBe("Rename room");
    expect(repository.projects.get(state.project!.id)!.floor.rooms[0].room.name).toBe(
      "East Gallery"
    );

    await store.getState().undo();

    state = store.getState();
    expect(state.project!.floor.rooms[0].room.name).toBe("Main Gallery");
  });

  it("skips no-op, empty, and missing room renames", async () => {
    const before = store.getState().project!;

    await store.getState().renameRoom("room-main", "   ");
    await store.getState().renameRoom("room-main", before.floor.rooms[0].room.name);
    await store.getState().renameRoom("missing-room", "Back Gallery");

    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project).toBe(before);
  });

  it("deletes a room, removes its wall objects, and moves selection to a surviving wall", async () => {
    await store.getState().addRectangleRoom();
    await store.getState().addOpening("room-2-wall-north", "door");

    expect(store.getState().project!.floor.rooms).toHaveLength(2);
    expect(store.getState().project!.wallObjects).toHaveLength(1);
    expect(store.getState().wallContextId).toBe("room-2-wall-north");
    expect(
      getSelectedOpeningId(store.getState().project, store.getState().selection)
    ).toBeDefined();

    await store.getState().deleteRoom("room-2");

    let state = store.getState();
    expect(state.project!.floor.rooms.map((placement) => placement.roomId)).toEqual([
      "room-main"
    ]);
    expect(state.project!.wallObjects).toEqual([]);
    expect(state.wallContextId).toBe("wall-north");
    expect(getSelectedOpeningId(state.project, state.selection)).toBeNull();
    expect(state.viewMode).toBe("plan");
    expect(state.undoStack.at(-1)?.label).toBe("Delete Gallery 2");
    expect(repository.projects.get(state.project!.id)!.floor.rooms).toHaveLength(1);

    await store.getState().undo();

    state = store.getState();
    expect(state.project!.floor.rooms.map((placement) => placement.roomId)).toEqual([
      "room-main",
      "room-2"
    ]);
    expect(state.project!.wallObjects).toHaveLength(1);
  });

  it("deleting a missing room is a no-op", async () => {
    const before = store.getState().project!;

    await store.getState().deleteRoom("missing-room");

    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project).toBe(before);
  });

  it("addPolygonRoom adds an L-shaped room in one undo step and selects it", async () => {
    const lShape = [
      { xMm: 10_000, yMm: 0 },
      { xMm: 10_000, yMm: 3_000 },
      { xMm: 12_000, yMm: 3_000 },
      { xMm: 12_000, yMm: 1_000 },
      { xMm: 14_000, yMm: 1_000 },
      { xMm: 14_000, yMm: 0 }
    ];

    await store.getState().addPolygonRoom(lShape);

    const state = store.getState();
    expect(state.project!.floor.rooms).toHaveLength(2);
    const added = state.project!.floor.rooms[1];
    expect(added.roomId).toBe("room-2");
    expect(added.room.walls).toHaveLength(6);
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack.at(-1)?.label).toBe("Add room");
    // Room is selected, and the sidebar wall context is its first wall.
    expect(roomIdOf(state.selection)).toBe("room-2");
    expect(state.wallContextId).toBe("room-2-wall-0");
    expect(state.viewMode).toBe("plan");

    await store.getState().undo();
    expect(store.getState().project!.floor.rooms).toHaveLength(1);
  });

  it("addPolygonRoom rejects a self-intersecting outline without committing", async () => {
    const before = store.getState().project!;

    await store.getState().addPolygonRoom([
      { xMm: 0, yMm: 0 },
      { xMm: 1_000, yMm: 1_000 },
      { xMm: 1_000, yMm: 0 },
      { xMm: 0, yMm: 1_000 }
    ]);

    const state = store.getState();
    expect(state.project).toBe(before);
    expect(state.undoStack).toHaveLength(0);
    expect(state.error).toBeTruthy();
  });

  it("skips a resize that does not change any wall", async () => {
    const state = store.getState();
    const currentLength = getSelectedWall(
      state.project!,
      state.wallContextId
    )!.lengthMm;

    await state.resizeSelectedWall(currentLength);

    expect(store.getState().undoStack).toHaveLength(0);
  });

  describe("moveRoomVertex", () => {
    it("commits one undo entry and surfaces bounds warnings for objects on changed walls", async () => {
      const project = store.getState().project!;
      store.setState({
        project: {
          ...project,
          wallObjects: [
            {
              id: "art-1",
              wallId: "wall-north",
              kind: "artwork",
              artworkId: "artwork-1",
              xMm: feetToMm(20),
              yMm: feetToMm(5),
              widthMm: 600,
              heightMm: 800
            }
          ]
        }
      });

      await store.getState().moveRoomVertex("room-main", "v-ne", {
        xMm: feetToMm(10),
        yMm: feetToMm(4)
      });

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Move room corner");
      expect(state.lastGeometryEdit?.anchorVertexId).toBe("v-ne");
      expect(state.lastGeometryEdit?.changedWallIds.sort()).toEqual(
        ["wall-east", "wall-north"].sort()
      );
      // The north wall shrank from 28ft to hypot(10ft,4ft), well short of the
      // artwork's original xMm — a bounds warning, not a silent move.
      expect(state.placementWarnings.some((warning) => warning.wallObjectId === "art-1")).toBe(
        true
      );
      expect(
        state.project!.wallObjects.find((object) => object.id === "art-1")?.xMm
      ).toBe(feetToMm(20));
    });

    it("rejects a self-intersecting drag without committing", async () => {
      const before = store.getState().project!;

      await store.getState().moveRoomVertex("room-main", "v-ne", {
        xMm: feetToMm(10),
        yMm: feetToMm(28)
      });

      const state = store.getState();
      expect(state.project).toBe(before);
      expect(state.undoStack).toHaveLength(0);
      expect(state.error).toBeTruthy();
    });
  });

  describe("splitWall", () => {
    it("splits a wall in one undo entry, keeping the original id on the first segment", async () => {
      await store.getState().splitWall("wall-north", 3000);

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Split wall");
      const room = state.project!.floor.rooms[0].room;
      expect(room.walls).toHaveLength(5);
      const firstWall = room.walls.find((wall) => wall.id === "wall-north")!;
      expect(firstWall.startVertexId).toBe("v-nw");
      const secondWall = room.walls.find(
        (wall) => wall.startVertexId === firstWall.endVertexId
      )!;
      expect(secondWall.endVertexId).toBe("v-ne");
      expect(state.lastGeometryEdit?.changedWallIds).toContain("wall-north");
    });

    it("rejects a split too close to the wall's end without committing", async () => {
      const before = store.getState().project!;

      await store.getState().splitWall("wall-north", 2);

      const state = store.getState();
      expect(state.project).toBe(before);
      expect(state.undoStack).toHaveLength(0);
      expect(state.error).toBeTruthy();
    });
  });

  describe("deleteRoomVertex", () => {
    it("merges the two walls, moving a dangling wallContext to the merged wall", async () => {
      store.getState().selectWall("wall-east");
      expect(store.getState().wallContextId).toBe("wall-east");

      await store.getState().deleteRoomVertex("room-main", "v-ne");

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Delete room corner");
      const room = state.project!.floor.rooms[0].room;
      expect(room.vertices).toHaveLength(3);
      expect(room.walls.some((wall) => wall.id === "wall-east")).toBe(false);
      // wall-east is gone; the sidebar context falls back to the merged wall.
      expect(state.wallContextId).toBe("wall-north");
    });

    it("rejects removing a vertex that would leave fewer than three corners", async () => {
      const project = store.getState().project!;
      const room = project.floor.rooms[0].room;
      store.setState({
        project: {
          ...project,
          floor: {
            rooms: [
              {
                ...project.floor.rooms[0],
                room: {
                  ...room,
                  vertices: room.vertices.filter((vertex) => vertex.id !== "v-sw"),
                  walls: [room.walls[0], room.walls[1], { ...room.walls[2], endVertexId: "v-nw" }]
                }
              }
            ]
          }
        }
      });
      const before = store.getState().project!;

      await store.getState().deleteRoomVertex("room-main", "v-ne");

      const state = store.getState();
      expect(state.project).toBe(before);
      expect(state.undoStack).toHaveLength(0);
      expect(state.error).toBeTruthy();
    });
  });

  describe("moveRoom", () => {
    it("updates a room's placement offsets, persists, and is undoable/redoable", async () => {
      const before = store.getState().project!.floor.rooms[0];
      expect(before.offsetXMm).toBe(0);
      expect(before.offsetYMm).toBe(0);

      await store.getState().moveRoom("room-main", feetToMm(10), feetToMm(5));

      let state = store.getState();
      expect(state.undoStack).toHaveLength(1);
      expect(state.undoStack.at(-1)?.label).toBe("Move room");
      let placement = state.project!.floor.rooms[0];
      expect(placement.offsetXMm).toBeCloseTo(feetToMm(10));
      expect(placement.offsetYMm).toBeCloseTo(feetToMm(5));
      const persisted = repository.projects.get(state.project!.id)!;
      expect(persisted.floor.rooms[0].offsetXMm).toBeCloseTo(feetToMm(10));

      await store.getState().undo();
      placement = store.getState().project!.floor.rooms[0];
      expect(placement.offsetXMm).toBe(0);
      expect(placement.offsetYMm).toBe(0);

      await store.getState().redo();
      placement = store.getState().project!.floor.rooms[0];
      expect(placement.offsetXMm).toBeCloseTo(feetToMm(10));
      expect(placement.offsetYMm).toBeCloseTo(feetToMm(5));
    });

    it("is a no-op (no undo entry) when the offsets are unchanged", async () => {
      const before = store.getState().project!;
      const placement = before.floor.rooms[0];

      await store.getState().moveRoom("room-main", placement.offsetXMm, placement.offsetYMm);

      expect(store.getState().undoStack).toHaveLength(0);
      expect(store.getState().project).toBe(before);
    });

    it("throws for an unknown room id", async () => {
      await expect(
        store.getState().moveRoom("missing-room", 100, 100)
      ).rejects.toThrow(/Room not found/);
      expect(store.getState().undoStack).toHaveLength(0);
    });
  });

  it("rejects text that is not valid JSON, and leaves the current project untouched", async () => {
    const before = store.getState().project;

    await store.getState().importProjectJson("not json at all");

    expect(store.getState().error).toMatch(/Import failed/);
    expect(store.getState().error).toMatch(/not valid JSON/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects valid JSON that is not a Sightlines project, and leaves the current project untouched", async () => {
    const before = store.getState().project;

    await store.getState().importProjectJson(JSON.stringify({ hello: 1 }));

    expect(store.getState().error).toMatch(/Import failed/);
    expect(store.getState().error).toMatch(/not a Sightlines project/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects a project made with a newer schema version, distinctly, and leaves the current project untouched", async () => {
    const before = store.getState().project;
    const fromTheFuture = {
      ...createSampleProject(),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1
    };

    await store.getState().importProjectJson(JSON.stringify(fromTheFuture));

    expect(store.getState().error).toMatch(/newer version of Sightlines/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects a same-version project that fails validation, and leaves the current project untouched", async () => {
    const before = store.getState().project;
    const broken = createSampleProject();
    broken.floor.rooms[0].room.walls[0].startVertexId = "missing";

    await store.getState().importProjectJson(JSON.stringify(broken));

    expect(store.getState().error).toMatch(/doesn't match the Sightlines format/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects an oversized import before parsing it, and leaves the current project untouched", async () => {
    const before = store.getState().project;
    const oversized = "a".repeat(MAX_IMPORT_JSON_LENGTH + 1);

    await store.getState().importProjectJson(oversized);

    expect(store.getState().error).toMatch(/too large/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects non-string input instead of throwing, and leaves the current project untouched", async () => {
    const before = store.getState().project;

    await store.getState().importProjectJson(null as unknown as string);

    expect(store.getState().error).toMatch(/Import failed/);
    expect(store.getState().project).toBe(before);
  });

  it("exported project JSON always re-imports successfully and round-trips exactly", async () => {
    const original = store.getState().project!;
    const json = exportProjectJson(original);

    await store.getState().importProjectJson(json);

    const state = store.getState();
    expect(state.error).toBeNull();
    expect(state.project).toEqual(original);
    expect(repository.projects.get(original.id)).toEqual(original);
  });

  it("a valid import replaces the document and resets edit history", async () => {
    await store.getState().resizeSelectedWall(10_000);
    expect(store.getState().undoStack).toHaveLength(1);

    const imported = { ...createSampleProject(), id: "imported", title: "Imported" };
    await store.getState().importProjectJson(JSON.stringify(imported));

    const state = store.getState();
    expect(state.project?.id).toBe("imported");
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
    expect(state.error).toBeNull();
    expect(repository.projects.has("imported")).toBe(true);
  });

  it("surfaces a load failure instead of silently swapping in the sample", async () => {
    const failing = new InMemoryProjectRepository();
    const broken = createSampleProject();
    failing.projects.set(broken.id, broken);
    failing.load = async () => {
      throw new Error("stored document failed validation");
    };

    const failingStore = createAppStore(makeDeps({ projectRepository: failing }));
    await failingStore.getState().boot();

    const state = failingStore.getState();
    expect(state.error).toMatch(/Could not load the saved project/);
    expect(state.error).toMatch(/stored document failed validation/);
    expect(state.saveState).toBe("error");
    expect(state.project?.title).toBe("Untitled Exhibition");
  });

  it("save validates before writing, so an invalid document cannot persist", async () => {
    const project = store.getState().project!;
    const invalid = { ...project, title: "" };

    await expect(repository.save(invalid)).rejects.toThrow();
  });

  it("createProject opens a new, blank, roomless project and lists it alongside the original", async () => {
    const originalId = store.getState().project!.id;

    await store.getState().createProject("Winter Show");

    const state = store.getState();
    expect(state.project?.title).toBe("Winter Show");
    expect(state.project?.id).not.toBe(originalId);
    expect(state.project?.floor.rooms).toEqual([]);
    expect(state.wallContextId).toBeNull();
    expect(state.undoStack).toHaveLength(0);

    const summaries = await state.listProjectSummaries();
    expect(summaries.map((summary) => summary.title).sort()).toEqual([
      "Untitled Exhibition",
      "Winter Show"
    ]);
  });

  it("openProject switches the current document and resets edit history", async () => {
    const original = store.getState().project!;
    await store.getState().createProject("Winter Show");

    await store.getState().openProject(original.id);

    const state = store.getState();
    expect(state.project?.id).toBe(original.id);
    expect(state.wallContextId).toBe("wall-north");
    expect(state.undoStack).toHaveLength(0);
  });

  it("openProject is a no-op when the requested project is already open", async () => {
    const project = store.getState().project!;
    await store.getState().resizeSelectedWall(9_000);
    expect(store.getState().undoStack).toHaveLength(1);

    await store.getState().openProject(project.id);

    // Re-opening the already-open project must not reset the edit history
    // that was just built up.
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("deleteProject removes a non-open project without touching the current one", async () => {
    const original = store.getState().project!;
    await store.getState().createProject("Winter Show");
    const winterShow = store.getState().project!;
    await store.getState().openProject(original.id);

    await store.getState().deleteProject(winterShow.id);

    expect(repository.projects.has(winterShow.id)).toBe(false);
    expect(store.getState().project?.id).toBe(original.id);
  });

  it("deleteProject falls back to another saved project when the open one is deleted", async () => {
    const original = store.getState().project!;
    await store.getState().createProject("Winter Show");

    await store.getState().deleteProject(original.id);

    const state = store.getState();
    expect(repository.projects.has(original.id)).toBe(false);
    expect(state.project?.title).toBe("Winter Show");
  });

  it("deleteProject creates a fresh blank project when the last one is deleted", async () => {
    const original = store.getState().project!;

    await store.getState().deleteProject(original.id);

    const state = store.getState();
    expect(repository.projects.has(original.id)).toBe(false);
    expect(state.project?.floor.rooms).toEqual([]);
    expect(repository.projects.size).toBe(1);
  });

  describe("addArtworksFromFiles", () => {
    it("uploads two files as two library records with three blobs each, in one undo entry", async () => {
      const files = [makeImageFile("one.jpg"), makeImageFile("two.png", "image/png")];

      await store.getState().addArtworksFromFiles(files);

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.intakeState).toBe("idle");
      expect(state.undoStack).toHaveLength(1);
      expect(state.undoStack[0].label).toBe("Add 2 artworks");
      expect(artworkLibraryRepository.artworks.size).toBe(2);
      expect(assetRepository.assets.size).toBe(2);
      expect(state.libraryArtworks).toHaveLength(2);

      const newIds = state.project!.checklistArtworkIds;
      expect(newIds).toHaveLength(2);

      for (const id of newIds) {
        const artwork = artworkLibraryRepository.artworks.get(id)!;
        expect(artwork.assetId).toBeDefined();
        const asset = assetRepository.assets.get(artwork.assetId!)!;
        expect(await assetRepository.getBlob(asset.originalKey)).toBeInstanceOf(Blob);
        expect(await assetRepository.getBlob(asset.displayKey)).toBeInstanceOf(Blob);
        expect(await assetRepository.getBlob(asset.thumbnailKey)).toBeInstanceOf(Blob);
      }

      const titles = newIds
        .map((id) => artworkLibraryRepository.artworks.get(id)!.title)
        .sort();
      expect(titles).toEqual(["one", "two"]);
    });

    it("undo removes checklist membership but keeps the library records and assets; redo restores membership without duplicating them", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("keeper.jpg")]);

      const afterUpload = store.getState();
      const artworkId = afterUpload.project!.checklistArtworkIds[0];
      expect(artworkLibraryRepository.artworks.size).toBe(1);
      expect(assetRepository.assets.size).toBe(1);

      await store.getState().undo();

      const afterUndo = store.getState();
      expect(afterUndo.project!.checklistArtworkIds).not.toContain(artworkId);
      expect(artworkLibraryRepository.artworks.has(artworkId)).toBe(true);
      expect(assetRepository.assets.size).toBe(1);

      await store.getState().redo();

      const afterRedo = store.getState();
      expect(afterRedo.project!.checklistArtworkIds).toContain(artworkId);
      expect(artworkLibraryRepository.artworks.size).toBe(1);
      expect(assetRepository.assets.size).toBe(1);
    });

    it("contains a per-file validation failure: the good file is checklisted, the bad one is reported", async () => {
      const goodFile = makeImageFile("good.jpg");
      const badFile = makeImageFile("bad.gif", "image/gif");

      await store.getState().addArtworksFromFiles([goodFile, badFile]);

      const state = store.getState();
      expect(state.intakeState).toBe("idle");
      expect(state.undoStack).toHaveLength(1);
      expect(state.project!.checklistArtworkIds).toHaveLength(1);
      expect(artworkLibraryRepository.artworks.size).toBe(1);
      expect(state.error).toMatch(/1 of 2 images could not be added/);
      expect(state.error).toMatch(/bad\.gif/);
      expect(state.error).toMatch(/not a supported image type/);

      // The bad file never reached the processor at all.
      expect(imageProcessor.processedFilenames).toEqual(["good.jpg"]);
    });

    it("contains a per-file processor failure: the good file is checklisted, the throwing one is reported", async () => {
      imageProcessor = new FakeImageProcessor(new Set(["broken.jpg"]));
      store = createAppStore(makeDeps());
      await store.getState().boot();

      const goodFile = makeImageFile("good.jpg");
      const brokenFile = makeImageFile("broken.jpg");

      await store.getState().addArtworksFromFiles([goodFile, brokenFile]);

      const state = store.getState();
      expect(state.intakeState).toBe("idle");
      expect(state.undoStack).toHaveLength(1);
      expect(state.project!.checklistArtworkIds).toHaveLength(1);
      expect(artworkLibraryRepository.artworks.size).toBe(1);
      expect(state.error).toMatch(/1 of 2 images could not be added/);
      expect(state.error).toMatch(/broken\.jpg/);
    });

    it("is a no-op for an empty file list: no undo entry, no error", async () => {
      const before = store.getState().project;

      await store.getState().addArtworksFromFiles([]);

      const state = store.getState();
      expect(state.project).toBe(before);
      expect(state.undoStack).toHaveLength(0);
      expect(state.error).toBeNull();
      expect(state.intakeState).toBe("idle");
    });

    it("is a no-op when no project is open", async () => {
      const freshStore = createAppStore(makeDeps());

      await freshStore.getState().addArtworksFromFiles([makeImageFile("orphan.jpg")]);

      expect(artworkLibraryRepository.artworks.size).toBe(0);
      expect(freshStore.getState().project).toBeNull();
    });
  });

  describe("importArtworkDrafts", () => {
    it("imports selected metadata drafts, processes matched images, and commits checklist membership once", async () => {
      const image = makeImageFile("mona-lisa.jpg");
      const draft: ArtworkImportDraft = {
        id: "draft-1",
        row: { sourceRowIndex: 2, values: ["Mona Lisa"] },
        artwork: {
          id: "imported-artwork-1",
          schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
          title: "Mona Lisa",
          artist: "Leonardo da Vinci",
          date: "c. 1503-1506",
          dimensions: { status: "known", widthMm: 530, heightMm: 770 },
          metadata: { sourceFilename: "metadata.csv", sourceRow: 2 }
        },
        imageFile: image,
        imageMatch: { status: "matched", file: image, score: 100, reason: "exact filename" },
        warnings: [],
        raw: { title: "Mona Lisa" },
        selected: true
      };

      await store.getState().importArtworkDrafts([draft]);

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.undoStack).toHaveLength(1);
      expect(state.undoStack.at(-1)?.label).toBe("Import artwork");
      expect(state.project!.checklistArtworkIds).toEqual(["imported-artwork-1"]);
      expect(state.libraryArtworks).toHaveLength(1);
      expect(artworkLibraryRepository.artworks.get("imported-artwork-1")?.assetId).toBeDefined();
      expect(assetRepository.assets.size).toBe(1);
      expect(imageProcessor.processedFilenames).toEqual(["mona-lisa.jpg"]);
    });

    it("imports metadata-only rows even when no image is attached", async () => {
      const draft: ArtworkImportDraft = {
        id: "draft-1",
        row: { sourceRowIndex: 2, values: ["Untitled"] },
        artwork: {
          id: "metadata-only-artwork",
          schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
          title: "Untitled",
          dimensions: { status: "unknown" },
          metadata: { sourceFilename: "metadata.csv", sourceRow: 2 }
        },
        imageMatch: { status: "none", candidates: [] },
        warnings: [{ field: "image", message: "No image matched this row." }],
        raw: { title: "Untitled" },
        selected: true
      };

      await store.getState().importArtworkDrafts([draft]);

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.project!.checklistArtworkIds).toEqual(["metadata-only-artwork"]);
      expect(artworkLibraryRepository.artworks.get("metadata-only-artwork")?.assetId).toBeUndefined();
      expect(assetRepository.assets.size).toBe(0);
    });
  });

  describe("upload duplicate detection", () => {
    // Rebuilds the store with a processor that pins a shared sha256 across the
    // named files, so intake sees them as content-identical.
    async function useSharedHash(names: string[], sha: string): Promise<void> {
      imageProcessor = new FakeImageProcessor(
        new Set(),
        new Map(names.map((name) => [name, sha]))
      );
      store = createAppStore(makeDeps());
      await store.getState().boot();
    }

    it("holds an upload whose sha256 matches an existing checklist asset", async () => {
      await useSharedHash(["twin-a.jpg", "twin-b.jpg"], "shared-sha");

      await store.getState().addArtworksFromFiles([makeImageFile("twin-a.jpg")]);
      const countAfterFirst = store.getState().libraryArtworks.length;

      await store.getState().addArtworksFromFiles([makeImageFile("twin-b.jpg")]);

      const state = store.getState();
      expect(state.libraryArtworks).toHaveLength(countAfterFirst);
      expect(state.pendingDuplicateUploads).toHaveLength(1);
      expect(state.pendingDuplicateUploads[0].existingArtworkTitle).toBe("twin-a");
      expect(state.pendingDuplicateUploads[0].file.name).toBe("twin-b.jpg");
    });

    it("catches a twin within one batch", async () => {
      await useSharedHash(["twin-a.jpg", "twin-b.jpg"], "shared-sha");

      await store
        .getState()
        .addArtworksFromFiles([makeImageFile("twin-a.jpg"), makeImageFile("twin-b.jpg")]);

      const state = store.getState();
      expect(state.libraryArtworks).toHaveLength(1);
      expect(state.pendingDuplicateUploads).toHaveLength(1);
      expect(state.pendingDuplicateUploads[0].existingArtworkTitle).toBe("twin-a");
    });

    it("intakes non-duplicates in a mixed batch and holds only the duplicate", async () => {
      await useSharedHash(["twin-a.jpg", "twin-b.jpg"], "shared-sha");

      await store.getState().addArtworksFromFiles([makeImageFile("twin-a.jpg")]);
      const countAfterFirst = store.getState().libraryArtworks.length;

      await store
        .getState()
        .addArtworksFromFiles([makeImageFile("twin-b.jpg"), makeImageFile("fresh.jpg")]);

      const state = store.getState();
      expect(state.libraryArtworks).toHaveLength(countAfterFirst + 1);
      expect(state.libraryArtworks.some((a) => a.title === "fresh")).toBe(true);
      expect(state.pendingDuplicateUploads).toHaveLength(1);
      expect(state.pendingDuplicateUploads[0].existingArtworkTitle).toBe("twin-a");
    });

    it("confirmDuplicateUploads intakes the held files in one undo entry; pending clears", async () => {
      await useSharedHash(["twin-a.jpg", "twin-b.jpg"], "shared-sha");

      await store.getState().addArtworksFromFiles([makeImageFile("twin-a.jpg")]);
      await store.getState().addArtworksFromFiles([makeImageFile("twin-b.jpg")]);
      const countBeforeConfirm = store.getState().libraryArtworks.length;
      const checklistBefore = store.getState().project!.checklistArtworkIds.length;
      const undoBefore = store.getState().undoStack.length;

      await store.getState().confirmDuplicateUploads();

      const state = store.getState();
      expect(state.pendingDuplicateUploads).toHaveLength(0);
      expect(state.libraryArtworks).toHaveLength(countBeforeConfirm + 1);
      expect(state.project!.checklistArtworkIds).toHaveLength(checklistBefore + 1);
      expect(state.undoStack).toHaveLength(undoBefore + 1);
    });

    it("dismissDuplicateUploads drops the held files and touches no undo state", async () => {
      await useSharedHash(["twin-a.jpg", "twin-b.jpg"], "shared-sha");

      await store.getState().addArtworksFromFiles([makeImageFile("twin-a.jpg")]);
      await store.getState().addArtworksFromFiles([makeImageFile("twin-b.jpg")]);
      const countBeforeDismiss = store.getState().libraryArtworks.length;
      const undoBefore = store.getState().undoStack.length;

      store.getState().dismissDuplicateUploads();

      const state = store.getState();
      expect(state.pendingDuplicateUploads).toHaveLength(0);
      expect(state.libraryArtworks).toHaveLength(countBeforeDismiss);
      expect(state.undoStack).toHaveLength(undoBefore);
    });

    it("a library asset without a sha256 never matches", async () => {
      // A legacy asset predates sha256. Intake one, strip its stored hash, then
      // upload a content-identical file: with no hash on record it can't match,
      // and reading the sha-less asset must not throw.
      await useSharedHash(["legacy.jpg", "other.jpg"], "shared-sha");

      await store.getState().addArtworksFromFiles([makeImageFile("legacy.jpg")]);
      const countAfterFirst = store.getState().libraryArtworks.length;
      for (const asset of assetRepository.assets.values()) delete asset.sha256;

      await store.getState().addArtworksFromFiles([makeImageFile("other.jpg")]);

      const state = store.getState();
      expect(state.pendingDuplicateUploads).toHaveLength(0);
      expect(state.libraryArtworks).toHaveLength(countAfterFirst + 1);
    });

    it("does not hold a re-upload of a work removed from the checklist: the screen compares against the checklist, not the whole library", async () => {
      await useSharedHash(["piece.jpg", "piece-again.jpg"], "shared-sha");

      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const countAfterFirst = store.getState().libraryArtworks.length;

      await store.getState().removeArtworkFromChecklist(artworkId);

      await store.getState().addArtworksFromFiles([makeImageFile("piece-again.jpg")]);

      const state = store.getState();
      expect(state.pendingDuplicateUploads).toHaveLength(0);
      expect(state.libraryArtworks).toHaveLength(countAfterFirst + 1);
      expect(state.project!.checklistArtworkIds).toHaveLength(1);
    });

    it("clears pending holds when the project is replaced", async () => {
      await useSharedHash(["twin-a.jpg", "twin-b.jpg"], "shared-sha");

      await store.getState().addArtworksFromFiles([makeImageFile("twin-a.jpg")]);
      await store.getState().addArtworksFromFiles([makeImageFile("twin-b.jpg")]);
      expect(store.getState().pendingDuplicateUploads).toHaveLength(1);

      await store.getState().createProject("Another Show");

      expect(store.getState().pendingDuplicateUploads).toHaveLength(0);
    });
  });

  describe("removeArtworkFromChecklist", () => {
    it("removes checklist membership and any artwork wallObjects, but leaves the library record intact", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];

      // Defensive coverage per docs/plan.md §4.1 — placements don't exist in
      // the UI yet, but the action should still clean up a dangling one.
      await applyPlacementDirectly(repository, store, artworkId);

      await store.getState().removeArtworkFromChecklist(artworkId);

      const state = store.getState();
      expect(state.project!.checklistArtworkIds).not.toContain(artworkId);
      expect(state.project!.wallObjects).toHaveLength(0);
      expect(artworkLibraryRepository.artworks.has(artworkId)).toBe(true);
      expect(assetRepository.assets.size).toBe(1);
    });

    it("is a no-op when the artwork is not on the checklist and not placed", async () => {
      const before = store.getState().project;

      await store.getState().removeArtworkFromChecklist("never-added");

      const state = store.getState();
      expect(state.project).toBe(before);
      expect(state.undoStack).toHaveLength(0);
    });
  });

  describe("updateArtwork", () => {
    it("edits metadata, persists it, and undo/redo round-trip the library record", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().updateArtwork(artworkId, { title: "Untitled No. 4" });

      let state = store.getState();
      expect(state.error).toBeNull();
      expect(state.libraryArtworks.find((a) => a.id === artworkId)?.title).toBe(
        "Untitled No. 4"
      );
      expect(artworkLibraryRepository.artworks.get(artworkId)?.title).toBe("Untitled No. 4");
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);

      await store.getState().undo();
      state = store.getState();
      expect(state.libraryArtworks.find((a) => a.id === artworkId)?.title).toBe("piece");
      expect(artworkLibraryRepository.artworks.get(artworkId)?.title).toBe("piece");

      await store.getState().redo();
      state = store.getState();
      expect(state.libraryArtworks.find((a) => a.id === artworkId)?.title).toBe(
        "Untitled No. 4"
      );
    });

    it("syncs a placed artwork's placement size on a dimension edit, and one undo reverts both", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;

      await store.getState().placeArtwork(artworkId, wallId, 1000, 1450);
      const placementId = store.getState().project!.wallObjects[0].id;
      expect(store.getState().project!.wallObjects[0].widthMm).toBe(
        PLACEHOLDER_ARTWORK_WIDTH_MM
      );
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, status: "known" }
      });

      let state = store.getState();
      // One combined entry, not two — the artwork edit and the placement
      // resize it caused are a single undoable step (docs/plan.md §7).
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);
      let placement = state.project!.wallObjects.find((w) => w.id === placementId)!;
      expect(placement.widthMm).toBe(500);
      expect(placement.heightMm).toBe(400);
      expect(state.libraryArtworks.find((a) => a.id === artworkId)?.dimensions.widthMm).toBe(
        500
      );

      await store.getState().undo();
      state = store.getState();
      placement = state.project!.wallObjects.find((w) => w.id === placementId)!;
      expect(placement.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
      expect(placement.heightMm).toBe(PLACEHOLDER_ARTWORK_HEIGHT_MM);
      expect(
        state.libraryArtworks.find((a) => a.id === artworkId)?.dimensions.widthMm
      ).toBeUndefined();
    });

    it("leaves a placement's displayDimensionsOverride alone on a dimension edit", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(artworkId, wallId, 1000, 1450);
      const placementId = store.getState().project!.wallObjects[0].id;

      // No store action creates an override yet (a later milestone) — set
      // one directly to prove updateArtwork respects it when present.
      const projectWithOverride: Project = {
        ...store.getState().project!,
        wallObjects: store.getState().project!.wallObjects.map((wallObject) =>
          wallObject.id === placementId
            ? {
                ...wallObject,
                displayDimensionsOverride: {
                  widthMm: 300,
                  heightMm: 300,
                  status: "known" as const
                }
              }
            : wallObject
        )
      };
      await repository.save(projectWithOverride);
      store.setState({ project: projectWithOverride });

      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, status: "known" }
      });

      const placement = store
        .getState()
        .project!.wallObjects.find((wallObject) => wallObject.id === placementId)!;
      expect(placement.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
      expect(placement.heightMm).toBe(PLACEHOLDER_ARTWORK_HEIGHT_MM);
    });

    it("errors calmly on an invalid change: nothing persists, no undo entry", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const undoStackBefore = store.getState().undoStack.length;
      const titleBefore = store.getState().libraryArtworks.find(
        (a) => a.id === artworkId
      )!.title;

      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: -10, status: "known" }
      });

      const state = store.getState();
      expect(state.error).toBeTruthy();
      expect(state.undoStack).toHaveLength(undoStackBefore);
      expect(state.libraryArtworks.find((a) => a.id === artworkId)?.title).toBe(titleBefore);
      expect(
        artworkLibraryRepository.artworks.get(artworkId)?.dimensions.widthMm
      ).toBeUndefined();
    });

    it("is a no-op (no undo entry) when nothing actually changes", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const titleBefore = store.getState().libraryArtworks.find(
        (a) => a.id === artworkId
      )!.title;
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().updateArtwork(artworkId, { title: titleBefore });

      expect(store.getState().undoStack).toHaveLength(undoStackBefore);
    });
  });

  describe("placeArtwork", () => {
    it("appends a center-anchored wall object sized from the artwork's known dimensions", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, status: "known" }
      });
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;

      await store.getState().placeArtwork(artworkId, wallId, 1200, 1450);

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Place artwork");
      const placement = state.project!.wallObjects[0];
      expect(placement.kind).toBe("artwork");
      expect(placement.wallId).toBe(wallId);
      expect(placement.xMm).toBe(1200);
      expect(placement.yMm).toBe(1450);
      expect(placement.widthMm).toBe(500);
      expect(placement.heightMm).toBe(400);
      expect(getSelectedArtworkId(state.project, state.selection)).toBe(artworkId);
    });

    it("falls back to placeholder dimensions for an artwork with unknown dims", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;

      await store.getState().placeArtwork(artworkId, wallId, 0, 1450);

      const placement = store.getState().project!.wallObjects[0];
      expect(placement.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
      expect(placement.heightMm).toBe(PLACEHOLDER_ARTWORK_HEIGHT_MM);
    });

    it("flags but still places an out-of-bounds placement", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;

      await store.getState().placeArtwork(artworkId, wallId, -5_000, 1450);

      const state = store.getState();
      expect(state.project!.wallObjects).toHaveLength(1);
      expect(state.placementWarnings).toHaveLength(1);
      expect(state.placementWarnings[0].wallId).toBe(wallId);
    });
  });

  describe("moveArtworkPlacement", () => {
    it("commits one undo entry and undo restores the previous position", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(artworkId, wallId, 1000, 1450);
      const placementId = store.getState().project!.wallObjects[0].id;
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().moveArtworkPlacement(placementId, 2000, 1600);

      let state = store.getState();
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);
      let placement = state.project!.wallObjects.find((w) => w.id === placementId)!;
      expect(placement.xMm).toBe(2000);
      expect(placement.yMm).toBe(1600);

      await store.getState().undo();
      state = store.getState();
      placement = state.project!.wallObjects.find((w) => w.id === placementId)!;
      expect(placement.xMm).toBe(1000);
      expect(placement.yMm).toBe(1450);
    });

    it("is a no-op when the position is unchanged", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(artworkId, wallId, 1000, 1450);
      const placementId = store.getState().project!.wallObjects[0].id;
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().moveArtworkPlacement(placementId, 1000, 1450);

      expect(store.getState().undoStack).toHaveLength(undoStackBefore);
    });
  });

  describe("removePlacement", () => {
    it("removes the wall object but keeps checklist membership", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(artworkId, wallId, 1000, 1450);
      const placementId = store.getState().project!.wallObjects[0].id;

      await store.getState().removePlacement(placementId);

      const state = store.getState();
      expect(state.project!.wallObjects).toHaveLength(0);
      expect(state.project!.checklistArtworkIds).toContain(artworkId);
    });
  });

  it("revalidates a placed artwork's bounds when its wall is later resized shorter", async () => {
    await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
    const artworkId = store.getState().project!.checklistArtworkIds[0];
    await store.getState().updateArtwork(artworkId, {
      dimensions: { widthMm: 500, heightMm: 400, status: "known" }
    });
    const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

    // Comfortably inside today's wall length, near the far end.
    await store.getState().placeArtwork(artworkId, wall.id, wall.lengthMm - 300, 1450);
    expect(store.getState().placementWarnings).toHaveLength(0);

    await store.getState().resizeWall(wall.id, feetToMm(5));

    const state = store.getState();
    expect(state.placementWarnings).toHaveLength(1);
    expect(state.placementWarnings[0].wallId).toBe(wall.id);
  });

  describe("addOpening", () => {
    it("adds a door centered on the wall, reaching the floor, in one undo entry", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

      await store.getState().addOpening(wall.id, "door");

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Add door");
      const opening = state.project!.wallObjects[0];
      expect(opening.kind).toBe("door");
      expect(opening.wallId).toBe(wall.id);
      expect(opening.xMm).toBeCloseTo(wall.lengthMm / 2);
      expect(opening.yMm - opening.heightMm / 2).toBeCloseTo(0);
      expect((opening as { blocksPlacement: true }).blocksPlacement).toBe(true);
      expect(getSelectedOpeningId(state.project, state.selection)).toBe(opening.id);
    });

    it("adds a window centered on the wall's centerline height", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

      await store.getState().addOpening(wall.id, "window");

      const state = store.getState();
      const opening = state.project!.wallObjects[0];
      expect(opening.kind).toBe("window");
      expect(opening.yMm).toBeCloseTo(state.project!.defaultCenterlineHeightMm);
    });

    it("adds a blocked zone", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

      await store.getState().addOpening(wall.id, "blocked-zone");

      expect(store.getState().project!.wallObjects[0].kind).toBe("blocked-zone");
    });

    it("is a no-op for an unknown wall id", async () => {
      const before = store.getState().project;

      await store.getState().addOpening("no-such-wall", "door");

      expect(store.getState().project).toBe(before);
      expect(store.getState().undoStack).toHaveLength(0);
    });
  });

  describe("moveOpening", () => {
    it("commits one undo entry and undo restores the previous position", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().addOpening(wall.id, "window");
      const openingId = store.getState().project!.wallObjects[0].id;
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().moveOpening(openingId, 2000, 1600);

      let state = store.getState();
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);
      expect(state.undoStack.at(-1)?.label).toBe("Move window");
      let opening = state.project!.wallObjects.find((o) => o.id === openingId)!;
      expect(opening.xMm).toBe(2000);
      expect(opening.yMm).toBe(1600);

      await store.getState().undo();
      state = store.getState();
      opening = state.project!.wallObjects.find((o) => o.id === openingId)!;
      expect(opening.xMm).not.toBe(2000);
    });

    it("is a no-op when the position is unchanged", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().addOpening(wall.id, "window");
      const opening = store.getState().project!.wallObjects[0];
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().moveOpening(opening.id, opening.xMm, opening.yMm);

      expect(store.getState().undoStack).toHaveLength(undoStackBefore);
    });
  });

  describe("resizeOpening", () => {
    it("resizes an opening about its own center and is undoable", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().addOpening(wall.id, "window");
      const openingId = store.getState().project!.wallObjects[0].id;
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().resizeOpening(openingId, 1500, 1000);

      let state = store.getState();
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);
      let opening = state.project!.wallObjects.find((o) => o.id === openingId)!;
      expect(opening.widthMm).toBe(1500);
      expect(opening.heightMm).toBe(1000);

      await store.getState().undo();
      state = store.getState();
      opening = state.project!.wallObjects.find((o) => o.id === openingId)!;
      expect(opening.widthMm).not.toBe(1500);
    });
  });

  describe("removePlacement for an opening", () => {
    it("deletes the opening (the same generic action used for artwork)", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().addOpening(wall.id, "door");
      const openingId = store.getState().project!.wallObjects[0].id;

      await store.getState().removePlacement(openingId);

      expect(store.getState().project!.wallObjects).toHaveLength(0);
    });
  });

  describe("collision between artwork and openings", () => {
    it("rejects placing an artwork onto a door by default, leaving the project untouched", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, status: "known" }
      });
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

      await store.getState().addOpening(wall.id, "door");
      const door = store.getState().project!.wallObjects[0];
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().placeArtwork(artworkId, wall.id, door.xMm, door.yMm);

      const state = store.getState();
      expect(state.project!.wallObjects).toHaveLength(1);
      expect(state.undoStack).toHaveLength(undoStackBefore);
      expect(state.error).toBeTruthy();
    });

    it("rejects moving a door onto an existing artwork by default", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().placeArtwork(artworkId, wall.id, 1000, 1450, true);
      const artwork = store.getState().project!.wallObjects[0];

      await store.getState().addOpening(wall.id, "door");
      const door = store.getState().project!.wallObjects[1];
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().moveOpening(door.id, artwork.xMm, artwork.yMm);

      const state = store.getState();
      const doorAfter = state.project!.wallObjects.find((o) => o.id === door.id)!;
      expect(doorAfter.xMm).toBe(door.xMm);
      expect(doorAfter.yMm).toBe(door.yMm);
      expect(state.undoStack).toHaveLength(undoStackBefore);
      expect(state.error).toBeTruthy();
    });

    it("allows the overlap when allowOverlap is true, and still surfaces a warning", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, status: "known" }
      });
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

      await store.getState().addOpening(wall.id, "door");
      const doorId = store.getState().project!.wallObjects[0].id;
      const door = store.getState().project!.wallObjects[0];

      await store.getState().placeArtwork(artworkId, wall.id, door.xMm, door.yMm, true);

      expect(store.getState().project!.wallObjects).toHaveLength(2);
      expect(store.getState().placementWarnings).toEqual([
        expect.objectContaining({ message: "Placement overlaps another object on this wall." })
      ]);

      await store.getState().moveOpening(doorId, door.xMm + 2000, door.yMm, true);

      // moveOpening only revalidates the door itself, so its own warning
      // clears — proving the collision check is symmetric and re-run live,
      // not a stale flag left over from the artwork's placement.
      expect(store.getState().placementWarnings).toEqual([]);
    });
  });

  describe("selection", () => {
    // selectOpening now validates against the live project (a dead id is a
    // no-op), so these tests place a real opening instead of a made-up id.
    async function addRealOpening(): Promise<string> {
      await store.getState().addOpening("wall-north", "door");
      return store.getState().project!.wallObjects.find((object) => object.kind === "door")!.id;
    }

    it("selectWall clears any selected artwork", () => {
      store.getState().selectArtwork("some-artwork");
      expect(
        getSelectedArtworkId(store.getState().project, store.getState().selection)
      ).toBe("some-artwork");

      store.getState().selectWall("wall-east");

      expect(store.getState().wallContextId).toBe("wall-east");
      expect(
        getSelectedArtworkId(store.getState().project, store.getState().selection)
      ).toBeNull();
    });

    it("selectArtwork sets the selected artwork without touching the selected wall", () => {
      const wallId = store.getState().wallContextId;

      store.getState().selectArtwork("artwork-x");

      expect(
        getSelectedArtworkId(store.getState().project, store.getState().selection)
      ).toBe("artwork-x");
      expect(store.getState().wallContextId).toBe(wallId);
    });

    it("selectOpening clears the selected artwork but not the selected wall", async () => {
      const openingId = await addRealOpening();
      const wallId = store.getState().wallContextId;
      store.getState().selectArtwork("some-artwork");
      expect(
        getSelectedArtworkId(store.getState().project, store.getState().selection)
      ).toBe("some-artwork");

      store.getState().selectOpening(openingId);

      expect(
        getSelectedOpeningId(store.getState().project, store.getState().selection)
      ).toBe(openingId);
      expect(
        getSelectedArtworkId(store.getState().project, store.getState().selection)
      ).toBeNull();
      expect(store.getState().wallContextId).toBe(wallId);
    });

    it("selectWall clears the selected opening", async () => {
      const openingId = await addRealOpening();
      store.getState().selectOpening(openingId);
      expect(
        getSelectedOpeningId(store.getState().project, store.getState().selection)
      ).toBe(openingId);

      store.getState().selectWall("wall-east");

      expect(
        getSelectedOpeningId(store.getState().project, store.getState().selection)
      ).toBeNull();
    });

    it("selectArtwork clears the selected opening", async () => {
      const openingId = await addRealOpening();
      store.getState().selectOpening(openingId);

      store.getState().selectArtwork("some-artwork");

      expect(
        getSelectedOpeningId(store.getState().project, store.getState().selection)
      ).toBeNull();
    });

    it("selectRoom clears the selected wall, artwork, opening, and multi-select", async () => {
      const openingId = await addRealOpening();
      store.getState().selectOpening(openingId);

      store.getState().selectRoom("room-main");

      const state = store.getState();
      expect(roomIdOf(state.selection)).toBe("room-main");
      expect(state.wallContextId).toBeNull();
      expect(getSelectedArtworkId(state.project, state.selection)).toBeNull();
      expect(getSelectedOpeningId(state.project, state.selection)).toBeNull();
      expect(objectIdsOf(state.selection)).toEqual([]);
    });

    it("selectWall clears the selected room", () => {
      store.getState().selectRoom("room-main");

      store.getState().selectWall("wall-east");

      expect(roomIdOf(store.getState().selection)).toBeNull();
    });

    it("selectArtwork clears the selected room", () => {
      store.getState().selectRoom("room-main");

      store.getState().selectArtwork("some-artwork");

      expect(roomIdOf(store.getState().selection)).toBeNull();
    });

    it("selectOpening clears the selected room", async () => {
      const openingId = await addRealOpening();
      store.getState().selectRoom("room-main");

      store.getState().selectOpening(openingId);

      expect(roomIdOf(store.getState().selection)).toBeNull();
    });

    it("clearObjectSelection clears the selected room even with no objects selected", () => {
      store.getState().selectRoom("room-main");

      store.getState().clearObjectSelection();

      expect(roomIdOf(store.getState().selection)).toBeNull();
    });
  });

  describe("placeOpeningFromPlan", () => {
    it("places a wall opening at the plan-chosen xMm with addOpening's defaults", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

      await store.getState().placeOpeningFromPlan("door", {
        anchor: "wall",
        wallId: wall.id,
        xMm: 1234
      });

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Add door");
      const opening = state.project!.wallObjects[0];
      expect(opening.kind).toBe("door");
      expect(opening.wallId).toBe(wall.id);
      expect(opening.xMm).toBe(1234);
      // Same defaults addOpening uses: a door reaches the floor.
      expect(opening.yMm - opening.heightMm / 2).toBeCloseTo(0);
      expect(getSelectedOpeningId(state.project, state.selection)).toBe(opening.id);
      expect(state.project!.floorObjects).toHaveLength(0);
    });

    it("places a blocked zone on the floor, remembering its wall centerline height", async () => {
      const centerline = store.getState().project!.defaultCenterlineHeightMm;

      await store.getState().placeOpeningFromPlan("blocked-zone", {
        anchor: "floor",
        xMm: 2000,
        yMm: 3000
      });

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Add blocked zone");
      expect(state.project!.wallObjects).toHaveLength(0);
      const floorObject = state.project!.floorObjects[0];
      expect(floorObject.kind).toBe("blocked-zone");
      expect(floorObject.xMm).toBe(2000);
      expect(floorObject.yMm).toBe(3000);
      expect(floorObject.depthMm).toBe(DEFAULT_FLOOR_OBJECT_DEPTH_MM);
      expect(floorObject.rotationDeg).toBe(0);
      expect(floorObject.wallYMm).toBeCloseTo(centerline);
      expect(getSelectedOpeningId(state.project, state.selection)).toBe(floorObject.id);
    });

    it("rejects placing a door on the floor", async () => {
      await expect(
        store.getState().placeOpeningFromPlan("door", { anchor: "floor", xMm: 0, yMm: 0 })
      ).rejects.toThrow(/floor/);
      expect(store.getState().project!.floorObjects).toHaveLength(0);
    });

    it("rejects placing a window on the floor", async () => {
      await expect(
        store.getState().placeOpeningFromPlan("window", { anchor: "floor", xMm: 0, yMm: 0 })
      ).rejects.toThrow(/floor/);
      expect(store.getState().project!.floorObjects).toHaveLength(0);
    });
  });

  describe("placeArtworkOnFloor", () => {
    it("creates a floor artwork sized from the artwork, with depth and wall height, and selects it", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, depthMm: 120, status: "known" }
      });
      const centerline = store.getState().project!.defaultCenterlineHeightMm;

      await store.getState().placeArtworkOnFloor(artworkId, 1500, 2500);

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Place artwork");
      const floorObject = state.project!.floorObjects[0];
      expect(floorObject.kind).toBe("artwork");
      expect((floorObject as { artworkId: string }).artworkId).toBe(artworkId);
      expect(floorObject.xMm).toBe(1500);
      expect(floorObject.yMm).toBe(2500);
      expect(floorObject.widthMm).toBe(500);
      expect(floorObject.heightMm).toBe(400);
      expect(floorObject.depthMm).toBe(120);
      expect(floorObject.rotationDeg).toBe(0);
      expect(floorObject.wallYMm).toBeCloseTo(centerline);
      expect(getSelectedArtworkId(state.project, state.selection)).toBe(artworkId);
    });

    it("falls back to the default depth when the artwork's depth is unknown", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];

      await store.getState().placeArtworkOnFloor(artworkId, 0, 0);

      const floorObject = store.getState().project!.floorObjects[0];
      expect(floorObject.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
      expect(floorObject.heightMm).toBe(PLACEHOLDER_ARTWORK_HEIGHT_MM);
      expect(floorObject.depthMm).toBe(DEFAULT_FLOOR_OBJECT_DEPTH_MM);
    });
  });

  describe("placement uniqueness", () => {
    it("placeArtwork rejects an artwork that already has a wall placement", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;

      await store.getState().placeArtwork(artworkId, wallId, 4000, 1500);
      const placementsBefore = store.getState().project!.wallObjects.length;

      await store.getState().placeArtwork(artworkId, wallId, 6000, 1500);

      expect(store.getState().project!.wallObjects.length).toBe(placementsBefore);
      expect(store.getState().error).toMatch(/already placed/i);
    });

    it("placeArtworkOnFloor rejects an artwork already placed on a wall (and vice versa)", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;

      await store.getState().placeArtwork(artworkId, wallId, 4000, 1500);
      await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);

      expect(store.getState().project!.floorObjects).toHaveLength(0);
      expect(store.getState().error).toMatch(/already placed/i);
    });

    it("a legacy project with duplicate placements still loads and its members still move", async () => {
      // Place once through the store to get a schema-valid wall object, then
      // clone it (fresh id, same artworkId) so the imported project already
      // contains a duplicate the guard would otherwise forbid.
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(artworkId, wallId, 4000, 1500);

      const seeded = store.getState().project!;
      const original = seeded.wallObjects[0];
      const duplicate = { ...original, id: "legacy-duplicate", xMm: 6000 };
      const legacyProject: Project = {
        ...seeded,
        id: "legacy-dup-project",
        title: "Legacy Duplicates",
        wallObjects: [original, duplicate]
      };

      await store.getState().importProjectJson(exportProjectJson(legacyProject));

      expect(store.getState().error).toBeNull();
      expect(store.getState().project!.wallObjects).toHaveLength(2);

      await store.getState().moveArtworkPlacement("legacy-duplicate", 7000, 1500);

      const moved = store
        .getState()
        .project!.wallObjects.find((o) => o.id === "legacy-duplicate")!;
      expect(moved.xMm).toBe(7000);
      expect(store.getState().error).toBeNull();
    });
  });

  describe("commitPlanMove", () => {
    async function placeArtworkOnWall(xMm = 1000, yMm = 1450) {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().placeArtwork(artworkId, wall.id, xMm, yMm);
      return {
        artworkId,
        wall,
        placementId: store.getState().project!.wallObjects[0].id
      };
    }

    it("moves an object along the same wall, keeping its height", async () => {
      const { placementId, wall } = await placeArtworkOnWall(1000, 1450);
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().commitPlanMove(placementId, {
        anchor: "wall",
        wallId: wall.id,
        xMm: 2000
      });

      const state = store.getState();
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);
      const placement = state.project!.wallObjects.find((o) => o.id === placementId)!;
      expect(placement.wallId).toBe(wall.id);
      expect(placement.xMm).toBe(2000);
      expect(placement.yMm).toBe(1450);
    });

    it("re-anchors an object onto a different wall, keeping yMm and size", async () => {
      const { placementId } = await placeArtworkOnWall(1000, 1450);
      const before = store.getState().project!.wallObjects.find((o) => o.id === placementId)!;

      await store.getState().commitPlanMove(placementId, {
        anchor: "wall",
        wallId: "wall-east",
        xMm: 800
      });

      const placement = store.getState().project!.wallObjects.find((o) => o.id === placementId)!;
      expect(placement.wallId).toBe("wall-east");
      expect(placement.xMm).toBe(800);
      expect(placement.yMm).toBe(1450);
      expect(placement.widthMm).toBe(before.widthMm);
      expect(placement.heightMm).toBe(before.heightMm);
    });

    it("converts a wall artwork to a floor object: same id, one undo entry, and undo restores the wall placement", async () => {
      const { placementId } = await placeArtworkOnWall(1000, 1450);
      const before = store.getState().project!.wallObjects.find((o) => o.id === placementId)!;
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().commitPlanMove(placementId, {
        anchor: "floor",
        xMm: 5000,
        yMm: 3000
      });

      let state = store.getState();
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);
      expect(state.project!.wallObjects).toHaveLength(0);
      const floorObject = state.project!.floorObjects[0];
      expect(floorObject.id).toBe(placementId);
      expect(floorObject.kind).toBe("artwork");
      expect(floorObject.xMm).toBe(5000);
      expect(floorObject.yMm).toBe(3000);
      // Remembered hang height + elevation height, for a later floor→wall trip.
      expect(floorObject.wallYMm).toBe(1450);
      expect(floorObject.heightMm).toBe(before.heightMm);

      await store.getState().undo();
      state = store.getState();
      expect(state.project!.floorObjects).toHaveLength(0);
      const restored = state.project!.wallObjects.find((o) => o.id === placementId)!;
      expect(restored.xMm).toBe(1000);
      expect(restored.yMm).toBe(1450);
    });

    it("converts a floor object back to a wall, restoring yMm from wallYMm", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().placeArtworkOnFloor(artworkId, 4000, 4000);
      const floorObject = store.getState().project!.floorObjects[0];
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

      await store.getState().commitPlanMove(floorObject.id, {
        anchor: "wall",
        wallId: wall.id,
        xMm: 1200
      });

      const state = store.getState();
      expect(state.project!.floorObjects).toHaveLength(0);
      const wallObject = state.project!.wallObjects.find((o) => o.id === floorObject.id)!;
      expect(wallObject.kind).toBe("artwork");
      expect(wallObject.wallId).toBe(wall.id);
      expect(wallObject.xMm).toBe(1200);
      expect(wallObject.yMm).toBe(floorObject.wallYMm);
      expect(wallObject.heightMm).toBe(floorObject.heightMm);
    });

    it("moves a floor object to a new floor position", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
      const floorId = store.getState().project!.floorObjects[0].id;

      await store.getState().commitPlanMove(floorId, { anchor: "floor", xMm: 7000, yMm: 8000 });

      const floorObject = store.getState().project!.floorObjects.find((o) => o.id === floorId)!;
      expect(floorObject.xMm).toBe(7000);
      expect(floorObject.yMm).toBe(8000);
    });

    it("rejects moving a door onto the floor", async () => {
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().addOpening(wall.id, "door");
      const doorId = store.getState().project!.wallObjects[0].id;

      await expect(
        store.getState().commitPlanMove(doorId, { anchor: "floor", xMm: 0, yMm: 0 })
      ).rejects.toThrow(/floor/);
      expect(store.getState().project!.floorObjects).toHaveLength(0);
      expect(store.getState().project!.wallObjects).toHaveLength(1);
    });
  });

  describe("updateFloorObject", () => {
    it("edits X/Y/Width/Depth in one undo entry", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
      const floorId = store.getState().project!.floorObjects[0].id;
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().updateFloorObject(floorId, { xMm: 1500, depthMm: 600 });

      const state = store.getState();
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);
      const floorObject = state.project!.floorObjects.find((o) => o.id === floorId)!;
      expect(floorObject.xMm).toBe(1500);
      expect(floorObject.depthMm).toBe(600);
      expect(floorObject.yMm).toBe(1000);
    });

    it("is a no-op when nothing changes", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
      const floorObject = store.getState().project!.floorObjects[0];
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().updateFloorObject(floorObject.id, {
        xMm: floorObject.xMm,
        depthMm: floorObject.depthMm
      });

      expect(store.getState().undoStack).toHaveLength(undoStackBefore);
    });
  });

  describe("multi-select", () => {
    async function placeArtworkOnWall(xMm = 1000, yMm = 1450, widthMm?: number) {
      await store.getState().addArtworksFromFiles([makeImageFile(`piece-${xMm}-${yMm}.jpg`)]);
      const artworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
      if (widthMm !== undefined) {
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm, heightMm: 400, status: "known" }
        });
      }
      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().placeArtwork(artworkId, wall.id, xMm, yMm, true);
      const placement = store.getState().project!.wallObjects.at(-1)!;
      return { artworkId, wall, placementId: placement.id };
    }

    describe("selectObject", () => {
      it("non-additive replaces the selection", async () => {
        const a = await placeArtworkOnWall(500, 1450);
        const b = await placeArtworkOnWall(1500, 1450);

        store.getState().selectObject(a.placementId);
        expect(objectIdsOf(store.getState().selection)).toEqual([a.placementId]);

        store.getState().selectObject(b.placementId);
        expect(objectIdsOf(store.getState().selection)).toEqual([b.placementId]);
      });

      it("additive toggles membership on and off", async () => {
        const a = await placeArtworkOnWall(500, 1450);
        const b = await placeArtworkOnWall(1500, 1450);

        store.getState().selectObject(a.placementId);
        store.getState().selectObject(b.placementId, { additive: true });
        expect(objectIdsOf(store.getState().selection).sort()).toEqual(
          [a.placementId, b.placementId].sort()
        );

        store.getState().selectObject(a.placementId, { additive: true });
        expect(objectIdsOf(store.getState().selection)).toEqual([b.placementId]);
      });

      it("selecting exactly one artwork placement syncs selectedArtworkId to its artworkId", async () => {
        const a = await placeArtworkOnWall(500, 1450);

        store.getState().selectObject(a.placementId);

        expect(
          getSelectedArtworkId(store.getState().project, store.getState().selection)
        ).toBe(a.artworkId);
        expect(
          getSelectedOpeningId(store.getState().project, store.getState().selection)
        ).toBeNull();
      });

      it("selecting two placements derives no single-select artwork/opening", async () => {
        const a = await placeArtworkOnWall(500, 1450);
        const b = await placeArtworkOnWall(1500, 1450);

        store.getState().selectObject(a.placementId);
        store.getState().selectObject(b.placementId, { additive: true });

        expect(
          getSelectedArtworkId(store.getState().project, store.getState().selection)
        ).toBeNull();
        expect(
          getSelectedOpeningId(store.getState().project, store.getState().selection)
        ).toBeNull();
      });

      it("is a no-op for an id that isn't a live placement", async () => {
        const before = objectIdsOf(store.getState().selection);

        store.getState().selectObject("no-such-placement");

        expect(objectIdsOf(store.getState().selection)).toBe(before);
      });
    });

    describe("clearing selectedObjectIds via existing selection actions", () => {
      it("selectWall clears selectedObjectIds", async () => {
        const a = await placeArtworkOnWall();
        store.getState().selectObject(a.placementId);

        store.getState().selectWall("wall-east");

        expect(objectIdsOf(store.getState().selection)).toEqual([]);
      });

      it("selectArtwork clears selectedObjectIds", async () => {
        const a = await placeArtworkOnWall();
        store.getState().selectObject(a.placementId);

        store.getState().selectArtwork("some-artwork");

        expect(objectIdsOf(store.getState().selection)).toEqual([]);
      });

      it("selectOpening replaces selectedObjectIds with the opening (openings fold into objects)", async () => {
        const a = await placeArtworkOnWall();
        store.getState().selectObject(a.placementId);
        await store.getState().addOpening(a.wall.id, "door");
        const openingId = store.getState().project!.wallObjects.find(
          (object) => object.kind === "door"
        )!.id;

        store.getState().selectOpening(openingId);

        // selectOpening is an objects selection now — it replaces the prior
        // selection with the single opening placement rather than clearing it.
        expect(objectIdsOf(store.getState().selection)).toEqual([openingId]);
      });

      it("setDocument (via importProjectJson) clears selectedObjectIds", async () => {
        const a = await placeArtworkOnWall();
        store.getState().selectObject(a.placementId);

        const imported = { ...createSampleProject(), id: "imported-2", title: "Imported 2" };
        await store.getState().importProjectJson(JSON.stringify(imported));

        expect(objectIdsOf(store.getState().selection)).toEqual([]);
      });

      it("setDocument (via openProject) clears selectedObjectIds", async () => {
        const original = store.getState().project!;
        const a = await placeArtworkOnWall();
        await store.getState().createProject("Another Show");
        store.getState().selectObject(a.placementId);

        // Re-select back onto the original project (a fresh document swap).
        await store.getState().openProject(original.id);

        expect(objectIdsOf(store.getState().selection)).toEqual([]);
      });
    });

    describe("moveWallObjectsGroup", () => {
      it("moves N placements in one undo entry, and one undo restores all members", async () => {
        const a = await placeArtworkOnWall(500, 1450);
        const b = await placeArtworkOnWall(1500, 1450);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().moveWallObjectsGroup([
          { id: a.placementId, xMm: 600, yMm: 1500 },
          { id: b.placementId, xMm: 1600, yMm: 1550 }
        ]);

        let state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Move 2 objects");
        let placementA = state.project!.wallObjects.find((o) => o.id === a.placementId)!;
        let placementB = state.project!.wallObjects.find((o) => o.id === b.placementId)!;
        expect(placementA.xMm).toBe(600);
        expect(placementA.yMm).toBe(1500);
        expect(placementB.xMm).toBe(1600);
        expect(placementB.yMm).toBe(1550);

        await store.getState().undo();

        state = store.getState();
        placementA = state.project!.wallObjects.find((o) => o.id === a.placementId)!;
        placementB = state.project!.wallObjects.find((o) => o.id === b.placementId)!;
        expect(placementA.xMm).toBe(500);
        expect(placementA.yMm).toBe(1450);
        expect(placementB.xMm).toBe(1500);
        expect(placementB.yMm).toBe(1450);
      });

      it("blocks the whole commit when any member would collide, and allowOverlap lets it through", async () => {
        const a = await placeArtworkOnWall(500, 1450, 400);
        const b = await placeArtworkOnWall(1500, 1450, 400);
        const wall = a.wall;
        await store.getState().addOpening(wall.id, "door");
        const door = store.getState().project!.wallObjects.find((o) => o.kind === "door")!;
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().moveWallObjectsGroup([
          { id: a.placementId, xMm: door.xMm, yMm: door.yMm },
          { id: b.placementId, xMm: 1600, yMm: 1450 }
        ]);

        let state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore);
        expect(state.error).toBeTruthy();
        let placementA = state.project!.wallObjects.find((o) => o.id === a.placementId)!;
        let placementB = state.project!.wallObjects.find((o) => o.id === b.placementId)!;
        expect(placementA.xMm).toBe(500);
        expect(placementB.xMm).toBe(1500);

        await store.getState().moveWallObjectsGroup(
          [
            { id: a.placementId, xMm: door.xMm, yMm: door.yMm },
            { id: b.placementId, xMm: 1600, yMm: 1450 }
          ],
          true
        );

        state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        placementA = state.project!.wallObjects.find((o) => o.id === a.placementId)!;
        placementB = state.project!.wallObjects.find((o) => o.id === b.placementId)!;
        expect(placementA.xMm).toBe(door.xMm);
        expect(placementB.xMm).toBe(1600);
      });
    });

    describe("movePlanObjectsGroup", () => {
      async function placeArtworkOnFloor(xMm = 1500, yMm = 2500) {
        await store.getState().addArtworksFromFiles([makeImageFile(`floor-${xMm}-${yMm}.jpg`)]);
        const artworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
        await store.getState().placeArtworkOnFloor(artworkId, xMm, yMm);
        const floorObject = store.getState().project!.floorObjects.at(-1)!;
        return { artworkId, floorObjectId: floorObject.id };
      }

      it("moves a mixed wall+floor group in one undo entry, and one undo restores both", async () => {
        const wall = await placeArtworkOnWall(500, 1450);
        const floor = await placeArtworkOnFloor(1500, 2500);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().movePlanObjectsGroup([
          { id: wall.placementId, xMm: 600 },
          { id: floor.floorObjectId, xMm: 1600, yMm: 2600 }
        ]);

        let state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Move 2 objects");
        let wallObject = state.project!.wallObjects.find((o) => o.id === wall.placementId)!;
        let floorObject = state.project!.floorObjects.find((o) => o.id === floor.floorObjectId)!;
        expect(wallObject.xMm).toBe(600);
        expect(wallObject.yMm).toBe(1450);
        expect(wallObject.wallId).toBe(wall.wall.id);
        expect(floorObject.xMm).toBe(1600);
        expect(floorObject.yMm).toBe(2600);

        await store.getState().undo();

        state = store.getState();
        wallObject = state.project!.wallObjects.find((o) => o.id === wall.placementId)!;
        floorObject = state.project!.floorObjects.find((o) => o.id === floor.floorObjectId)!;
        expect(wallObject.xMm).toBe(500);
        expect(wallObject.yMm).toBe(1450);
        expect(floorObject.xMm).toBe(1500);
        expect(floorObject.yMm).toBe(2500);
      });

      it("filters out stale/unknown ids without throwing, and is a no-op when nothing remains", async () => {
        const wall = await placeArtworkOnWall(500, 1450);
        const undoStackBefore = store.getState().undoStack.length;

        await expect(
          store.getState().movePlanObjectsGroup([
            { id: wall.placementId, xMm: 600 },
            { id: "no-such-object", xMm: 999, yMm: 999 }
          ])
        ).resolves.not.toThrow();

        let state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        let wallObject = state.project!.wallObjects.find((o) => o.id === wall.placementId)!;
        expect(wallObject.xMm).toBe(600);

        const undoStackAfterFirstMove = store.getState().undoStack.length;

        await expect(
          store.getState().movePlanObjectsGroup([{ id: "no-such-object", xMm: 1, yMm: 1 }])
        ).resolves.not.toThrow();

        state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackAfterFirstMove);
        wallObject = state.project!.wallObjects.find((o) => o.id === wall.placementId)!;
        expect(wallObject.xMm).toBe(600);
      });

      it("blocks the whole commit when the wall member would collide, and allowOverlap lets it through", async () => {
        const wall = await placeArtworkOnWall(500, 1450, 400);
        const floor = await placeArtworkOnFloor(1500, 2500);
        await store.getState().addOpening(wall.wall.id, "door");
        const door = store.getState().project!.wallObjects.find((o) => o.kind === "door")!;
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().movePlanObjectsGroup([
          { id: wall.placementId, xMm: door.xMm },
          { id: floor.floorObjectId, xMm: 1600, yMm: 2600 }
        ]);

        let state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore);
        expect(state.error).toBeTruthy();
        let wallObject = state.project!.wallObjects.find((o) => o.id === wall.placementId)!;
        let floorObject = state.project!.floorObjects.find((o) => o.id === floor.floorObjectId)!;
        expect(wallObject.xMm).toBe(500);
        expect(floorObject.xMm).toBe(1500);
        expect(floorObject.yMm).toBe(2500);

        await store.getState().movePlanObjectsGroup(
          [
            { id: wall.placementId, xMm: door.xMm },
            { id: floor.floorObjectId, xMm: 1600, yMm: 2600 }
          ],
          true
        );

        state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        wallObject = state.project!.wallObjects.find((o) => o.id === wall.placementId)!;
        floorObject = state.project!.floorObjects.find((o) => o.id === floor.floorObjectId)!;
        expect(wallObject.xMm).toBe(door.xMm);
        expect(floorObject.xMm).toBe(1600);
        expect(floorObject.yMm).toBe(2600);
      });
    });

    describe("arrangeSelectedOnWall", () => {
      it("the canonical example: 2540mm wall, three 508mm works, insetMm 254", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().resizeWall(wall.id, 2540);

        const a = await placeArtworkOnWall(200, 1450, 508);
        const b = await placeArtworkOnWall(1000, 1450, 508);
        const c = await placeArtworkOnWall(2000, 1450, 508);
        store.getState().setObjectSelection([a.placementId, b.placementId, c.placementId]);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().arrangeSelectedOnWall({ insetMm: 254 });

        const state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");

        const placementA = state.project!.wallObjects.find((o) => o.id === a.placementId)!;
        const placementB = state.project!.wallObjects.find((o) => o.id === b.placementId)!;
        const placementC = state.project!.wallObjects.find((o) => o.id === c.placementId)!;

        expect(placementA.xMm - placementA.widthMm / 2).toBeCloseTo(254);
        expect(placementC.xMm + placementC.widthMm / 2).toBeCloseTo(2540 - 254);
        // Equal 254mm edge-to-edge gaps between the three works.
        expect(placementB.xMm - placementB.widthMm / 2 - (placementA.xMm + placementA.widthMm / 2)).toBeCloseTo(
          254
        );
        expect(placementC.xMm - placementC.widthMm / 2 - (placementB.xMm + placementB.widthMm / 2)).toBeCloseTo(
          254
        );
      });

      it("errors without an edit when fewer than two members are selected", async () => {
        const a = await placeArtworkOnWall(500, 1450);
        store.getState().setObjectSelection([a.placementId]);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().arrangeSelectedOnWall({ insetMm: 100 });

        expect(store.getState().undoStack).toHaveLength(undoStackBefore);
        expect(store.getState().error).toBeTruthy();
      });

      it("errors without an edit when the selection spans two different walls", async () => {
        const a = await placeArtworkOnWall(500, 1450);
        await store.getState().addArtworksFromFiles([makeImageFile("other-wall.jpg")]);
        const otherArtworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
        await store.getState().placeArtwork(otherArtworkId, "wall-east", 500, 1450, true);
        const b = store.getState().project!.wallObjects.find(
          (o) => o.kind === "artwork" && (o as { artworkId: string }).artworkId === otherArtworkId
        )!;
        store.getState().setObjectSelection([a.placementId, b.id]);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().arrangeSelectedOnWall({ insetMm: 100 });

        expect(store.getState().undoStack).toHaveLength(undoStackBefore);
        expect(store.getState().error).toBeTruthy();
      });

      it("errors without an edit when the selection includes a floor object", async () => {
        const a = await placeArtworkOnWall(500, 1450);
        await store.getState().addArtworksFromFiles([makeImageFile("floor-piece.jpg")]);
        const floorArtworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
        await store.getState().placeArtworkOnFloor(floorArtworkId, 1000, 1000);
        const floorObjectId = store.getState().project!.floorObjects[0].id;
        store.getState().setObjectSelection([a.placementId, floorObjectId]);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().arrangeSelectedOnWall({ insetMm: 100 });

        expect(store.getState().undoStack).toHaveLength(undoStackBefore);
        expect(store.getState().error).toBeTruthy();
      });
    });

    describe("removeSelectedPlacements", () => {
      it("removes a wall placement and a floor placement in one undo entry, and clears selection", async () => {
        const a = await placeArtworkOnWall(500, 1450);
        await store.getState().addArtworksFromFiles([makeImageFile("floor-piece-2.jpg")]);
        const floorArtworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
        await store.getState().placeArtworkOnFloor(floorArtworkId, 1000, 1000);
        const floorObjectId = store.getState().project!.floorObjects[0].id;

        store.getState().setObjectSelection([a.placementId, floorObjectId]);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().removeSelectedPlacements();

        const state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Remove 2 objects");
        expect(state.project!.wallObjects.some((o) => o.id === a.placementId)).toBe(false);
        expect(state.project!.floorObjects.some((o) => o.id === floorObjectId)).toBe(false);
        expect(objectIdsOf(state.selection)).toEqual([]);
      });
    });

    describe("arrange session", () => {
      // Canonical setup: a 2540mm wall with three 508mm works, matching the
      // arrangeSelectedOnWall example. Returns the three placement ids.
      async function threeWorksOnWall() {
        const wallId = getSelectedWall(store.getState().project!, store.getState().wallContextId)!.id;
        await store.getState().resizeWall(wallId, 2540);
        const a = await placeArtworkOnWall(200, 1450, 508);
        const b = await placeArtworkOnWall(1000, 1450, 508);
        const c = await placeArtworkOnWall(2000, 1450, 508);
        store.getState().setObjectSelection([a.placementId, b.placementId, c.placementId]);
        // Re-fetch after the resize so lengthMm reflects the 2540mm wall.
        const wall = getSelectedWall(store.getState().project!, wallId)!;
        return { wall, a, b, c };
      }

      function xById(id: string): number {
        return store.getState().project!.wallObjects.find((o) => o.id === id)!.xMm;
      }

      describe("beginArrangeSession guards", () => {
        it("creates no session when the selection includes a floor object", async () => {
          const a = await placeArtworkOnWall(500, 1450);
          await store.getState().addArtworksFromFiles([makeImageFile("floor-arr.jpg")]);
          const floorArtworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
          await store.getState().placeArtworkOnFloor(floorArtworkId, 1000, 1000);
          const floorObjectId = store.getState().project!.floorObjects[0].id;
          store.getState().setObjectSelection([a.placementId, floorObjectId]);

          store.getState().beginArrangeSession("equal");

          expect(store.getState().arrangeSession).toBeNull();
        });

        it("creates no session when the selection spans two walls", async () => {
          const a = await placeArtworkOnWall(500, 1450);
          await store.getState().addArtworksFromFiles([makeImageFile("other-wall-arr.jpg")]);
          const otherId = store.getState().project!.checklistArtworkIds.at(-1)!;
          await store.getState().placeArtwork(otherId, "wall-east", 500, 1450, true);
          const b = store.getState().project!.wallObjects.find(
            (o) => o.kind === "artwork" && (o as { artworkId: string }).artworkId === otherId
          )!;
          store.getState().setObjectSelection([a.placementId, b.id]);

          store.getState().beginArrangeSession("equal");

          expect(store.getState().arrangeSession).toBeNull();
        });

        it("creates no session with fewer than two members", async () => {
          const a = await placeArtworkOnWall(500, 1450);
          store.getState().setObjectSelection([a.placementId]);

          store.getState().beginArrangeSession("equal");

          expect(store.getState().arrangeSession).toBeNull();
        });

        it("seeds original and preview from committed positions on the happy path", async () => {
          const { a, b, c } = await threeWorksOnWall();

          store.getState().beginArrangeSession("equal");

          const session = store.getState().arrangeSession!;
          expect(session).not.toBeNull();
          expect(session.mode).toBe("equal");
          expect(session.memberIds.sort()).toEqual(
            [a.placementId, b.placementId, c.placementId].sort()
          );
          for (const id of [a.placementId, b.placementId, c.placementId]) {
            const committed = store.getState().project!.wallObjects.find((o) => o.id === id)!;
            expect(session.originalById[id]).toEqual({ xMm: committed.xMm, yMm: committed.yMm });
            expect(session.previewById[id]).toEqual({ xMm: committed.xMm, yMm: committed.yMm });
          }
        });

        it("is idempotent for the same member set, only switching mode", async () => {
          await threeWorksOnWall();
          store.getState().beginArrangeSession("equal");
          store.getState().updateArrangeSession({ equal: true });
          const previewAfterEqual = store.getState().arrangeSession!.previewById;

          store.getState().beginArrangeSession("inset");

          const session = store.getState().arrangeSession!;
          expect(session.mode).toBe("inset");
          // Preview survived the mode switch (not re-seeded from committed).
          expect(session.previewById).toEqual(previewAfterEqual);
        });

        it("remembers the last arrange mode across begins (default inset)", async () => {
          // Plain view state seeded to "inset" so the panel always opens in a
          // real mode, and it tracks the mode the curator last worked in.
          expect(store.getState().lastArrangeMode).toBe("inset");

          await threeWorksOnWall();
          store.getState().beginArrangeSession("gap");
          expect(store.getState().lastArrangeMode).toBe("gap");

          store.getState().beginArrangeSession("equal");
          expect(store.getState().lastArrangeMode).toBe("equal");

          // A no-op begin (guards fail) must not disturb the remembered mode.
          store.getState().clearObjectSelection();
          store.getState().beginArrangeSession("inset");
          expect(store.getState().lastArrangeMode).toBe("equal");
        });
      });

      describe("membership is artworks only", () => {
        it("a marquee-style selection of two artworks plus an opening seeds a session with the artworks only", async () => {
          const { wall, a, b } = await threeWorksOnWall();
          await store.getState().addOpening(wall.id, "door");
          const door = store.getState().project!.wallObjects.find((o) => o.kind === "door")!;
          store.getState().setObjectSelection([a.placementId, b.placementId, door.id]);

          store.getState().beginArrangeSession("equal");

          const session = store.getState().arrangeSession!;
          expect(session).not.toBeNull();
          expect(session.memberIds.sort()).toEqual(
            [a.placementId, b.placementId].sort()
          );
          expect(session.memberIds).not.toContain(door.id);
        });

        it("committing the session moves only the artworks and leaves the opening in place", async () => {
          const { wall, a, b } = await threeWorksOnWall();
          await store.getState().addOpening(wall.id, "door");
          const door = store.getState().project!.wallObjects.find((o) => o.kind === "door")!;
          const doorXBefore = door.xMm;
          const doorYBefore = door.yMm;
          store.getState().setObjectSelection([a.placementId, b.placementId, door.id]);
          const undoBefore = store.getState().undoStack.length;

          store.getState().beginArrangeSession("equal");
          store.getState().updateArrangeSession({ equal: true });
          const preview = store.getState().arrangeSession!.previewById;
          // allowOverlap so a work landing over the centered door can't block.
          store.getState().commitArrangeSession(true);

          const state = store.getState();
          expect(state.arrangeSession).toBeNull();
          expect(state.undoStack).toHaveLength(undoBefore + 1);
          expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
          for (const id of [a.placementId, b.placementId]) {
            expect(xById(id)).toBeCloseTo(preview[id].xMm);
          }
          const doorAfter = state.project!.wallObjects.find((o) => o.id === door.id)!;
          expect(doorAfter.xMm).toBe(doorXBefore);
          expect(doorAfter.yMm).toBe(doorYBefore);
        });

        it("a selection of one artwork plus an opening is not arrange-eligible", async () => {
          const a = await placeArtworkOnWall(500, 1450);
          await store.getState().addOpening(a.wall.id, "door");
          const door = store.getState().project!.wallObjects.find((o) => o.kind === "door")!;
          store.getState().setObjectSelection([a.placementId, door.id]);

          store.getState().beginArrangeSession("equal");
          expect(store.getState().arrangeSession).toBeNull();

          const undoBefore = store.getState().undoStack.length;
          await store.getState().arrangeSelectedOnWall({ insetMm: 100 });
          expect(store.getState().undoStack).toHaveLength(undoBefore);
          expect(store.getState().error).toBeTruthy();
        });
      });

      it("updateArrangeSession({equal:true}) previews the solveEqualArrangement layout without touching the project", async () => {
        const { wall } = await threeWorksOnWall();
        const projectBefore = store.getState().project!;
        const undoBefore = store.getState().undoStack.length;
        const selectedIds = objectIdsOf(store.getState().selection);
        const members = projectBefore.wallObjects.filter((o) => selectedIds.includes(o.id));
        expect(members).toHaveLength(3);

        store.getState().beginArrangeSession("equal");
        store.getState().updateArrangeSession({ equal: true });

        const insetMm = solveEqualArrangement(members, wall.lengthMm).insetMm;
        const expected = arrangeOnWall(members, wall.lengthMm, { insetMm });

        const preview = store.getState().arrangeSession!.previewById;
        for (const move of expected) {
          expect(preview[move.id].xMm).toBeCloseTo(move.xMm);
        }
        // Project untouched while previewing.
        expect(store.getState().project).toBe(projectBefore);
        expect(store.getState().undoStack).toHaveLength(undoBefore);
      });

      it("setArrangeAnchor alone moves nothing (no preview change, no project touch)", async () => {
        await threeWorksOnWall();
        store.getState().beginArrangeSession("inset");
        const projectBefore = store.getState().project!;
        const previewBefore = store.getState().arrangeSession!.previewById;
        const undoBefore = store.getState().undoStack.length;

        store.getState().setArrangeAnchor("left");

        const session = store.getState().arrangeSession!;
        expect(session.insetAnchor).toBe("left");
        // Preview object is untouched — switching the anchor never re-slides.
        expect(session.previewById).toBe(previewBefore);
        expect(store.getState().project).toBe(projectBefore);
        expect(store.getState().undoStack).toHaveLength(undoBefore);
        expect(store.getState().lastInsetAnchor).toBe("left");
      });

      it("setArrangeAnchor with no session remembers lastInsetAnchor", async () => {
        await threeWorksOnWall();
        expect(store.getState().lastInsetAnchor).toBe("both");

        store.getState().setArrangeAnchor("right");

        expect(store.getState().arrangeSession).toBeNull();
        expect(store.getState().lastInsetAnchor).toBe("right");

        // A freshly begun session opens on the remembered anchor.
        store.getState().beginArrangeSession("inset");
        expect(store.getState().arrangeSession!.insetAnchor).toBe("right");
      });

      it("an inset update with anchor 'left' slides the group rigidly and preserves interior gaps", async () => {
        const { wall, a, b, c } = await threeWorksOnWall();
        const projectBefore = store.getState().project!;
        const membersBefore = projectBefore.wallObjects.filter((o) =>
          [a.placementId, b.placementId, c.placementId].includes(o.id)
        );
        const gapsBefore = getSpacingSegments(membersBefore, wall.lengthMm)
          .slice(1, -1)
          .map((s) => s.toMm - s.fromMm);
        const undoBefore = store.getState().undoStack.length;

        store.getState().beginArrangeSession("inset");
        store.getState().setArrangeAnchor("left");
        store.getState().updateArrangeSession({ insetMm: 300, anchor: "left" });

        const preview = store.getState().arrangeSession!.previewById;
        const movedMembers = membersBefore.map((m) => ({
          ...m,
          xMm: preview[m.id].xMm
        }));
        // Leftmost edge now sits at 300mm from the wall start.
        const newLeftEdge = Math.min(
          ...movedMembers.map((m) => m.xMm - m.widthMm / 2)
        );
        expect(newLeftEdge).toBeCloseTo(300);
        // Interior gaps are unchanged (rigid translation).
        const gapsAfter = getSpacingSegments(movedMembers, wall.lengthMm)
          .slice(1, -1)
          .map((s) => s.toMm - s.fromMm);
        expect(gapsAfter).toEqual(gapsBefore);
        // Every member moved by the same delta.
        const deltas = movedMembers.map(
          (m, i) => m.xMm - membersBefore[i].xMm
        );
        expect(new Set(deltas.map((d) => d.toFixed(6))).size).toBe(1);
        // Preview only — project untouched, no undo entry yet.
        expect(store.getState().project).toBe(projectBefore);
        expect(store.getState().undoStack).toHaveLength(undoBefore);
      });

      it("a left-anchor session commits as exactly one 'Arrange on wall' entry", async () => {
        const { a, b, c } = await threeWorksOnWall();
        const undoBefore = store.getState().undoStack.length;

        store.getState().beginArrangeSession("inset");
        store.getState().setArrangeAnchor("left");
        store.getState().updateArrangeSession({ insetMm: 300, anchor: "left" });
        const preview = store.getState().arrangeSession!.previewById;
        store.getState().commitArrangeSession();

        const state = store.getState();
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
        expect(state.arrangeSession).toBeNull();
        for (const id of [a.placementId, b.placementId, c.placementId]) {
          expect(xById(id)).toBeCloseTo(preview[id].xMm);
        }
      });

      it("insetBoundary detects a same-wall neighbour instead of the wall edge, and the left-anchor field measures against it", async () => {
        const wallId = getSelectedWall(
          store.getState().project!,
          store.getState().wallContextId
        )!.id;
        await store.getState().resizeWall(wallId, 3000);
        const a = await placeArtworkOnWall(1000, 1450, 400);
        const b = await placeArtworkOnWall(1500, 1450, 400);
        await store.getState().addOpening(wallId, "door");
        const door = store.getState().project!.wallObjects.find((o) => o.kind === "door")!;
        // Slide the door well left of the group, clear of the wall start, so
        // it — not the wall edge — is the nearest thing beside the group.
        await store.getState().moveOpening(door.id, 200, door.yMm, true);

        store.getState().setObjectSelection([a.placementId, b.placementId]);
        store.getState().beginArrangeSession("inset");
        store.getState().setArrangeAnchor("left");

        const session = store.getState().arrangeSession!;
        const doorRightEdgeMm = 200 + door.widthMm / 2;
        expect(session.insetBoundary.left).toEqual({
          type: "object",
          edgeMm: doorRightEdgeMm,
          objectId: door.id
        });
        expect(session.insetBoundary.right).toEqual({ type: "wall", edgeMm: 3000 });

        // Editing the left-anchor field now measures from the door's right
        // edge, not the wall start.
        store.getState().updateArrangeSession({ insetMm: 100, anchor: "left" });
        const preview = store.getState().arrangeSession!.previewById;
        const groupLeftEdgeMm = preview[a.placementId].xMm - 400 / 2;
        expect(groupLeftEdgeMm).toBeCloseTo(doorRightEdgeMm + 100);

        // Committing moves only the artworks — the door (the boundary itself)
        // stays exactly where it was slid to.
        store.getState().commitArrangeSession(true);
        const doorAfter = store
          .getState()
          .project!.wallObjects.find((o) => o.id === door.id)!;
        expect(doorAfter.xMm).toBe(200);
      });

      it("commitArrangeSession applies the preview as exactly one 'Arrange on wall' entry and clears the session", async () => {
        const { wall, a, b, c } = await threeWorksOnWall();
        const undoBefore = store.getState().undoStack.length;

        store.getState().beginArrangeSession("equal");
        store.getState().updateArrangeSession({ equal: true });
        const preview = store.getState().arrangeSession!.previewById;
        store.getState().commitArrangeSession();

        const state = store.getState();
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
        expect(state.arrangeSession).toBeNull();
        for (const id of [a.placementId, b.placementId, c.placementId]) {
          expect(xById(id)).toBeCloseTo(preview[id].xMm);
        }
        expect(wall.lengthMm).toBe(2540);
      });

      it("cancelArrangeSession leaves the project deep-equal to before and clears the session", async () => {
        await threeWorksOnWall();
        store.getState().beginArrangeSession("equal");
        const projectBefore = store.getState().project!;
        const undoBefore = store.getState().undoStack.length;

        store.getState().updateArrangeSession({ equal: true });
        store.getState().cancelArrangeSession();

        expect(store.getState().arrangeSession).toBeNull();
        expect(store.getState().project).toBe(projectBefore);
        expect(store.getState().undoStack).toHaveLength(undoBefore);
      });

      it("a commit with no preview delta pushes no undo entry", async () => {
        await threeWorksOnWall();
        const undoBefore = store.getState().undoStack.length;

        store.getState().beginArrangeSession("equal");
        store.getState().commitArrangeSession();

        expect(store.getState().undoStack).toHaveLength(undoBefore);
        expect(store.getState().arrangeSession).toBeNull();
      });

      it("selectObject mid-session auto-accepts the pending arrangement", async () => {
        const { a, b, c } = await threeWorksOnWall();
        store.getState().beginArrangeSession("equal");
        store.getState().updateArrangeSession({ equal: true });
        const preview = store.getState().arrangeSession!.previewById;
        const undoBefore = store.getState().undoStack.length;

        store.getState().selectObject(a.placementId);

        const state = store.getState();
        expect(state.arrangeSession).toBeNull();
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
        for (const id of [a.placementId, b.placementId, c.placementId]) {
          expect(xById(id)).toBeCloseTo(preview[id].xMm);
        }
        // The click collapsed the group to a single selection.
        expect(objectIdsOf(state.selection)).toEqual([a.placementId]);
      });

      it("clearObjectSelection mid-session auto-accepts the pending arrangement", async () => {
        const { a } = await threeWorksOnWall();
        store.getState().beginArrangeSession("equal");
        store.getState().updateArrangeSession({ equal: true });
        const preview = store.getState().arrangeSession!.previewById;
        const undoBefore = store.getState().undoStack.length;

        store.getState().clearObjectSelection();

        const state = store.getState();
        expect(state.arrangeSession).toBeNull();
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        expect(xById(a.placementId)).toBeCloseTo(preview[a.placementId].xMm);
        expect(objectIdsOf(state.selection)).toEqual([]);
      });

      it("a foreign edit cancels the session (preview discarded)", async () => {
        const { a } = await threeWorksOnWall();
        const originalX = xById(a.placementId);
        store.getState().beginArrangeSession("equal");
        store.getState().updateArrangeSession({ equal: true });

        await store.getState().renameProject("Session Foreign Edit");

        const state = store.getState();
        expect(state.arrangeSession).toBeNull();
        expect(state.undoStack.at(-1)?.label).toBe("Rename project");
        // The preview was dropped, not committed — the work never moved.
        expect(xById(a.placementId)).toBe(originalX);
      });

      it("undo cancels the session", async () => {
        await threeWorksOnWall();
        store.getState().beginArrangeSession("equal");
        store.getState().updateArrangeSession({ equal: true });

        await store.getState().undo();

        expect(store.getState().arrangeSession).toBeNull();
      });

      it("a collision-blocked explicit commit keeps the session open with an error", async () => {
        const a = await placeArtworkOnWall(500, 1450, 400);
        const b = await placeArtworkOnWall(1500, 1450, 400);
        const wall = a.wall;
        await store.getState().addOpening(wall.id, "door");
        const door = store.getState().project!.wallObjects.find((o) => o.kind === "door")!;
        store.getState().setObjectSelection([a.placementId, b.placementId]);
        const undoBefore = store.getState().undoStack.length;

        store.getState().beginArrangeSession("gap");
        store.getState().setArrangeSessionPreview([
          { id: a.placementId, xMm: door.xMm, yMm: door.yMm },
          { id: b.placementId, xMm: 1600, yMm: 1450 }
        ]);
        store.getState().commitArrangeSession();

        const state = store.getState();
        expect(state.arrangeSession).not.toBeNull();
        expect(state.error).toMatch(/overlap/i);
        expect(state.undoStack).toHaveLength(undoBefore);
        // Nothing committed — the work stayed at its original x.
        expect(xById(a.placementId)).toBe(500);
      });

      it("a collision-blocked auto-accept cancels the session (it can't outlive its selection)", async () => {
        const a = await placeArtworkOnWall(500, 1450, 400);
        const b = await placeArtworkOnWall(1500, 1450, 400);
        const wall = a.wall;
        await store.getState().addOpening(wall.id, "door");
        const door = store.getState().project!.wallObjects.find((o) => o.kind === "door")!;
        store.getState().setObjectSelection([a.placementId, b.placementId]);
        const undoBefore = store.getState().undoStack.length;

        store.getState().beginArrangeSession("gap");
        store.getState().setArrangeSessionPreview([
          { id: a.placementId, xMm: door.xMm, yMm: door.yMm },
          { id: b.placementId, xMm: 1600, yMm: 1450 }
        ]);
        store.getState().selectObject(door.id);

        const state = store.getState();
        expect(state.arrangeSession).toBeNull();
        expect(state.error).toMatch(/overlap/i);
        expect(state.undoStack).toHaveLength(undoBefore);
        expect(xById(a.placementId)).toBe(500);
      });

      it("a gap-mode update on an off-center pair re-spaces about the pair's center without recentering on the wall", async () => {
        // Repro of the reported bug's fix: select only the right-hand 2 of 4
        // works (the pair hangs well right of wall center). Editing the spacing
        // must keep the pair where it is, moving each work by half the gap
        // delta in opposite directions — NOT teleport the pair to wall center.
        const wallId = getSelectedWall(
          store.getState().project!,
          store.getState().wallContextId
        )!.id;
        await store.getState().resizeWall(wallId, 4724.4); // ~15'6"
        await placeArtworkOnWall(800, 1450, 400);
        await placeArtworkOnWall(1600, 1450, 400);
        const c = await placeArtworkOnWall(3000, 1450, 400);
        const d = await placeArtworkOnWall(3800, 1450, 400);
        store.getState().setObjectSelection([c.placementId, d.placementId]);

        const wall = getSelectedWall(store.getState().project!, wallId)!;
        const w = 400;
        const cx0 = xById(c.placementId);
        const dx0 = xById(d.placementId);
        const oldGap = dx0 - w / 2 - (cx0 + w / 2);
        const oldCenter = (cx0 - w / 2 + (dx0 + w / 2)) / 2;
        const undoBefore = store.getState().undoStack.length;

        store.getState().beginArrangeSession("gap");
        const newGap = 200;
        store.getState().updateArrangeSession({ gapMm: newGap });

        const preview = store.getState().arrangeSession!.previewById;
        const cx1 = preview[c.placementId].xMm;
        const dx1 = preview[d.placementId].xMm;

        // Interior gap is now exactly the requested value.
        expect(dx1 - w / 2 - (cx1 + w / 2)).toBeCloseTo(newGap);
        // The pair's union center is preserved — no recentering on the wall.
        const newCenter = (cx1 - w / 2 + (dx1 + w / 2)) / 2;
        expect(newCenter).toBeCloseTo(oldCenter);
        // And it emphatically did NOT jump toward the wall's midpoint.
        expect(Math.abs(newCenter - wall.lengthMm / 2)).toBeGreaterThan(500);
        // Each work moved by half the gap delta, in opposite directions.
        const delta = newGap - oldGap;
        expect(cx1 - cx0).toBeCloseTo(-delta / 2);
        expect(dx1 - dx0).toBeCloseTo(delta / 2);
        // Preview only — project untouched.
        expect(store.getState().undoStack).toHaveLength(undoBefore);

        // Commit yields exactly one "Arrange on wall" entry.
        store.getState().commitArrangeSession();
        const state = store.getState();
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
        expect(xById(c.placementId)).toBeCloseTo(cx1);
        expect(xById(d.placementId)).toBeCloseTo(dx1);
      });

      describe("space-within zone (Space evenly)", () => {
        // The canonical three works to arrange, plus an UNSELECTED neighbour to
        // their left, so the open-space span is bounded on the left (narrower
        // than the whole 3000mm wall). Neighbour: width 800, center 400 -> right
        // edge 800. Works: 508mm each at 1200/1800/2400 (group left edge 946),
        // so the left boundary is the neighbour's right edge (800), the right
        // the wall end (3000).
        async function boundedScenario() {
          const wallId = getSelectedWall(
            store.getState().project!,
            store.getState().wallContextId
          )!.id;
          await store.getState().resizeWall(wallId, 3000);
          const neighbor = await placeArtworkOnWall(400, 1450, 800);
          const a = await placeArtworkOnWall(1200, 1450, 508);
          const b = await placeArtworkOnWall(1800, 1450, 508);
          const c = await placeArtworkOnWall(2400, 1450, 508);
          store
            .getState()
            .setObjectSelection([a.placementId, b.placementId, c.placementId]);
          const wall = getSelectedWall(store.getState().project!, wallId)!;
          return { wall, neighbor, a, b, c };
        }

        const groupLeftEdge = (ids: string[]) => {
          const preview = store.getState().arrangeSession!.previewById;
          const objs = store
            .getState()
            .project!.wallObjects.filter((o) => ids.includes(o.id));
          return Math.min(...objs.map((o) => preview[o.id].xMm - o.widthMm / 2));
        };

        it("smart default opens the zone when the group is boxed in by a neighbour", async () => {
          await boundedScenario();
          store.getState().beginArrangeSession("equal");
          const session = store.getState().arrangeSession!;
          expect(session.evenZone).toBe("open");
          expect(session.openZoneBoundsMm).toEqual({ startMm: 800, endMm: 3000 });
        });

        it("smart default keeps the whole wall when nothing is beside the group", async () => {
          await threeWorksOnWall();
          store.getState().beginArrangeSession("equal");
          const session = store.getState().arrangeSession!;
          expect(session.evenZone).toBe("wall");
          expect(session.openZoneBoundsMm).toEqual({ startMm: 0, endMm: 2540 });
        });

        it("a remembered zone choice wins over the smart default", async () => {
          await boundedScenario(); // bounded -> smart default would be "open"
          store.getState().setArrangeEvenZone("wall");
          store.getState().cancelArrangeSession();
          expect(store.getState().lastEvenZone).toBe("wall");

          store.getState().beginArrangeSession("equal");
          expect(store.getState().arrangeSession!.evenZone).toBe("wall");
        });

        it("choosing a zone with no session begins an equal session and applies the solve", async () => {
          const { a, b, c } = await boundedScenario();
          const ids = [a.placementId, b.placementId, c.placementId];
          const members = store
            .getState()
            .project!.wallObjects.filter((o) => ids.includes(o.id));
          expect(store.getState().arrangeSession).toBeNull();
          const undoBefore = store.getState().undoStack.length;

          store.getState().setArrangeEvenZone("open");

          const session = store.getState().arrangeSession!;
          expect(session).not.toBeNull();
          expect(session.mode).toBe("equal");
          expect(session.evenZone).toBe("open");
          expect(store.getState().lastEvenZone).toBe("open");
          // The preview spread the works across the open zone [800, 3000].
          const equalOpen = solveEqualArrangementInZone(members, 800, 3000);
          expect(groupLeftEdge(ids)).toBeCloseTo(800 + equalOpen.insetMm, 4);
          // Preview only — the project isn't touched until commit.
          expect(store.getState().undoStack).toHaveLength(undoBefore);
        });

        it("switching the zone in equal mode re-spaces the works live", async () => {
          const { wall, a, b, c } = await boundedScenario();
          const ids = [a.placementId, b.placementId, c.placementId];
          const members = store
            .getState()
            .project!.wallObjects.filter((o) => ids.includes(o.id));

          store.getState().beginArrangeSession("equal"); // smart default "open"
          store.getState().updateArrangeSession({ equal: true });
          expect(store.getState().arrangeSession!.evenZone).toBe("open");
          const equalOpen = solveEqualArrangementInZone(members, 800, 3000);
          expect(groupLeftEdge(ids)).toBeCloseTo(800 + equalOpen.insetMm, 4);

          // Switch to the whole wall — the works re-space across [0, 3000].
          store.getState().setArrangeEvenZone("wall");
          expect(store.getState().arrangeSession!.evenZone).toBe("wall");
          const equalWhole = solveEqualArrangement(members, wall.lengthMm);
          expect(groupLeftEdge(ids)).toBeCloseTo(equalWhole.insetMm, 4);
        });

        it("keeps the open-zone bounds fixed while previews move the members", async () => {
          await boundedScenario();
          store.getState().beginArrangeSession("equal");
          const boundsBefore = store.getState().arrangeSession!.openZoneBoundsMm;

          store.getState().updateArrangeSession({ equal: true }); // moves members
          store.getState().setArrangeEvenZone("wall");
          store.getState().setArrangeEvenZone("open");

          expect(store.getState().arrangeSession!.openZoneBoundsMm).toEqual(
            boundsBefore
          );
        });

        it("commits the open-zone equal layout matching arrangeOnWallInZone", async () => {
          const { a, b, c } = await boundedScenario();
          const ids = [a.placementId, b.placementId, c.placementId];
          const members = store
            .getState()
            .project!.wallObjects.filter((o) => ids.includes(o.id));
          const undoBefore = store.getState().undoStack.length;

          store.getState().beginArrangeSession("equal");
          store.getState().updateArrangeSession({ equal: true });
          const bounds = store.getState().arrangeSession!.openZoneBoundsMm;
          const expected = arrangeOnWallInZone(members, bounds.startMm, bounds.endMm);
          store.getState().commitArrangeSession(true);

          expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
          expect(store.getState().undoStack.at(-1)?.label).toBe("Arrange on wall");
          for (const move of expected) {
            expect(xById(move.id)).toBeCloseTo(move.xMm, 4);
          }
        });

        it("cancelling an open-zone equal session reverts the project", async () => {
          await boundedScenario();
          store.getState().beginArrangeSession("equal");
          const projectBefore = store.getState().project!;
          const undoBefore = store.getState().undoStack.length;

          store.getState().updateArrangeSession({ equal: true });
          store.getState().cancelArrangeSession();

          expect(store.getState().arrangeSession).toBeNull();
          expect(store.getState().project).toBe(projectBefore);
          expect(store.getState().undoStack).toHaveLength(undoBefore);
        });

        it("remembers lastEvenZone even when the selection can't be arranged", async () => {
          const a = await placeArtworkOnWall(500, 1450);
          store.getState().setObjectSelection([a.placementId]); // single, ineligible

          store.getState().setArrangeEvenZone("open");

          expect(store.getState().arrangeSession).toBeNull();
          expect(store.getState().lastEvenZone).toBe("open");
        });

        it("a whole-wall zone reproduces the original centred equal solve", async () => {
          const { wall, a, b, c } = await threeWorksOnWall();
          const ids = [a.placementId, b.placementId, c.placementId];
          const members = store
            .getState()
            .project!.wallObjects.filter((o) => ids.includes(o.id));

          store.getState().beginArrangeSession("equal"); // unbounded -> "wall"
          store.getState().updateArrangeSession({ equal: true });

          const insetMm = solveEqualArrangement(members, wall.lengthMm).insetMm;
          const expected = arrangeOnWall(members, wall.lengthMm, { insetMm });
          const preview = store.getState().arrangeSession!.previewById;
          for (const move of expected) {
            expect(preview[move.id].xMm).toBeCloseTo(move.xMm, 6);
          }
        });
      });
    });
  });

  describe("floor object ripples on removal", () => {
    it("removeArtworkFromChecklist drops the artwork's floor placements", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
      expect(store.getState().project!.floorObjects).toHaveLength(1);

      await store.getState().removeArtworkFromChecklist(artworkId);

      const state = store.getState();
      expect(state.project!.floorObjects).toHaveLength(0);
      expect(state.project!.checklistArtworkIds).not.toContain(artworkId);
      expect(artworkLibraryRepository.artworks.has(artworkId)).toBe(true);
    });

    it("removePlacement removes a floor object by id", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
      const floorId = store.getState().project!.floorObjects[0].id;

      await store.getState().removePlacement(floorId);

      const state = store.getState();
      expect(state.project!.floorObjects).toHaveLength(0);
      expect(state.project!.checklistArtworkIds).toContain(artworkId);
    });
  });

  // Kept as its own describe block, separate from the "arrange session"
  // tests above — artwork/artwork overlap is a non-blocking "overlap"
  // warning (see validatePlacement.ts), unlike the artwork/opening
  // "collision" warnings the gates above reject.
  describe("artwork/artwork overlap (non-blocking)", () => {
    it("commitArrangeSession succeeds when two artworks land on top of each other, surfacing a non-blocking 'overlap' warning instead of blocking", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("overlap-a.jpg")]);
      const artworkAId = store.getState().project!.checklistArtworkIds.at(-1)!;
      await store.getState().addArtworksFromFiles([makeImageFile("overlap-b.jpg")]);
      const artworkBId = store.getState().project!.checklistArtworkIds.at(-1)!;

      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().placeArtwork(artworkAId, wall.id, 500, 1450, true);
      const a = store.getState().project!.wallObjects.at(-1)!;
      await store.getState().placeArtwork(artworkBId, wall.id, 1500, 1450, true);
      const b = store.getState().project!.wallObjects.at(-1)!;

      store.getState().setObjectSelection([a.id, b.id]);
      const undoBefore = store.getState().undoStack.length;

      store.getState().beginArrangeSession("gap");
      store.getState().setArrangeSessionPreview([
        { id: a.id, xMm: 1000, yMm: 1450 },
        { id: b.id, xMm: 1000, yMm: 1450 }
      ]);
      store.getState().commitArrangeSession();

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.arrangeSession).toBeNull();
      expect(state.undoStack).toHaveLength(undoBefore + 1);
      expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
      expect(state.placementWarnings.some((warning) => warning.type === "overlap")).toBe(true);
      expect(state.placementWarnings.every((warning) => warning.type !== "collision")).toBe(true);
    });
  });
});

// Injects a wall placement directly into the current project, bypassing
// applyEdit, purely to set up the "dangling placement" scenario for the
// removeArtworkFromChecklist test above — there's no store action yet that
// creates placements (docs/plan.md's placement UI is a later milestone).
async function applyPlacementDirectly(
  repository: InMemoryProjectRepository,
  store: ReturnType<typeof createAppStore>,
  artworkId: string
): Promise<void> {
  const project = store.getState().project!;
  const wallId = getSelectedWall(project, store.getState().wallContextId)?.id;
  if (!wallId) throw new Error("Test setup requires a wall to place the artwork on.");

  const updated: Project = {
    ...project,
    wallObjects: [
      ...project.wallObjects,
      {
        id: "wall-object-test",
        wallId,
        kind: "artwork",
        artworkId,
        xMm: 0,
        yMm: 0,
        widthMm: 100,
        heightMm: 100
      }
    ]
  };

  await repository.save(updated);
  store.setState({ project: updated });
}
