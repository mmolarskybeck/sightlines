// The cross-slice INTEGRATION suite: boot/persist/recovery, cross-tab
// refresh, package import/export, the checklist/library actions, and every
// flow that spans more than one store slice in a single undo entry —
// including updateArtwork, whose record edit and placement rebake are one
// undo step, and "opening connections", whose legacy-pair tests pose a
// placementSlice action alongside a sharedOpeningSlice resolver in one test.
//
// Single-slice action tests live next to their slice under ./store/:
//   - store/placementSlice.test.ts    placing/moving/resizing/removing
//                                      artwork, openings, cases, wall text
//   - store/sharedOpeningSlice.test.ts the five shared-opening resolver
//                                      actions (resolve/complete/realign/
//                                      split/keep)
//   - store/floorObjectSlice.test.ts  editing a floor placement's own
//                                      fields and back-to-back pairing
//   - store/selectionSlice.test.ts    selection transitions (including the
//                                      "selection" describe folded in here)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toast } from "sonner";
import { telemetry } from "./telemetry/telemetry";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  MONITOR_ASPECT_RATIO,
  MONITOR_DEPTH_MM
} from "../domain/project";
import type { Project } from "../domain/project";
import type { ArtworkImportDraft } from "../domain/spreadsheetImport/types";
import { PLACEHOLDER_ARTWORK_WIDTH_MM } from "../domain/placement/placeArtwork";
import {
  arrangeOnWall,
  arrangeOnWallInZone,
  getSpacingSegments,
  solveEqualArrangement,
  solveEqualArrangementInZone
} from "../domain/placement/arrangeOnWall";
import { withArtworkFootprint } from "../domain/framing";
import {
  createPolygonRoomPlacement,
  createRectangularRoomPlacement
} from "../domain/geometry/createRoom";
import { getPartitionClearances } from "../domain/geometry/partitionSpacing";
import { getFloorWalls } from "../domain/geometry/planObjects";
import { createSampleProject } from "../domain/sample/sampleProject";
import { MAX_IMPORT_JSON_LENGTH } from "../domain/schema/projectSchema";
import { createSightlinesPackage } from "../domain/package/buildPackage";
import { makeFixture } from "../domain/package/packageTestFixtures";
import { createArtworkImportPlan } from "../domain/spreadsheetImport/importPlan";
import { feetToMm, inchesToMm } from "../domain/units/length";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  InMemoryProjectSnapshotRepository,
  InMemorySyncMetaRepository,
  makeImageFile
} from "../test/inMemoryRepositories";
import { exportProjectJson } from "../test/exportProjectJson";
import { ProjectValidationError } from "../domain/repositories/indexedDbProjectRepository";
import { SNAPSHOT_MIN_INTERVAL_MS } from "../domain/repositories/projectSnapshotRepository";
import { createTestAppStore, type FakeCrossTabSync } from "../test/testAppStore";
import { A_NORTH, linkLegacyPair, partnerOfId, sharedPairOnBoundary } from "../test/storeFixtures";
import type { AppStoreDeps, SaveError } from "./store";
import { shouldAnnounceSaveError } from "./hooks/useSaveErrorToast";
import {
  createAppStore,
  freestandingWallIdOf,
  getSelectedArtworkId,
  getSelectedOpeningId,
  getSelectedWall,
  objectIdsOf,
  OVERLAP_BLOCKED_MESSAGE,
  roomIdOf
} from "./store";

describe("app store", () => {
  let repository: InMemoryProjectRepository;
  let artworkLibraryRepository: InMemoryArtworkLibraryRepository;
  let assetRepository: InMemoryAssetRepository;
  let imageProcessor: FakeImageProcessor;
  let projectSnapshotRepository: InMemoryProjectSnapshotRepository;
  let syncMetaRepository: InMemorySyncMetaRepository;
  let crossTabSync: FakeCrossTabSync;
  let store: ReturnType<typeof createAppStore>;

  function makeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
    return {
      projectRepository: repository,
      artworkLibraryRepository,
      assetRepository,
      imageProcessor,
      projectSnapshotRepository,
      syncMetaRepository,
      crossTabSync: crossTabSync.sync,
      ...overrides
    };
  }

  async function packageBytes(project: Project = store.getState().project!) {
    const { zip } = await createSightlinesPackage({
      project,
      libraryArtworks: store.getState().libraryArtworks,
      mode: "originals",
      getAsset: (id) => assetRepository.getAsset(id),
      getBlob: (key) => assetRepository.getBlob(key)
    });
    return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  }

  beforeEach(async () => {
    const testStore = createTestAppStore();
    repository = testStore.projectRepository;
    artworkLibraryRepository = testStore.artworkLibraryRepository;
    assetRepository = testStore.assetRepository;
    imageProcessor = testStore.imageProcessor;
    projectSnapshotRepository = testStore.projectSnapshotRepository;
    syncMetaRepository = testStore.syncMetaRepository;
    crossTabSync = testStore.crossTab;
    store = testStore.store;
    await store.getState().boot();
  });

  it("boots an empty repository into a persisted sample project", () => {
    const state = store.getState();

    expect(state.project?.title).toBe("Untitled Exhibition");
    expect(state.saveState).toBe("saved");
    expect(repository.projects.size).toBe(1);
    expect(state.wallContextId).toBe("wall-north");
  });

  // Every tab writes the WHOLE document, so a tab holding a stale copy is a tab
  // whose next edit erases another tab's work. These cover the refresh that
  // keeps a background tab current — and, just as importantly, that the
  // refreshing tab never writes anything back.
  describe("cross-tab refresh", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Play the part of the other tab: put a newer document straight into the
    // shared repository, the way that tab's own persist() would have.
    async function saveFromAnotherTab(changes: Partial<Project> = {}): Promise<Project> {
      const current = store.getState().project!;
      const external: Project = {
        ...current,
        title: "Saved in the other tab",
        ...changes,
        updatedAt: new Date(Date.parse(current.updatedAt) + 60_000).toISOString()
      };
      await repository.save(external);
      return external;
    }

    // jsdom's document.hasFocus() is not something a test should be at the
    // mercy of — the deferral rule is the thing under test, so drive it.
    function setFocused(focused: boolean): void {
      vi.spyOn(document, "hasFocus").mockReturnValue(focused);
    }

    it("announces every successful save so other tabs know their copy is stale", async () => {
      await store.getState().renameProject("Announced");

      const project = store.getState().project!;
      expect(crossTabSync.announced).toContainEqual({
        kind: "project-saved",
        projectId: project.id,
        updatedAt: project.updatedAt
      });
    });

    it("reloads the document when another tab saves a newer copy", async () => {
      setFocused(false);
      // Give this tab an edit history, so we can see the swap reset it.
      await store.getState().renameProject("Mine");
      const external = await saveFromAnotherTab();

      await crossTabSync.deliver({
        kind: "project-saved",
        projectId: external.id,
        updatedAt: external.updatedAt
      });

      const state = store.getState();
      expect(state.project?.title).toBe("Saved in the other tab");
      expect(state.project?.updatedAt).toBe(external.updatedAt);
      // An external swap starts a new history — undoing across it would
      // resurrect a document nobody has.
      expect(state.undoStack).toEqual([]);
      expect(state.redoStack).toEqual([]);
      expect(state.saveState).toBe("saved");
    });

    it("never writes the document back when it refreshes", async () => {
      setFocused(false);
      const external = await saveFromAnotherTab();
      const save = vi.spyOn(repository, "save");
      const snapshotsBefore = projectSnapshotRepository.records.size;

      await crossTabSync.deliver({
        kind: "project-saved",
        projectId: external.id,
        updatedAt: external.updatedAt
      });

      expect(store.getState().project?.title).toBe("Saved in the other tab");
      // This is the whole point of the feature: a tab catching up must not
      // re-save what it just read, or it becomes the clobberer itself.
      expect(save).not.toHaveBeenCalled();
      expect(projectSnapshotRepository.records.size).toBe(snapshotsBefore);
    });

    it("ignores an announcement no newer than the copy it already has", async () => {
      setFocused(false);
      // The repository holds a DIFFERENT document, so a reload would be visible.
      await saveFromAnotherTab({ title: "Should not be read" });
      const mine = store.getState().project!;
      const load = vi.spyOn(repository, "load");

      await crossTabSync.deliver({
        kind: "project-saved",
        projectId: mine.id,
        updatedAt: mine.updatedAt
      });
      await crossTabSync.deliver({
        kind: "project-saved",
        projectId: mine.id,
        updatedAt: new Date(Date.parse(mine.updatedAt) - 60_000).toISOString()
      });

      expect(load).not.toHaveBeenCalled();
      expect(store.getState().project).toBe(mine);
    });

    it("ignores an announcement about a project this tab does not have open", async () => {
      setFocused(false);
      const mine = store.getState().project!;
      const load = vi.spyOn(repository, "load");

      await crossTabSync.deliver({
        kind: "project-saved",
        projectId: "some-other-project",
        updatedAt: new Date(Date.parse(mine.updatedAt) + 60_000).toISOString()
      });

      expect(load).not.toHaveBeenCalled();
      expect(store.getState().project).toBe(mine);
    });

    it("defers the reload while the tab has focus, then takes it on focus", async () => {
      setFocused(true);
      const external = await saveFromAnotherTab();

      await crossTabSync.deliver({
        kind: "project-saved",
        projectId: external.id,
        updatedAt: external.updatedAt
      });

      // The user may be mid-drag in this tab; yanking the document out from
      // under them is worse than the staleness.
      expect(store.getState().project?.title).not.toBe("Saved in the other tab");

      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(store.getState().project?.title).toBe("Saved in the other tab");
    });

    it("keeps the document when a passive reload cannot read storage", async () => {
      setFocused(false);
      const external = await saveFromAnotherTab();
      const mine = store.getState().project!;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(repository, "load").mockRejectedValue(new Error("read failed"));

      await crossTabSync.deliver({
        kind: "project-saved",
        projectId: external.id,
        updatedAt: external.updatedAt
      });

      // A refresh that fails says nothing to the user and changes nothing.
      expect(store.getState().project).toBe(mine);
      expect(store.getState().saveState).toBe("saved");
      expect(store.getState().error).toBeNull();
      expect(store.getState().saveError).toBeNull();
      expect(warn).toHaveBeenCalled();
    });

    it("re-lists the artwork library when another tab saves a work", async () => {
      await store
        .getState()
        .addArtworksFromFiles([makeImageFile("shared.jpg")], { destination: "library" });
      const [artwork] = store.getState().libraryArtworks;
      expect(artwork).toBeDefined();
      expect(crossTabSync.announced).toContainEqual({ kind: "artworks-saved" });

      // The other tab retitles the same library work.
      await artworkLibraryRepository.save({ ...artwork, title: "Retitled elsewhere" });
      store.setState({ saveState: "saved", error: null, saveError: null });

      await crossTabSync.deliver({ kind: "artworks-saved" });

      const state = store.getState();
      expect(state.libraryArtworks.map((entry) => entry.title)).toEqual(["Retitled elsewhere"]);
      // Another tab's library write says nothing about this tab's save status.
      expect(state.saveState).toBe("saved");
      expect(state.error).toBeNull();
      expect(state.saveError).toBeNull();
    });
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

  describe("saved views", () => {
    // The sample room-main spans 0..28ft × 0..18ft in floor mm at a zero-offset
    // placement, so world (x, z) = floor mm / 1000; (4, 2.5) sits inside it.
    const insidePose = {
      position: { x: 4, y: 1.6, z: 2.5 },
      target: { x: 4, y: 1.6, z: 0 }
    };

    it("saveView appends a view, resolves its room, and round-trips through undo/redo", async () => {
      const saved = await store.getState().saveView(insidePose);
      expect(saved).not.toBeNull();
      expect(saved!.ordinal).toBe(1);
      expect(saved!.title).toBe("Saved view 1");
      expect(saved!.roomId).toBe("room-main");
      expect(store.getState().project!.savedViews).toHaveLength(1);
      expect(store.getState().undoStack).toHaveLength(1);
      expect(store.getState().undoStack.at(-1)?.label).toBe("Save view");

      await store.getState().undo();
      expect(store.getState().project!.savedViews ?? []).toEqual([]);

      await store.getState().redo();
      expect(store.getState().project!.savedViews).toHaveLength(1);
      expect(store.getState().project!.savedViews![0].id).toBe(saved!.id);
    });

    it("assigns monotonic ordinals that survive deleting an earlier view", async () => {
      const first = await store.getState().saveView(insidePose);
      const second = await store.getState().saveView(insidePose);
      const third = await store.getState().saveView(insidePose);
      expect([first!.ordinal, second!.ordinal, third!.ordinal]).toEqual([1, 2, 3]);

      await store.getState().deleteSavedView(second!.id);
      const fourth = await store.getState().saveView(insidePose);
      // Never fills the gap left by ordinal 2, and survivors keep their numbers.
      expect(fourth!.ordinal).toBe(4);
      expect(
        store.getState().project!.savedViews!.map((view) => view.ordinal)
      ).toEqual([1, 3, 4]);
    });

    it("renameSavedView trims, and no-ops on empty or unchanged titles", async () => {
      const saved = await store.getState().saveView(insidePose);
      await store.getState().renameSavedView(saved!.id, "  Gallery entrance  ");
      expect(store.getState().project!.savedViews![0].title).toBe("Gallery entrance");

      const undoDepth = store.getState().undoStack.length;
      await store.getState().renameSavedView(saved!.id, "   ");
      await store.getState().renameSavedView(saved!.id, "Gallery entrance");
      expect(store.getState().undoStack).toHaveLength(undoDepth);
    });

    it("deleteSavedView is undoable", async () => {
      const saved = await store.getState().saveView(insidePose);
      await store.getState().deleteSavedView(saved!.id);
      expect(store.getState().project!.savedViews).toEqual([]);
      expect(store.getState().undoStack.at(-1)?.label).toBe("Delete saved view");

      await store.getState().undo();
      expect(store.getState().project!.savedViews).toHaveLength(1);
      expect(store.getState().project!.savedViews![0].id).toBe(saved!.id);
    });
  });

  it("resizeWall edits a wall other than the current selection", async () => {
    await store.getState().resizeWall("wall-east", 6_000);

    expect(
      getSelectedWall(store.getState().project!, "wall-east")!.lengthMm
    ).toBeCloseTo(6_000);
    expect(store.getState().wallContextId).toBe("wall-north");
    expect(store.getState().undoStack).toHaveLength(1);
  });

  // Store-level contract for rectangle resize; geometry invariants live in editRoom.test.ts.
  describe("resizeWall (rectangle resize characterization – pipeline-merge gate)", () => {
    it('commits with the exact label "Resize wall" and populates lastGeometryEdit for a width-wall resize', async () => {
      await store.getState().resizeWall("wall-north", feetToMm(30));

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Resize wall");
      expect(state.lastGeometryEdit?.anchorVertexId).toBe("v-nw");
      expect(state.lastGeometryEdit?.changedWallIds.slice().sort()).toEqual(
        ["wall-north", "wall-south"].sort()
      );
    });

    it("reports the depth walls' ids in lastGeometryEdit for a depth-wall resize", async () => {
      await store.getState().resizeWall("wall-east", feetToMm(10));

      const state = store.getState();
      expect(state.lastGeometryEdit?.changedWallIds.slice().sort()).toEqual(
        ["wall-east", "wall-west"].sort()
      );
    });

    it("undo restores the exact previous room geometry, not just the resized wall's length", async () => {
      const before = store.getState().project!.floor.rooms[0].room;

      await store.getState().resizeWall("wall-north", feetToMm(30));
      await store.getState().undo();

      const after = store.getState().project!.floor.rooms[0].room;
      expect(after).toEqual(before);
    });
  });

  describe("setPolygonWallLength", () => {
    function installPolygonRoom() {
      const project = store.getState().project!;
      const placement = createPolygonRoomPlacement({
        roomId: "room-l",
        name: "Gallery L",
        heightMm: feetToMm(12),
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 5000, yMm: 0 },
          { xMm: 5000, yMm: 4000 },
          { xMm: 3000, yMm: 4000 },
          { xMm: 3000, yMm: 2000 },
          { xMm: 0, yMm: 2000 }
        ]
      });
      store.setState({ project: { ...project, floor: { rooms: [placement] } } });
      return placement.room.walls[0];
    }

    it("commits an irregular length edit with geometry metadata", async () => {
      const wall = installPolygonRoom();

      await store.getState().setPolygonWallLength(wall.id, 4200, "end");

      const state = store.getState();
      expect(getSelectedWall(state.project!, wall.id)?.lengthMm).toBeCloseTo(4200, 8);
      expect(state.undoStack.at(-1)?.label).toBe("Resize wall");
      expect(state.lastGeometryEdit?.anchorVertexId).toBe(wall.endVertexId);
      expect(state.lastGeometryEdit?.changedWallIds).toContain(wall.id);
    });

    it("commits an exact sub-millimetre irregular length edit", async () => {
      const wall = installPolygonRoom();

      await store.getState().setPolygonWallLength(wall.id, 5000.4, "start");

      const state = store.getState();
      expect(getSelectedWall(state.project!, wall.id)?.lengthMm).toBeCloseTo(5000.4, 8);
      expect(state.undoStack.at(-1)?.label).toBe("Resize wall");
    });

    it("surfaces placement warnings without moving wall objects", async () => {
      const wall = installPolygonRoom();
      const project = store.getState().project!;
      store.setState({
        project: {
          ...project,
          wallObjects: [
            {
              id: "art-polygon",
              wallId: wall.id,
              kind: "artwork",
              artworkId: "artwork-1",
              xMm: 4700,
              yMm: 1000,
              widthMm: 600,
              heightMm: 800
            }
          ]
        }
      });

      await store.getState().setPolygonWallLength(wall.id, 3500, "start");

      const state = store.getState();
      expect(state.placementWarnings.some((warning) => warning.wallObjectId === "art-polygon"))
        .toBe(true);
      expect(state.project!.wallObjects[0].xMm).toBe(4700);
    });
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

  it("duplicateFreestandingWall places and selects a geometry-only copy in one edit", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });
    const source = store.getState().project!.floor.rooms[0].room.freestandingWalls[0];
    const undoBefore = store.getState().undoStack.length;

    await store.getState().duplicateFreestandingWall(source.id, { xMm: 6000, yMm: 4000 });

    const state = store.getState();
    const walls = state.project!.floor.rooms[0].room.freestandingWalls;
    expect(walls).toHaveLength(2);
    const copy = walls.find((wall) => wall.id !== source.id)!;
    expect((copy.startXMm + copy.endXMm) / 2).toBeCloseTo(6000);
    expect((copy.startYMm + copy.endYMm) / 2).toBeCloseTo(4000);
    expect(copy.endXMm - copy.startXMm).toBeCloseTo(source.endXMm - source.startXMm);
    expect(copy.thicknessMm).toBe(source.thicknessMm);
    expect(freestandingWallIdOf(state.selection)).toBe(copy.id);
    expect(state.undoStack).toHaveLength(undoBefore + 1);
    expect(state.undoStack.at(-1)?.label).toBe("Duplicate partition");

    await state.undo();
    expect(store.getState().project!.floor.rooms[0].room.freestandingWalls).toHaveLength(1);
  });

  it("duplicateFreestandingWall reports an invalid drop without committing", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });
    const source = store.getState().project!.floor.rooms[0].room.freestandingWalls[0];
    const undoBefore = store.getState().undoStack.length;

    await store
      .getState()
      .duplicateFreestandingWall(source.id, { xMm: 100_000, yMm: 100_000 });

    expect(store.getState().project!.floor.rooms[0].room.freestandingWalls).toHaveLength(1);
    expect(store.getState().undoStack).toHaveLength(undoBefore);
    expect(store.getState().error).toMatch(/inside a room/i);
  });

  it("setFreestandingWallClearance translates the partition and is undoable", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });
    const beforeRoom = store.getState().project!.floor.rooms[0].room;
    const before = beforeRoom.freestandingWalls[0];
    const current = getPartitionClearances(beforeRoom, before).normal.plus.hit!.distanceMm;

    await store
      .getState()
      .setFreestandingWallClearance(before.id, "normal-plus", current - 200);

    const state = store.getState();
    const afterRoom = state.project!.floor.rooms[0].room;
    const moved = afterRoom.freestandingWalls[0];
    expect(moved.startYMm).toBeCloseTo(before.startYMm + 200);
    expect(moved.endYMm).toBeCloseTo(before.endYMm + 200);
    expect(getPartitionClearances(afterRoom, moved).normal.plus.hit?.distanceMm).toBeCloseTo(
      current - 200
    );
    expect(state.undoStack.at(-1)?.label).toBe("Move partition");

    await state.undo();
    expect(
      store.getState().project!.floor.rooms[0].room.freestandingWalls[0].startYMm
    ).toBeCloseTo(before.startYMm);
  });

  it("setFreestandingWallClearance rejects a move beyond the opposite boundary", async () => {
    await store
      .getState()
      .addFreestandingWall({ xMm: 3000, yMm: 2700 }, { xMm: 5000, yMm: 2700 });
    const wall = store.getState().project!.floor.rooms[0].room.freestandingWalls[0];
    const undoBefore = store.getState().undoStack.length;

    await store.getState().setFreestandingWallClearance(wall.id, "normal-plus", 100_000);

    expect(store.getState().undoStack).toHaveLength(undoBefore);
    expect(store.getState().error).toMatch(/not enough room/i);
  });

  it("deleteFreestandingWall removes both faces' objects in one undo step", async () => {
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

  it("renameProjectById does not save a stale snapshot when the project becomes open", async () => {
    const target = { ...store.getState().project!, id: "rename-target", title: "Old" };
    await repository.save(target);
    let releaseLoad!: (project: Project) => void;
    const load = vi.spyOn(repository, "load").mockImplementationOnce(
      () => new Promise<Project>((resolve) => (releaseLoad = resolve))
    );

    const rename = store.getState().renameProjectById(target.id, "Renamed");
    store.setState({ project: { ...target, unit: "m" } });
    releaseLoad(target);
    await rename;

    expect(store.getState().project?.title).toBe("Renamed");
    expect(store.getState().project?.unit).toBe("m");
    expect(repository.projects.get(target.id)?.unit).toBe("m");
    load.mockRestore();
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

  describe("setDefaultWallHeightMm", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("updates the project's default wall height, persists, stamps updatedAt, and is undoable", async () => {
      const before = store.getState().project!;
      const previousHeight = before.defaultWallHeightMm;
      const previousUpdatedAt = before.updatedAt;

      // Ensure updatedAt cannot match by millisecond coincidence.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(previousUpdatedAt).getTime() + 1_000);

      await store.getState().setDefaultWallHeightMm(2_500);

      const state = store.getState();
      expect(state.project?.defaultWallHeightMm).toBe(2_500);
      expect(state.project?.updatedAt).not.toBe(previousUpdatedAt);
      expect(state.undoStack).toHaveLength(1);
      expect(state.undoStack.at(-1)?.label).toBe("Change default wall height");

      const persisted = repository.projects.get(state.project!.id)!;
      expect(persisted.defaultWallHeightMm).toBe(2_500);

      await store.getState().undo();
      expect(store.getState().project?.defaultWallHeightMm).toBe(previousHeight);
    });

    it("leaves existing walls' heightMm unchanged", async () => {
      const before = store.getState().project!;
      const wallHeightsBefore = before.floor.rooms.flatMap((placement) =>
        placement.room.walls.map((wall) => wall.heightMm)
      );

      await store.getState().setDefaultWallHeightMm(2_500);

      const wallHeightsAfter = store
        .getState()
        .project!.floor.rooms.flatMap((placement) =>
          placement.room.walls.map((wall) => wall.heightMm)
        );
      expect(wallHeightsAfter).toEqual(wallHeightsBefore);
    });

    it("a room created after the edit uses the new default wall height", async () => {
      await store.getState().setDefaultWallHeightMm(2_500);
      await store.getState().addRectangleRoom();

      const added = store.getState().project!.floor.rooms.at(-1)!;
      expect(added.room.walls.every((wall) => wall.heightMm === 2_500)).toBe(true);
    });

    it("skips a no-op call that does not change the height", async () => {
      const before = store.getState().project!;

      await store.getState().setDefaultWallHeightMm(before.defaultWallHeightMm);

      expect(store.getState().undoStack).toHaveLength(0);
      expect(store.getState().project).toBe(before);
    });

    it("skips a non-positive or non-finite height", async () => {
      const before = store.getState().project!;

      await store.getState().setDefaultWallHeightMm(0);
      await store.getState().setDefaultWallHeightMm(-100);
      await store.getState().setDefaultWallHeightMm(Number.NaN);
      await store.getState().setDefaultWallHeightMm(Number.POSITIVE_INFINITY);

      expect(store.getState().undoStack).toHaveLength(0);
      expect(store.getState().project).toBe(before);
    });

    it("is a no-op when there is no open project", async () => {
      const emptyStore = createAppStore(makeDeps());

      await emptyStore.getState().setDefaultWallHeightMm(2_500);

      expect(emptyStore.getState().undoStack).toHaveLength(0);
      expect(emptyStore.getState().project).toBeNull();
    });
  });

  describe("setDefaultCenterlineHeightMm", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("updates the project's default eyeline height, persists, stamps updatedAt, and is undoable", async () => {
      const before = store.getState().project!;
      const previousHeight = before.defaultCenterlineHeightMm;
      const previousUpdatedAt = before.updatedAt;

      // Ensure updatedAt cannot match by millisecond coincidence.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(previousUpdatedAt).getTime() + 1_000);

      await store.getState().setDefaultCenterlineHeightMm(1_500);

      const state = store.getState();
      expect(state.project?.defaultCenterlineHeightMm).toBe(1_500);
      expect(state.project?.updatedAt).not.toBe(previousUpdatedAt);
      expect(state.undoStack).toHaveLength(1);
      expect(state.undoStack.at(-1)?.label).toBe("Change default eyeline height");

      const persisted = repository.projects.get(state.project!.id)!;
      expect(persisted.defaultCenterlineHeightMm).toBe(1_500);

      await store.getState().undo();
      expect(store.getState().project?.defaultCenterlineHeightMm).toBe(previousHeight);
    });

    it("skips a no-op call that does not change the height", async () => {
      const before = store.getState().project!;

      await store.getState().setDefaultCenterlineHeightMm(before.defaultCenterlineHeightMm);

      expect(store.getState().undoStack).toHaveLength(0);
      expect(store.getState().project).toBe(before);
    });

    it("skips a non-positive or non-finite height", async () => {
      const before = store.getState().project!;

      await store.getState().setDefaultCenterlineHeightMm(0);
      await store.getState().setDefaultCenterlineHeightMm(-100);
      await store.getState().setDefaultCenterlineHeightMm(Number.NaN);
      await store.getState().setDefaultCenterlineHeightMm(Number.POSITIVE_INFINITY);

      expect(store.getState().undoStack).toHaveLength(0);
      expect(store.getState().project).toBe(before);
    });

    it("is a no-op when there is no open project", async () => {
      const emptyStore = createAppStore(makeDeps());

      await emptyStore.getState().setDefaultCenterlineHeightMm(1_500);

      expect(emptyStore.getState().undoStack).toHaveLength(0);
      expect(emptyStore.getState().project).toBeNull();
    });
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

  it("addDrawnRectangleRoom adds a room in one undo step and selects it", async () => {
    await store.getState().addDrawnRectangleRoom({
      offsetXMm: 12_000,
      offsetYMm: 0,
      widthMm: 4_000,
      depthMm: 2_500
    });

    const state = store.getState();
    expect(state.project!.floor.rooms).toHaveLength(2);
    const added = state.project!.floor.rooms[1];
    expect(added.roomId).toBe("room-2");
    expect(added.offsetXMm).toBe(12_000);
    expect(added.offsetYMm).toBe(0);
    expect(added.room.walls).toHaveLength(4);
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack.at(-1)?.label).toBe("Add Gallery 2");
    expect(roomIdOf(state.selection)).toBe("room-2");
    expect(state.wallContextId).toBe("room-2-wall-north");
    expect(state.viewMode).toBe("plan");

    await store.getState().undo();
    expect(store.getState().project!.floor.rooms).toHaveLength(1);
  });

  it("addDrawnRectangleRoom rejects non-positive dimensions without committing", async () => {
    const before = store.getState().project!;

    await store.getState().addDrawnRectangleRoom({
      offsetXMm: 0,
      offsetYMm: 0,
      widthMm: 0,
      depthMm: 2_500
    });

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
      // Shortening a wall warns instead of silently moving its artwork.
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

  describe("moveRoomWall", () => {
    it("commits one undo entry and surfaces bounds warnings for objects on changed walls", async () => {
      const project = store.getState().project!;
      store.setState({
        project: {
          ...project,
          wallObjects: [
            {
              id: "art-1",
              wallId: "wall-east",
              kind: "artwork",
              artworkId: "artwork-1",
              xMm: feetToMm(17.5),
              yMm: feetToMm(5),
              widthMm: 600,
              heightMm: 800
            }
          ]
        }
      });

      await store.getState().moveRoomWall("room-main", "wall-north", 1000);

      const state = store.getState();
      expect(state.undoStack.at(-1)?.label).toBe("Move wall");
      expect(state.lastGeometryEdit?.changedWallIds.sort()).toEqual(
        ["wall-east", "wall-north", "wall-west"].sort()
      );
      expect(state.placementWarnings.some((warning) => warning.wallObjectId === "art-1")).toBe(
        true
      );
      expect(
        state.project!.wallObjects.find((object) => object.id === "art-1")?.xMm
      ).toBe(feetToMm(17.5));
    });

    it("rejects an offset that collapses the wall without committing", async () => {
      const before = store.getState().project!;

      // Collapse the north wall onto the south wall.
      await store.getState().moveRoomWall("room-main", "wall-north", feetToMm(18));

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

  it("does not open the package or write library data when its project save fails", async () => {
    const successToast = vi.spyOn(toast, "success");
    const before = store.getState().project;
    const fixture = makeFixture();
    const { zip } = await createSightlinesPackage({
      project: fixture.project,
      libraryArtworks: fixture.library,
      mode: "metadata-only",
      getAsset: fixture.getAsset,
      getBlob: fixture.getBlob
    });
    repository.save = async () => {
      throw new Error("project save failed");
    };

    await store.getState().importSightlinesPackage(zip.buffer as ArrayBuffer);

    expect(store.getState().project).toBe(before);
    expect(store.getState().error).toMatch(/Import failed: project save failed/);
    expect(artworkLibraryRepository.artworks.size).toBe(0);
    expect(assetRepository.assets.size).toBe(0);
    expect(successToast).not.toHaveBeenCalled();
    successToast.mockRestore();
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

  describe("recovery snapshots", () => {
    // Snapshots are written fire-and-forget; let their microtask/timer settle.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("snapshots a project once per session when it becomes the open document", async () => {
      await flush(); // boot's open snapshot of the sample lands first

      const other: Project = {
        ...createSampleProject(),
        id: "other-project-000001",
        title: "Other"
      };
      await repository.save(other);

      const bootId = store.getState().project!.id;

      await store.getState().openProject(other.id);
      await flush();
      expect((await projectSnapshotRepository.listByProject(other.id))).toHaveLength(1);

      // Switch away and back within the same session — no second snapshot.
      await store.getState().openProject(bootId);
      await store.getState().openProject(other.id);
      await flush();
      expect((await projectSnapshotRepository.listByProject(other.id))).toHaveLength(1);
    });

    it("interval-gates snapshots taken from the save path", async () => {
      const bootId = store.getState().project!.id;
      await flush();
      expect((await projectSnapshotRepository.listByProject(bootId))).toHaveLength(1);

      // Anchor to real now so the gate compares against boot's snapshot time.
      let clock = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);

      // An edit inside the interval doesn't add a snapshot.
      await store.getState().renameProject("Renamed Once");
      await flush();
      expect((await projectSnapshotRepository.listByProject(bootId))).toHaveLength(1);

      // Past the interval, the next successful save snapshots (distinct copy).
      clock += SNAPSHOT_MIN_INTERVAL_MS + 1000;
      await store.getState().renameProject("Renamed Twice");
      await flush();
      expect((await projectSnapshotRepository.listByProject(bootId))).toHaveLength(2);

      nowSpy.mockRestore();
    });

    it("a failing snapshot repository never breaks saving", async () => {
      const failingSnapshots = new InMemoryProjectSnapshotRepository();
      failingSnapshots.add = async () => {
        throw new Error("snapshot boom");
      };
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const s = createAppStore(
        makeDeps({ projectSnapshotRepository: failingSnapshots })
      );
      await s.getState().boot();
      await s.getState().renameProject("Edited");
      await flush();

      expect(s.getState().saveState).toBe("saved");
      warn.mockRestore();
    });

    it("offers recovery from the newest valid snapshot after a typed load failure, then restores it", async () => {
      const projectId = "corrupt-project-00001";
      const good: Project = {
        ...createSampleProject(),
        id: projectId,
        title: "Recoverable"
      };

      const snapshots = new InMemoryProjectSnapshotRepository();
      await snapshots.add({
        projectId,
        createdAt: "2026-07-19T00:00:00.000Z",
        projectTitle: good.title,
        fingerprint: "fp",
        project: good
      });

      const repo = new InMemoryProjectRepository();
      repo.list = async () => [
        {
          id: projectId,
          title: "Recoverable",
          updatedAt: "2026-07-19T00:00:00.000Z",
          roomCount: 0,
          artworkCount: 0
        }
      ];
      repo.load = async () => {
        throw new ProjectValidationError("stored document failed validation", projectId);
      };

      const s = createAppStore(
        makeDeps({ projectRepository: repo, projectSnapshotRepository: snapshots })
      );
      await s.getState().boot();

      const offer = s.getState().recoveryOffer;
      expect(offer?.projectId).toBe(projectId);
      expect(offer?.snapshotKey).toBeTruthy();
      expect(offer?.createdAt).toBe("2026-07-19T00:00:00.000Z");

      await s.getState().acceptRecovery();
      const state = s.getState();
      expect(state.recoveryOffer).toBeNull();
      expect(state.project?.id).toBe(projectId);
      expect(state.project?.title).toBe("Recoverable");
      expect(state.saveState).toBe("saved");
    });

    it("does not offer recovery when a load fails with an untyped operational error", async () => {
      const repo = new InMemoryProjectRepository();
      const stored = createSampleProject();
      repo.projects.set(stored.id, stored);
      repo.load = async () => {
        throw new Error("transient read error");
      };

      const s = createAppStore(makeDeps({ projectRepository: repo }));
      await s.getState().boot();

      expect(s.getState().recoveryOffer).toBeNull();
      expect(s.getState().saveState).toBe("error");
    });
  });

  // The link-only repair every document-entry path runs through setDocument.
  // Adopt and realign are applied; a twin is never created on open.
  describe("shared-opening load repair", () => {
    // Two abutting rooms: room-a's east wall and room-b's west wall are one
    // coincident twin pair, mirroring opening x to (3000 − x).
    const A_EAST = "room-a-wall-east";
    const B_WEST = "room-b-wall-west";
    const DOOR_Y_MM = 1015; // door center = height/2 (2030/2), the placement default.

    type DoorSpec = { id: string; wallId: string; xMm: number; connectsToObjectId?: string };

    function sharedWallDocument(id: string, doors: DoorSpec[]): Project {
      const base = store.getState().project!;
      return {
        ...base,
        id,
        title: id,
        wallObjects: doors.map((spec) => ({
          kind: "door" as const,
          blocksPlacement: true,
          yMm: DOOR_Y_MM,
          widthMm: 915,
          heightMm: 2030,
          ...spec
        })),
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
            }),
            createRectangularRoomPlacement({
              roomId: "room-b",
              name: "Room B",
              widthMm: 4000,
              depthMm: 3000,
              heightMm: 2500,
              offsetXMm: 4000,
              offsetYMm: 0
            })
          ]
        }
      };
    }

    // A legacy one-sided-per-room pair: two aligned, unpaired doors that are
    // really one physical opening. The load pass adopts them into a pair.
    const unlinkedPair: DoorSpec[] = [
      { id: "door-a", wallId: A_EAST, xMm: 1200 },
      { id: "door-b", wallId: B_WEST, xMm: 1800 }
    ];

    function partnerOf(project: Project | null, openingId: string): string | undefined {
      const object = project?.wallObjects.find((candidate) => candidate.id === openingId);
      return object && (object.kind === "door" || object.kind === "window")
        ? object.connectsToObjectId
        : undefined;
    }

    it("links a legacy pair on boot, with no undo entry", async () => {
      const warning = vi.spyOn(toast, "warning");
      const repo = new InMemoryProjectRepository();
      await repo.save(sharedWallDocument("boot-legacy-000001", unlinkedPair));

      const s = createAppStore(makeDeps({ projectRepository: repo }));
      await s.getState().boot();

      const state = s.getState();
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      expect(partnerOf(state.project, "door-b")).toBe("door-a");
      // The repair rides the document swap; it is not an edit the user can undo.
      expect(state.undoStack).toHaveLength(0);
      expect(state.redoStack).toHaveLength(0);
      expect(warning).toHaveBeenCalledWith(
        "One shared opening was linked while opening this project."
      );
      warning.mockRestore();
    });

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("writes the repair back on open, so a reload reads the repaired document", async () => {
      // The hazard this closes: the repair used to live in memory only while
      // the badge settled on a state the topbar explained as "Saved
      // automatically on this device". One reload and the repair was gone.
      const document = sharedWallDocument("open-legacy-000001", unlinkedPair);
      await repository.save(document);

      await store.getState().openProject(document.id);

      const state = store.getState();
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      expect(state.saveState).toBe("saved");

      // What a reload actually reads back — the assertion with the teeth.
      const reloaded = await repository.load(document.id);
      expect(partnerOf(reloaded, "door-a")).toBe("door-b");
      expect(partnerOf(reloaded, "door-b")).toBe("door-a");
    });

    it("lands the pre-repair recovery copy BEFORE overwriting the original", async () => {
      // Ordering, not just presence: the repaired write destroys the stored
      // original, so the snapshot of it must already be down. A crash between
      // the two would otherwise leave the user with neither.
      const document = sharedWallDocument("open-order-000001", unlinkedPair);
      await repository.save(document);

      const events: string[] = [];
      const linkOf = (project: Project) => partnerOf(project, "door-a") ?? "unlinked";

      let releaseSnapshot = () => {};
      const snapshotGate = new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });
      const addSnapshot = projectSnapshotRepository.add.bind(projectSnapshotRepository);
      projectSnapshotRepository.add = async (record) => {
        events.push(`snapshot-start:${linkOf(record.project)}`);
        await snapshotGate;
        await addSnapshot(record);
        events.push("snapshot-done");
      };
      const save = repository.save.bind(repository);
      repository.save = async (project) => {
        events.push(`save:${linkOf(project)}`);
        await save(project);
      };

      const open = store.getState().openProject(document.id);
      // Give the open every chance to race ahead while the copy is in flight.
      await flush();
      expect(events).toEqual(["snapshot-start:unlinked"]);

      releaseSnapshot();
      await open;
      await flush();

      expect(events).toEqual([
        "snapshot-start:unlinked",
        "snapshot-done",
        "save:door-b"
      ]);

      // And the copy that landed is the original, not the repaired document.
      const [summary] = await projectSnapshotRepository.listByProject(document.id);
      const record = await projectSnapshotRepository.get(summary.key);
      expect(partnerOf(record!.project, "door-a")).toBeUndefined();
      // Happy path, stated: the copy landed, so the write-back ran and the badge
      // is entitled to say so.
      expect(store.getState().saveState).toBe("saved");
    });

    // Hold the recovery copy open on a promise the test releases, so the window
    // in which the app is interactive mid-open is a fact rather than a race.
    function deferSnapshotsOf(projectId: string) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const add = projectSnapshotRepository.add.bind(projectSnapshotRepository);
      projectSnapshotRepository.add = async (record) => {
        if (record.projectId === projectId) await gate;
        await add(record);
      };
      return () => release();
    }

    it("skips the repair write-back when the recovery copy could not be written", async () => {
      // The hazard: overwriting the user's ONLY stored copy with a repaired
      // document when nothing was preserved behind it. Opening still succeeds —
      // a snapshot problem must never keep a project from opening.
      const document = sharedWallDocument("open-copy-failed-000001", unlinkedPair);
      await repository.save(document);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      projectSnapshotRepository.add = async () => {
        throw new Error("snapshot boom");
      };

      await store.getState().openProject(document.id);
      await flush();

      const state = store.getState();
      // Opened, and repaired in memory.
      expect(state.project?.id).toBe(document.id);
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      // The assertion with the teeth: storage still holds the untouched original.
      expect(repository.projects.get(document.id)).toBe(document);
      expect(partnerOf(await repository.load(document.id), "door-a")).toBeUndefined();
      // "idle" renders as "Not saved yet" — the repair really is unsaved.
      expect(state.saveState).toBe("idle");
      warn.mockRestore();
    });

    it("does not record a failed recovery copy as taken, so a later open retries it", async () => {
      // Marking the snapshot as taken before it lands used to strand the project
      // for the rest of the session: never copied, and never copyable again.
      const sampleId = store.getState().project!.id;
      const document = sharedWallDocument("open-copy-retry-000001", unlinkedPair);
      await repository.save(document);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const add = vi
        .spyOn(projectSnapshotRepository, "add")
        .mockRejectedValueOnce(new Error("snapshot boom"));

      await store.getState().openProject(document.id);
      await flush();
      expect(add).toHaveBeenCalledTimes(1);
      expect(await projectSnapshotRepository.listByProject(document.id)).toHaveLength(0);
      expect(partnerOf(await repository.load(document.id), "door-a")).toBeUndefined();

      // Switch away and back inside the same session: the copy is attempted
      // again, lands, and only then does the repair get written back.
      await store.getState().openProject(sampleId);
      await store.getState().openProject(document.id);
      await flush();

      const summaries = await projectSnapshotRepository.listByProject(document.id);
      expect(summaries).toHaveLength(1);
      // The teeth: the copy that landed is the PRE-repair original. A guard that
      // records the failed attempt as taken lets the second open skip straight to
      // the write-back, and the only snapshot on file ends up being the repaired
      // document written from the save path — which preserves nothing.
      const record = await projectSnapshotRepository.get(summaries[0].key);
      expect(partnerOf(record!.project, "door-a")).toBeUndefined();
      expect(partnerOf(await repository.load(document.id), "door-a")).toBe("door-b");
      expect(store.getState().saveState).toBe("saved");
      warn.mockRestore();
    });

    it("stops retrying a recovery copy that keeps failing, rather than retrying every open", async () => {
      // Retrying forever would make a device that simply cannot store snapshots
      // pay the full failing write on every single open.
      const sampleId = store.getState().project!.id;
      const document = sharedWallDocument("open-copy-hopeless-000001", unlinkedPair);
      await repository.save(document);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const add = vi
        .spyOn(projectSnapshotRepository, "add")
        .mockRejectedValue(new Error("snapshot boom"));

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await store.getState().openProject(document.id);
        await flush();
        await store.getState().openProject(sampleId);
      }

      // Three attempts for this project (the boot sample takes one of its own).
      expect(
        add.mock.calls.filter(([record]) => record.projectId === document.id)
      ).toHaveLength(3);
      // Still no write-back, at any point.
      expect(partnerOf(await repository.load(document.id), "door-a")).toBeUndefined();
      warn.mockRestore();
    });

    it("does not write the stale load-time document over an edit made during the wait", async () => {
      // The app is interactive while the recovery copy is in flight. A rename
      // committed in that window saves FIRST; writing the load-time document
      // afterwards would silently undo it and badge the result "Saved".
      const document = sharedWallDocument("open-stale-edit-000001", unlinkedPair);
      await repository.save(document);
      const releaseSnapshot = deferSnapshotsOf(document.id);

      const open = store.getState().openProject(document.id);
      await flush();
      expect(store.getState().project?.id).toBe(document.id);

      await store.getState().renameProject("Winter Show");

      releaseSnapshot();
      await open;
      await flush();

      const state = store.getState();
      expect(state.project?.title).toBe("Winter Show");
      const stored = await repository.load(document.id);
      // The teeth: the rename survives in storage.
      expect(stored.title).toBe("Winter Show");
      // And nothing was lost by skipping — the edit was made on top of the
      // already-repaired in-memory document, so the user's own save carried it.
      expect(partnerOf(stored, "door-a")).toBe("door-b");
      // The badge belongs to the rename's own save, not to a skipped write-back.
      expect(state.saveState).toBe("saved");
    });

    it("does not write the first project's stale document after a switch during the wait", async () => {
      const first = sharedWallDocument("open-switch-from-000001", unlinkedPair);
      const second = sharedWallDocument("open-switch-to-000002", []);
      await repository.save(first);
      await repository.save(second);

      const saved: string[] = [];
      const save = repository.save.bind(repository);
      repository.save = async (project) => {
        saved.push(project.id);
        await save(project);
      };
      const releaseSnapshot = deferSnapshotsOf(first.id);

      const open = store.getState().openProject(first.id);
      await flush();
      expect(store.getState().project?.id).toBe(first.id);

      await store.getState().openProject(second.id);

      releaseSnapshot();
      await open;
      await flush();

      // The user is on the second project and stays there.
      expect(store.getState().project?.id).toBe(second.id);
      // The first project's stored document is untouched — a document that is no
      // longer open must not be written, however repaired the copy in hand is.
      expect(saved).not.toContain(first.id);
      expect(repository.projects.get(first.id)).toBe(first);
      expect(partnerOf(await repository.load(first.id), "door-a")).toBeUndefined();
    });

    it("writes the repair back on boot, behind a recovery copy of the original", async () => {
      const repo = new InMemoryProjectRepository();
      const document = sharedWallDocument("boot-persist-000001", unlinkedPair);
      await repo.save(document);

      const s = createAppStore(makeDeps({ projectRepository: repo }));
      await s.getState().boot();

      expect(s.getState().saveState).toBe("saved");
      expect(partnerOf(await repo.load(document.id), "door-a")).toBe("door-b");

      const [summary] = await projectSnapshotRepository.listByProject(document.id);
      const record = await projectSnapshotRepository.get(summary.key);
      expect(partnerOf(record!.project, "door-a")).toBeUndefined();
    });

    it("keeps a repair that could not be written visible as a save failure", async () => {
      // A repair the device refused to store must never look saved: the user
      // has to know this document is still one reload from losing the link.
      const document = sharedWallDocument("open-failed-write-000001", unlinkedPair);
      await repository.save(document);
      repository.save = async () => {
        throw new Error("Simulated project save failure");
      };

      await store.getState().openProject(document.id);
      await flush();

      const state = store.getState();
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      expect(state.saveState).toBe("error");
      expect(state.saveError?.scope).toBe("project");
      expect(state.error).toContain("Simulated project save failure");
      // The original stays recoverable — the snapshot went down regardless.
      expect(await projectSnapshotRepository.listByProject(document.id)).toHaveLength(1);
    });

    it("loadBenchmarkFixture still writes nothing, repair or not", async () => {
      // Benchmark data must never replace a user's saved local project, so the
      // dev entry point calls setDocument directly and opts out of the
      // write-back by construction. Its unwritten document is honestly "idle".
      const save = vi.spyOn(repository, "save");
      const document = sharedWallDocument("benchmark-legacy-000001", unlinkedPair);

      store.getState().loadBenchmarkFixture(document, []);
      await flush();

      const state = store.getState();
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      expect(save).not.toHaveBeenCalled();
      expect(repository.projects.has(document.id)).toBe(false);
      expect(await projectSnapshotRepository.listByProject(document.id)).toHaveLength(0);
      expect(state.saveState).toBe("idle");
      save.mockRestore();
    });

    it("writes the repair back when a duplicate copies a document that needs one", async () => {
      const source = sharedWallDocument("dup-legacy-000001", unlinkedPair);
      await repository.save(source);

      await store.getState().duplicateProject(source.id);

      const copy = store.getState().project!;
      expect(copy.id).not.toBe(source.id);
      expect(partnerOf(copy, "door-a")).toBe("door-b");
      expect(store.getState().saveState).toBe("saved");
      expect(partnerOf(await repository.load(copy.id), "door-a")).toBe("door-b");
      // The source is a different document and is left exactly as it was.
      expect(partnerOf(await repository.load(source.id), "door-a")).toBeUndefined();
    });

    it("declines to create a twin on open, leaving the document byte-identical", async () => {
      // Creating geometry in a document the user just opened is a bolder claim
      // than doing it during an edit they initiated: the room facing this door
      // must not gain one. The issues rail reports it as `missing-twin`.
      const warning = vi.spyOn(toast, "warning");
      const document = sharedWallDocument("open-one-sided-000001", [
        { id: "door-a", wallId: A_EAST, xMm: 1200 }
      ]);
      await repository.save(document);

      await store.getState().openProject(document.id);

      const state = store.getState();
      expect(state.project!.wallObjects).toHaveLength(1);
      expect(partnerOf(state.project, "door-a")).toBeUndefined();
      // Same reference in and out, so App.tsx's memo on project identity holds.
      expect(state.project).toBe(repository.projects.get(document.id));
      expect(state.saveState).toBe("saved");
      expect(state.undoStack).toHaveLength(0);
      expect(warning).not.toHaveBeenCalled();
      warning.mockRestore();
    });

    it("realigns a drifted pair on open", async () => {
      const document = sharedWallDocument("open-drifted-000001", [
        { id: "door-a", wallId: A_EAST, xMm: 1200, connectsToObjectId: "door-b" },
        { id: "door-b", wallId: B_WEST, xMm: 1700, connectsToObjectId: "door-a" }
      ]);
      await repository.save(document);

      await store.getState().openProject(document.id);

      const moved = store
        .getState()
        .project!.wallObjects.find((object) => object.id === "door-b")!;
      expect(moved.xMm).toBeCloseTo(1800);
      expect(store.getState().undoStack).toHaveLength(0);
    });

    it("reports a collision when a realign lands the moved half on artwork", async () => {
      // isBlockingKind deliberately excludes artwork (overlap policy), so
      // repairSharedOpeningsOnLoad's realign is free to land door-b's mirrored
      // slot on top of a hung work. That must surface as a placementWarning
      // instead of vanishing into setDocument's unconditional reset.
      const base = sharedWallDocument("open-realign-collision-000001", [
        { id: "door-a", wallId: A_EAST, xMm: 1200, connectsToObjectId: "door-b" },
        { id: "door-b", wallId: B_WEST, xMm: 1700, connectsToObjectId: "door-a" }
      ]);
      const document: Project = {
        ...base,
        wallObjects: [
          ...base.wallObjects,
          {
            id: "art-on-b-west",
            kind: "artwork",
            artworkId: "artwork-not-in-library",
            wallId: B_WEST,
            // Sits exactly where door-a's mirror (3000 − 1200 = 1800) lands.
            xMm: 1800,
            yMm: DOOR_Y_MM,
            widthMm: 600,
            heightMm: 800
          }
        ]
      };
      await repository.save(document);

      await store.getState().openProject(document.id);

      const state = store.getState();
      const moved = state.project!.wallObjects.find((object) => object.id === "door-b")!;
      expect(moved.xMm).toBeCloseTo(1800);
      expect(
        state.placementWarnings.some(
          (warning) => warning.wallObjectId === "door-b" && warning.type === "collision"
        )
      ).toBe(true);
    });

    it("reports no warning when a realign lands the moved half somewhere clear", async () => {
      const base = sharedWallDocument("open-realign-clear-000001", [
        { id: "door-a", wallId: A_EAST, xMm: 1200, connectsToObjectId: "door-b" },
        { id: "door-b", wallId: B_WEST, xMm: 1700, connectsToObjectId: "door-a" }
      ]);
      const document: Project = {
        ...base,
        wallObjects: [
          ...base.wallObjects,
          {
            id: "art-far-from-mirror",
            kind: "artwork",
            artworkId: "artwork-not-in-library",
            wallId: B_WEST,
            // Far from the mirrored landing spot (1800): no overlap.
            xMm: 400,
            yMm: DOOR_Y_MM,
            widthMm: 600,
            heightMm: 800
          }
        ]
      };
      await repository.save(document);

      await store.getState().openProject(document.id);

      const state = store.getState();
      const moved = state.project!.wallObjects.find((object) => object.id === "door-b")!;
      expect(moved.xMm).toBeCloseTo(1800);
      expect(state.placementWarnings).toEqual([]);
    });

    it("installs placementWarnings: [] for a document that needed no repair", async () => {
      // Already mirrored exactly (door-b at 3000 − 1200 = 1800): no realign
      // fires, so setDocument must still settle on the empty array, not skip
      // installing placementWarnings entirely.
      const document = sharedWallDocument("open-healthy-000001", [
        { id: "door-a", wallId: A_EAST, xMm: 1200, connectsToObjectId: "door-b" },
        { id: "door-b", wallId: B_WEST, xMm: 1800, connectsToObjectId: "door-a" }
      ]);
      await repository.save(document);

      await store.getState().openProject(document.id);

      expect(store.getState().placementWarnings).toEqual([]);
    });

    it("preserves a legacy non-boundary pair on open", async () => {
      // Settled decision 4: a pair whose walls do not face each other is a
      // caution the user resolves, not something load repair severs.
      const document = sharedWallDocument("open-nonboundary-000001", [
        { id: "door-a", wallId: "room-a-wall-north", xMm: 1200, connectsToObjectId: "door-b" },
        { id: "door-b", wallId: "room-a-wall-south", xMm: 2400, connectsToObjectId: "door-a" }
      ]);
      await repository.save(document);

      await store.getState().openProject(document.id);

      const state = store.getState();
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      expect(partnerOf(state.project, "door-b")).toBe("door-a");
      expect(state.project).toBe(repository.projects.get(document.id));
    });

    it("runs on a .sightlines package import", async () => {
      const document = sharedWallDocument("package-legacy-000001", unlinkedPair);

      await store.getState().importSightlinesPackage(await packageBytes(document));

      const state = store.getState();
      expect(state.project!.id).toBe(document.id);
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      // This path persists BEFORE it opens (the project write has to precede
      // the asset writes), so the repair needs a second write to land.
      expect(state.saveState).toBe("saved");
      expect(partnerOf(await repository.load(document.id), "door-a")).toBe("door-b");
    });

    it("toasts success and reports completion when the repair write-back succeeds", async () => {
      const successToast = vi.spyOn(toast, "success");
      const track = vi.spyOn(telemetry, "track");
      const document = sharedWallDocument("package-repair-ok-000001", unlinkedPair);

      await store.getState().importSightlinesPackage(await packageBytes(document));

      expect(store.getState().saveState).toBe("saved");
      expect(successToast).toHaveBeenCalledWith(`Imported “${document.title}”`);
      expect(track).toHaveBeenCalledWith("package_import_completed", {});
      successToast.mockRestore();
      track.mockRestore();
    });

    it("attempts only one write when the import needs no repair", async () => {
      const successToast = vi.spyOn(toast, "success");
      const track = vi.spyOn(telemetry, "track");
      const saveSpy = vi.spyOn(repository, "save");
      // Already mirrored (door-b at 3000 − 1200 = 1800): setDocument's repair
      // pass has nothing to do, so commit.project === opened and the second
      // `persist` in commitPackageImport must never run.
      const document = sharedWallDocument("package-no-repair-000001", [
        { id: "door-a", wallId: A_EAST, xMm: 1200, connectsToObjectId: "door-b" },
        { id: "door-b", wallId: B_WEST, xMm: 1800, connectsToObjectId: "door-a" }
      ]);

      await store.getState().importSightlinesPackage(await packageBytes(document));

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(store.getState().saveState).toBe("saved");
      expect(successToast).toHaveBeenCalledWith(`Imported “${document.title}”`);
      expect(track).toHaveBeenCalledWith("package_import_completed", {});
      saveSpy.mockRestore();
      successToast.mockRestore();
      track.mockRestore();
    });

    it("does not announce success when the post-repair write-back fails, and leaves a retryable save error", async () => {
      const successToast = vi.spyOn(toast, "success");
      const warningToast = vi.spyOn(toast, "warning");
      const track = vi.spyOn(telemetry, "track");
      const document = sharedWallDocument("package-repair-fail-000001", unlinkedPair);
      const originalSave = repository.save.bind(repository);
      let calls = 0;
      // The first save is the pre-repair write commitPackageImport always
      // makes before opening; only the SECOND — the repaired document's
      // write-back — is the one this finding is about, so only it fails.
      vi.spyOn(repository, "save").mockImplementation(async (project) => {
        calls += 1;
        if (calls === 2) throw new Error("disk full");
        return originalSave(project);
      });

      await store.getState().importSightlinesPackage(await packageBytes(document));

      const state = store.getState();
      // The import genuinely happened: the repair is live on the open
      // document even though the write-back of it failed.
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      expect(state.saveState).toBe("error");
      expect(state.saveError?.message).toMatch(/disk full/);
      // No plain "Imported" success toast next to the red save badge — the
      // only warning toast fired is setDocument's own "linked" notice, which
      // is unrelated to (and fires before) the write-back attempt.
      expect(successToast).not.toHaveBeenCalled();
      expect(warningToast).toHaveBeenCalledTimes(1);
      expect(warningToast).toHaveBeenCalledWith(
        "One shared opening was linked while opening this project."
      );
      // The import pipeline itself still completed — assets/artworks are
      // written and the document is open — so completion telemetry still
      // fires; only the trailing save is what's broken.
      expect(track).toHaveBeenCalledWith("package_import_completed", {});

      // The saveError's retry closure must be the user's real way out.
      await state.saveError!.retry();
      expect(store.getState().saveState).toBe("saved");
      expect(store.getState().saveError).toBeNull();
      expect(partnerOf(await repository.load(document.id), "door-a")).toBe("door-b");

      successToast.mockRestore();
      warningToast.mockRestore();
      track.mockRestore();
    });

    it("runs on a JSON import and persists what it opened", async () => {
      const document = sharedWallDocument("json-legacy-000001", unlinkedPair);

      await store.getState().importProjectJson(exportProjectJson(document));

      const state = store.getState();
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      // This path persists AFTER the swap, so it must write the repaired
      // document — otherwise it stores the old one and reports "Saved".
      expect(state.saveState).toBe("saved");
      expect(partnerOf(repository.projects.get(document.id)!, "door-a")).toBe("door-b");
    });

    it("runs on a snapshot restore and persists what it opened", async () => {
      const document = sharedWallDocument("snapshot-legacy-000001", unlinkedPair);
      await projectSnapshotRepository.add({
        projectId: document.id,
        createdAt: "2026-07-19T00:00:00.000Z",
        projectTitle: document.title,
        fingerprint: "fp",
        project: document
      });
      const [summary] = await projectSnapshotRepository.listByProject(document.id);

      await store.getState().restoreProjectSnapshot(summary.key);

      const state = store.getState();
      expect(partnerOf(state.project, "door-a")).toBe("door-b");
      expect(state.saveState).toBe("saved");
      expect(partnerOf(repository.projects.get(document.id)!, "door-a")).toBe("door-b");
    });
  });

  it("save validates before writing, so an invalid document cannot persist", async () => {
    const project = store.getState().project!;
    const invalid = { ...project, title: "" };

    await expect(repository.save(invalid)).rejects.toThrow();
  });

  it("createProject opens a new, blank, roomless project and lists it alongside the original", async () => {
    const track = vi.spyOn(telemetry, "track");
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
    expect(track).toHaveBeenCalledWith("project_created", {});
    track.mockRestore();
  });

  it("duplicateProject preserves the source and opens a freshly identified copy", async () => {
    const source = {
      ...store.getState().project!,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    };
    await repository.save(source);
    store.setState({ project: source });

    await store.getState().duplicateProject(source.id);

    const copy = store.getState().project!;
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe(`${source.title} (copy)`);
    expect(copy.createdAt).toBe(copy.updatedAt);
    expect(copy.createdAt).not.toBe(source.createdAt);
    expect(copy.floor).toEqual(source.floor);
    expect(copy.wallObjects).toEqual(source.wallObjects);
    expect(copy.checklistArtworkIds).toEqual(source.checklistArtworkIds);
    expect(repository.projects.get(source.id)).toBe(source);
    expect(repository.projects.get(copy.id)).toEqual(copy);
    expect(store.getState().wallContextId).toBe("wall-north");
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("lists saved project memberships for library artworks and opens a referenced project", async () => {
    await store
      .getState()
      .addArtworksFromFiles([makeImageFile("shared.jpg"), makeImageFile("unused.jpg")], {
        destination: "library"
      });
    const [sharedId, unusedId] = store
      .getState()
      .libraryArtworks.map((artwork) => artwork.id);
    const base = store.getState().project!;
    await repository.save({
      ...base,
      id: "project-with-shared-artwork",
      title: "Shared Artwork Show",
      updatedAt: "2026-07-11T12:00:00.000Z",
      checklistArtworkIds: [sharedId]
    });
    await repository.save({
      ...base,
      id: "project-without-shared-artwork",
      title: "Other Show",
      updatedAt: "2026-07-11T11:00:00.000Z",
      checklistArtworkIds: []
    });

    const memberships = await store
      .getState()
      .listArtworkProjectMemberships([sharedId, unusedId, sharedId]);

    expect(memberships).toEqual([
      {
        artworkId: sharedId,
        projects: [
          {
            id: "project-with-shared-artwork",
            title: "Shared Artwork Show",
            updatedAt: "2026-07-11T12:00:00.000Z",
            roomCount: 1,
            artworkCount: 1
          }
        ]
      },
      { artworkId: unusedId, projects: [] }
    ]);

    await store.getState().openProject(memberships[0].projects[0].id);
    expect(store.getState().project?.title).toBe("Shared Artwork Show");
    expect(store.getState().project?.checklistArtworkIds).toEqual([sharedId]);
  });

  describe("deleteLibraryArtworks", () => {
    it("cascades across projects, cleans the open one, and erases records + assets", async () => {
      await store.getState().addArtworksFromFiles(
        [makeImageFile("a.jpg"), makeImageFile("b.jpg"), makeImageFile("c.jpg")],
        { destination: "library" }
      );
      const [a, b, c] = store.getState().libraryArtworks.map((artwork) => artwork.id);

      await store.getState().addExistingArtworksToChecklist([a, b]);
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(a, wallId, 1_000, 1_450);
      expect(objectIdsOf(store.getState().selection)[0]).toBeTruthy();

      const base = store.getState().project!;
      await repository.save({
        ...base,
        id: "other-project",
        title: "Other Show",
        updatedAt: "2026-07-11T10:00:00.000Z",
        checklistArtworkIds: [b],
        wallObjects: [],
        floorObjects: []
      });

      const deleteArtwork = vi.spyOn(artworkLibraryRepository, "delete");
      const deleteAsset = vi.spyOn(assetRepository, "delete");

      await store.getState().deleteLibraryArtworks([a, b, "unknown-id"]);

      const state = store.getState();
      expect(state.project!.checklistArtworkIds).toEqual([]);
      expect(state.project!.wallObjects.some((object) => object.kind === "artwork")).toBe(false);
      expect(getSelectedArtworkId(state.project, state.selection)).toBeNull();
      expect(state.selection.kind).toBe("none");
      expect(repository.projects.get("other-project")!.checklistArtworkIds).toEqual([]);
      expect(deleteArtwork).toHaveBeenCalledWith(a);
      expect(deleteArtwork).toHaveBeenCalledWith(b);
      expect(deleteAsset).toHaveBeenCalledTimes(2);
      expect(artworkLibraryRepository.artworks.has(a)).toBe(false);
      expect(artworkLibraryRepository.artworks.has(b)).toBe(false);
      expect(assetRepository.assets.size).toBe(1);
      expect(state.libraryArtworks.map((artwork) => artwork.id)).toEqual([c]);
      expect(state.error).toBeNull();
    });

    it("no-ops when no id matches a library record", async () => {
      await store
        .getState()
        .addArtworksFromFiles([makeImageFile("only.jpg")], { destination: "library" });
      const before = store.getState().libraryArtworks;

      await store.getState().deleteLibraryArtworks(["nope"]);

      expect(store.getState().libraryArtworks).toBe(before);
      expect(store.getState().error).toBeNull();
    });

    it("keeps a shared asset while another library artwork still references it", async () => {
      await store.getState().addArtworksFromFiles(
        [makeImageFile("first.jpg"), makeImageFile("second.jpg")],
        { destination: "library" }
      );
      const [first, second] = store.getState().libraryArtworks;
      const sharedAssetId = first.assetId!;
      await artworkLibraryRepository.save({ ...second, assetId: sharedAssetId });
      store.setState({ libraryArtworks: await artworkLibraryRepository.list() });
      const deleteAsset = vi.spyOn(assetRepository, "delete");

      await store.getState().deleteLibraryArtworks([first.id]);

      expect(deleteAsset).not.toHaveBeenCalledWith(sharedAssetId);
      expect(assetRepository.assets.has(sharedAssetId)).toBe(true);
      expect(artworkLibraryRepository.artworks.get(second.id)?.assetId).toBe(sharedAssetId);
    });
  });

  describe("updateArtworksMatFrame", () => {
    async function seedLibrary() {
      await store.getState().addArtworksFromFiles(
        [makeImageFile("a.jpg"), makeImageFile("b.jpg"), makeImageFile("c.jpg")],
        { destination: "library" }
      );
      return store.getState().libraryArtworks.map((artwork) => artwork.id);
    }

    it("applies mat & frame to many works in one undo entry and reports skipped 0", async () => {
      const [a, b] = await seedLibrary();

      const result = await store
        .getState()
        .updateArtworksMatFrame([a, b], {
          matWidthMm: 50,
          frame: { widthMm: 25, finish: "gold" }
        });

      expect(result).toEqual({ updated: 2, skipped: 0 });
      const byId = new Map(store.getState().libraryArtworks.map((art) => [art.id, art]));
      expect(byId.get(a)?.matWidthMm).toBe(50);
      expect(byId.get(a)?.frame).toEqual({ widthMm: 25, finish: "gold" });
      expect(byId.get(b)?.frame).toEqual({ widthMm: 25, finish: "gold" });
      // One entry for the whole batch, and each record is persisted.
      expect(store.getState().undoStack).toHaveLength(1);
      expect(artworkLibraryRepository.artworks.get(a)?.matWidthMm).toBe(50);
      expect(artworkLibraryRepository.artworks.get(b)?.matWidthMm).toBe(50);
    });

    it("skips works whose size already includes the frame and counts them", async () => {
      const [a, b, c] = await seedLibrary();
      // Flag c as frame-inclusive directly in the repository.
      const cRecord = store.getState().libraryArtworks.find((art) => art.id === c)!;
      await artworkLibraryRepository.save({ ...cRecord, frameIncludedInImage: true });
      store.setState({ libraryArtworks: await artworkLibraryRepository.list() });

      const result = await store
        .getState()
        .updateArtworksMatFrame([a, b, c], { matWidthMm: 30 });

      expect(result).toEqual({ updated: 2, skipped: 1 });
      const byId = new Map(store.getState().libraryArtworks.map((art) => [art.id, art]));
      expect(byId.get(a)?.matWidthMm).toBe(30);
      expect(byId.get(b)?.matWidthMm).toBe(30);
      // The skipped work is untouched.
      expect(byId.get(c)?.matWidthMm).toBeUndefined();
    });

    it("clears mat and frame when passed undefined", async () => {
      const [a] = await seedLibrary();
      await store
        .getState()
        .updateArtworksMatFrame([a], { matWidthMm: 40, frame: { widthMm: 20, finish: "black" } });

      const result = await store
        .getState()
        .updateArtworksMatFrame([a], { matWidthMm: undefined, frame: undefined });

      expect(result).toEqual({ updated: 1, skipped: 0 });
      const record = store.getState().libraryArtworks.find((art) => art.id === a)!;
      expect(record.matWidthMm).toBeUndefined();
      expect(record.frame).toBeUndefined();
    });

    it("records no undo entry and shows no toast when nothing changes", async () => {
      const successToast = vi.spyOn(toast, "success");
      const [a] = await seedLibrary();

      const result = await store
        .getState()
        .updateArtworksMatFrame([a], { matWidthMm: undefined });

      expect(result).toEqual({ updated: 0, skipped: 0 });
      expect(store.getState().undoStack).toHaveLength(0);
      expect(successToast).not.toHaveBeenCalled();
    });

    it("does not toast after a successful bulk apply", async () => {
      const successToast = vi.spyOn(toast, "success");
      const [a, b] = await seedLibrary();
      successToast.mockClear();

      await store.getState().updateArtworksMatFrame([a, b], { matWidthMm: 45 });
      expect(successToast).not.toHaveBeenCalled();
    });

    it("undo and redo round-trip the whole batch", async () => {
      const [a, b] = await seedLibrary();
      await store
        .getState()
        .updateArtworksMatFrame([a, b], { matWidthMm: 60 });

      await store.getState().undo();
      let byId = new Map(store.getState().libraryArtworks.map((art) => [art.id, art]));
      expect(byId.get(a)?.matWidthMm).toBeUndefined();
      expect(byId.get(b)?.matWidthMm).toBeUndefined();
      expect(artworkLibraryRepository.artworks.get(a)?.matWidthMm).toBeUndefined();

      await store.getState().redo();
      byId = new Map(store.getState().libraryArtworks.map((art) => [art.id, art]));
      expect(byId.get(a)?.matWidthMm).toBe(60);
      expect(byId.get(b)?.matWidthMm).toBe(60);
      expect(artworkLibraryRepository.artworks.get(b)?.matWidthMm).toBe(60);
    });

    it("dedupes repeated ids so a work placed twice applies once", async () => {
      const [a] = await seedLibrary();

      const result = await store
        .getState()
        .updateArtworksMatFrame([a, a, a], { matWidthMm: 35 });

      expect(result).toEqual({ updated: 1, skipped: 0 });
    });
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

    // Reopening the active project must preserve edit history.
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

  it("deleteProject removes its workspace export preferences after repository deletion", async () => {
    const onProjectDeleted = vi.fn();
    store = createAppStore(makeDeps({ onProjectDeleted }));
    await store.getState().boot();
    const deletedId = store.getState().project!.id;

    await store.getState().deleteProject(deletedId);

    expect(onProjectDeleted).toHaveBeenCalledWith(deletedId);
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
    it("can import to the library without changing the checklist or undo history", async () => {
      await store
        .getState()
        .addArtworksFromFiles([makeImageFile("library-only.jpg")], { destination: "library" });

      const state = store.getState();
      expect(state.libraryArtworks.map((artwork) => artwork.title)).toEqual(["library-only"]);
      expect(state.project!.checklistArtworkIds).toEqual([]);
      expect(state.undoStack).toEqual([]);
      expect(assetRepository.assets.size).toBe(1);
    });

    it("uploads two files as two library records with three blobs each, in one undo entry", async () => {
      const track = vi.spyOn(telemetry, "track");
      const files = [makeImageFile("one.jpg"), makeImageFile("two.png", "image/png")];

      await store.getState().addArtworksFromFiles(files);
      expect(track).toHaveBeenCalledWith("artwork_import_completed", { source: "images" });
      track.mockRestore();

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

    it("does not attach a delayed image intake to a different open project", async () => {
      let release!: () => void;
      const delayedProcessor = new FakeImageProcessor();
      const originalProcess = delayedProcessor.process.bind(delayedProcessor);
      vi.spyOn(delayedProcessor, "process").mockImplementation(async (file) => {
        await new Promise<void>((resolve) => (release = resolve));
        return originalProcess(file);
      });
      store = createAppStore(makeDeps({ imageProcessor: delayedProcessor }));
      await store.getState().boot();
      const intake = store.getState().addArtworksFromFiles([makeImageFile("slow.jpg")]);
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      await store.getState().createProject("Other project");
      release();
      await intake;

      expect(store.getState().project?.title).toBe("Other project");
      expect(store.getState().project?.checklistArtworkIds).toEqual([]);
      expect(store.getState().libraryArtworks).toHaveLength(1);
      expect(store.getState().error).toMatch(/open project changed/);
    });
  });

  describe("importArtworkDrafts", () => {
    it("imports selected metadata drafts, processes matched images, and commits checklist membership once", async () => {
      const track = vi.spyOn(telemetry, "track");
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
      expect(track).toHaveBeenCalledWith("artwork_import_completed", { source: "combined" });
      track.mockRestore();

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
      const track = vi.spyOn(telemetry, "track");
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
      expect(track).toHaveBeenCalledWith("artwork_import_completed", { source: "spreadsheet" });
      track.mockRestore();

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.project!.checklistArtworkIds).toEqual(["metadata-only-artwork"]);
      expect(artworkLibraryRepository.artworks.get("metadata-only-artwork")?.assetId).toBeUndefined();
      expect(assetRepository.assets.size).toBe(0);
    });

    it("can import drafts to the library without changing the checklist or undo history", async () => {
      const draft: ArtworkImportDraft = {
        id: "library-draft",
        row: { sourceRowIndex: 2, values: ["Library Work"] },
        artwork: {
          id: "library-artwork",
          schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
          title: "Library Work",
          dimensions: { status: "unknown" },
          metadata: {}
        },
        imageMatch: { status: "none", candidates: [] },
        warnings: [],
        raw: { title: "Library Work" },
        selected: true
      };

      await store.getState().importArtworkDrafts([draft], { destination: "library" });

      const state = store.getState();
      expect(state.libraryArtworks.map((artwork) => artwork.id)).toEqual(["library-artwork"]);
      expect(state.project!.checklistArtworkIds).toEqual([]);
      expect(state.undoStack).toEqual([]);
    });

    it("does not attach a delayed spreadsheet import to a different open project", async () => {
      const draft: ArtworkImportDraft = {
        id: "slow-draft",
        row: { sourceRowIndex: 2, values: ["Slow"] },
        artwork: {
          id: "slow-artwork",
          schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
          title: "Slow",
          dimensions: { status: "unknown" },
          metadata: {}
        },
        imageMatch: { status: "none", candidates: [] },
        warnings: [],
        raw: { title: "Slow" },
        selected: true
      };
      let release!: () => void;
      const originalSave = artworkLibraryRepository.save.bind(artworkLibraryRepository);
      vi.spyOn(artworkLibraryRepository, "save").mockImplementationOnce(async (artwork) => {
        await new Promise<void>((resolve) => (release = resolve));
        await originalSave(artwork);
      });

      const intake = store.getState().importArtworkDrafts([draft]);
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      await store.getState().createProject("Other project");
      release();
      await intake;

      expect(store.getState().project?.title).toBe("Other project");
      expect(store.getState().project?.checklistArtworkIds).toEqual([]);
      expect(store.getState().libraryArtworks.map((artwork) => artwork.id)).toContain(
        "slow-artwork"
      );
      expect(store.getState().error).toMatch(/open project changed/);
    });

    // A framed-role import stores the outer size and flags it frame-inclusive;
    // both the flag and the dimensionRole provenance must ride the draft through
    // importArtworkDrafts and parseArtwork into the saved record, not just the
    // in-memory state — provenance is the fallback that outlives the wizard's
    // transient note (docs/framing-dimension-contract.md §3).
    it("persists framed-size provenance on the committed artwork record", async () => {
      const plan = createArtworkImportPlan({
        table: {
          sourceFilename: "checklist.csv",
          sheetName: "Sheet1",
          headerRowIndex: 0,
          columns: [
            { index: 0, label: "title" },
            { index: 1, label: "dimensions" }
          ],
          rows: [{ sourceRowIndex: 2, values: ["Framed Study", "Framed: 24 x 36 in"] }]
        },
        imageFiles: [],
        projectUnit: "in"
      });

      await store.getState().importArtworkDrafts(plan.drafts);

      const saved = store.getState().libraryArtworks[0];
      expect(saved.dimensions.heightMm).toBeCloseTo(inchesToMm(24));
      expect(saved.dimensions.widthMm).toBeCloseTo(inchesToMm(36));
      expect(saved.frameIncludedInImage).toBe(true);
      expect(saved.metadata.dimensionRole).toBe("framed");

      const persisted = artworkLibraryRepository.artworks.get(saved.id);
      expect(persisted?.frameIncludedInImage).toBe(true);
      expect(persisted?.metadata.dimensionRole).toBe("framed");
    });
  });

  describe("package persistence boundaries", () => {
    it("aborts before writes when an existing asset cannot be read for collision detection", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("existing.jpg")]);
      const bytes = await packageBytes({
        ...store.getState().project!,
        id: "incoming-project",
        title: "Incoming"
      });
      vi.spyOn(assetRepository, "getAsset").mockRejectedValue(new Error("asset read failed"));
      const saveAsset = vi.spyOn(assetRepository, "saveAsset");
      const saveArtwork = vi.spyOn(artworkLibraryRepository, "save");

      await store.getState().importSightlinesPackage(bytes);

      expect(saveAsset).not.toHaveBeenCalled();
      expect(saveArtwork).not.toHaveBeenCalled();
      expect(repository.projects.has("incoming-project")).toBe(false);
      expect(store.getState().error).toMatch(/asset read failed/);
    });

    it("tolerates a dangling library assetId during collision detection", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("existing.jpg")]);
      const bytes = await packageBytes({
        ...store.getState().project!,
        id: "incoming-project",
        title: "Incoming"
      });
      // A legacy artwork may outlive its deleted asset; import must surface a
      // conflict rather than block forever.
      assetRepository.assets.clear();

      await store.getState().importSightlinesPackage(bytes);

      expect(store.getState().error).toBeNull();
      const plan = store.getState().pendingPackageImport?.plan;
      expect(plan?.conflicts.map((conflict) => conflict.incoming.id)).toEqual([
        store.getState().libraryArtworks[0]!.id
      ]);

      await store
        .getState()
        .resolvePackageImportConflicts({ [plan!.conflicts[0]!.incoming.id]: "theirs" });

      expect(store.getState().error).toBeNull();
      expect(store.getState().project?.id).toBe("incoming-project");
      expect(repository.projects.has("incoming-project")).toBe(true);
    });

    // The three resolutions must reach the artwork LIBRARY, not just the plan:
    // the domain tests cover finalizePackageImport's output, but only a
    // repository assertion proves the chosen record is what actually got
    // written (the reported "the choices do nothing" symptom).
    it("applies mine / theirs / both per row down to the saved library records", async () => {
      await store
        .getState()
        .addArtworksFromFiles([
          makeImageFile("keep-mine.jpg"),
          makeImageFile("take-theirs.jpg"),
          makeImageFile("keep-both.jpg")
        ]);

      const [mineId, theirsId, bothId] = store.getState().project!.checklistArtworkIds;
      // Snapshot the sender's side BEFORE the local edits below, so the
      // package carries the original titles as "theirs".
      const bytes = await packageBytes({
        ...store.getState().project!,
        id: "incoming-project",
        title: "Incoming"
      });

      // Diverge every local record; same ids + different content = §6 conflicts.
      for (const id of [mineId, theirsId, bothId]) {
        const local = artworkLibraryRepository.artworks.get(id)!;
        await artworkLibraryRepository.save({ ...local, title: `Local ${local.title}` });
      }
      store.setState({ libraryArtworks: await artworkLibraryRepository.list() });

      await store.getState().importSightlinesPackage(bytes);

      const plan = store.getState().pendingPackageImport?.plan;
      expect(plan?.conflicts.map((conflict) => conflict.incoming.id).sort()).toEqual(
        [mineId, theirsId, bothId].sort()
      );

      await store.getState().resolvePackageImportConflicts({
        [mineId]: "mine",
        [theirsId]: "theirs",
        [bothId]: "both"
      });

      expect(store.getState().error).toBeNull();

      // mine: the local record is untouched under its own id.
      expect(artworkLibraryRepository.artworks.get(mineId)?.title).toBe("Local keep-mine");
      // theirs: the incoming content overwrites, under the SAME id.
      expect(artworkLibraryRepository.artworks.get(theirsId)?.title).toBe("take-theirs");
      // both: the local record survives AND a fresh id carries the incoming one.
      expect(artworkLibraryRepository.artworks.get(bothId)?.title).toBe("Local keep-both");
      const duplicates = [...artworkLibraryRepository.artworks.values()].filter(
        (artwork) => artwork.title === "keep-both"
      );
      expect(duplicates).toHaveLength(1);
      const duplicate = duplicates[0]!;
      expect(duplicate.id).not.toBe(bothId);

      // The imported project's placements follow the duplicate, not the original.
      const checklist = store.getState().project!.checklistArtworkIds;
      expect(checklist).toContain(duplicate.id);
      expect(checklist).not.toContain(bothId);
      expect(checklist).toContain(mineId);
      expect(checklist).toContain(theirsId);

      // And the in-memory library the UI reads matches what was written.
      const libraryById = new Map(
        store.getState().libraryArtworks.map((artwork) => [artwork.id, artwork])
      );
      expect(libraryById.get(mineId)?.title).toBe("Local keep-mine");
      expect(libraryById.get(theirsId)?.title).toBe("take-theirs");
      expect(libraryById.get(duplicate.id)?.title).toBe("keep-both");
    });

    it("aborts before writes when project collision detection cannot list projects", async () => {
      const bytes = await packageBytes({
        ...store.getState().project!,
        id: "incoming-project",
        title: "Incoming"
      });
      vi.spyOn(repository, "list").mockRejectedValueOnce(new Error("project list failed"));
      const saveAsset = vi.spyOn(assetRepository, "saveAsset");
      const saveArtwork = vi.spyOn(artworkLibraryRepository, "save");

      await store.getState().importSightlinesPackage(bytes);

      expect(saveAsset).not.toHaveBeenCalled();
      expect(saveArtwork).not.toHaveBeenCalled();
      expect(repository.projects.has("incoming-project")).toBe(false);
      expect(store.getState().error).toMatch(/project list failed/);
    });

    it("does not switch documents when the imported project cannot be saved", async () => {
      const original = store.getState().project!;
      const incoming = { ...original, id: "incoming-project", title: "Incoming" };
      const bytes = await packageBytes(incoming);
      const originalSave = repository.save.bind(repository);
      vi.spyOn(repository, "save").mockImplementation(async (project) => {
        if (project.id === incoming.id) throw new Error("quota exceeded");
        await originalSave(project);
      });

      await store.getState().importSightlinesPackage(bytes);

      expect(store.getState().project?.id).toBe(original.id);
      expect(store.getState().project?.title).toBe(original.title);
      expect(repository.projects.has(incoming.id)).toBe(false);
      expect(store.getState().saveState).toBe("error");
      expect(store.getState().error).toMatch(/quota exceeded/);
    });

    it("exports the live current project without reloading a stale saved copy", async () => {
      const current = store.getState().project!;
      store.setState({ project: { ...current, title: "Live unsaved title" } });
      const load = vi.spyOn(repository, "load");

      const result = await store.getState().exportProjectPackageById(current.id, "originals");

      expect(load).not.toHaveBeenCalled();
      expect(result?.filename).toContain("live-unsaved-title");
    });

    it("builds the checklist spreadsheet from the live document", async () => {
      const current = store.getState().project!;
      store.setState({ project: { ...current, title: "Checklist Show" } });

      const result = await store.getState().exportChecklistSpreadsheet({
        format: "xlsx",
        images: "none",
        sort: "project",
        placedOnly: false
      });

      expect(result?.filename).toBe("checklist-show-checklist.xlsx");
      expect(result?.mimeType).toMatch(/spreadsheetml/);
      // A real xlsx is a zip; anything else means the writer silently no-oped.
      expect([result!.bytes[0], result!.bytes[1]]).toEqual([0x50, 0x4b]);
      expect(store.getState().error).toBeNull();
    });

    it("builds the checklist PDF through the lazily loaded writer", async () => {
      const current = store.getState().project!;
      store.setState({ project: { ...current, title: "Checklist Show" } });

      const result = await store.getState().exportChecklistPdf({
        format: "pdf",
        sort: "project",
        placedOnly: false,
        numbering: false,
        accession: false,
        locationOrLender: false,
        placement: true
      });

      expect(result?.filename).toBe("checklist-show-checklist.pdf");
      expect(result?.mimeType).toBe("application/pdf");
      // %PDF- magic; anything else means the writer silently no-oped.
      expect([...result!.bytes.slice(0, 5)]).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
      expect(store.getState().error).toBeNull();
    });

    it("returns null for the checklist PDF when no document is open", async () => {
      store.setState({ project: null });

      const result = await store.getState().exportChecklistPdf({
        format: "pdf",
        sort: "project",
        placedOnly: false,
        numbering: false,
        accession: false,
        locationOrLender: false,
        placement: true
      });

      expect(result).toBeNull();
    });

    it("returns null for the checklist export when no document is open", async () => {
      store.setState({ project: null });

      const result = await store.getState().exportChecklistSpreadsheet({
        format: "csv",
        images: "none",
        sort: "project",
        placedOnly: false
      });

      expect(result).toBeNull();
    });
  });

  describe("upload duplicate detection", () => {
    // Force named files to share content identity.
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

    it("confirmDuplicateUploads preserves a library-only destination", async () => {
      await useSharedHash(["twin-a.jpg", "twin-b.jpg"], "shared-sha");

      await store
        .getState()
        .addArtworksFromFiles([makeImageFile("twin-a.jpg")], { destination: "library" });
      await store
        .getState()
        .addArtworksFromFiles([makeImageFile("twin-b.jpg")], { destination: "library" });

      expect(store.getState().pendingDuplicateUploads[0].destination).toBe("library");
      await store.getState().confirmDuplicateUploads();

      const state = store.getState();
      expect(state.libraryArtworks).toHaveLength(2);
      expect(state.project!.checklistArtworkIds).toEqual([]);
      expect(state.undoStack).toEqual([]);
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
      // Legacy assets without hashes cannot participate in duplicate detection.
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

  describe("addExistingArtworksToChecklist", () => {
    it("adds valid library works once in one undoable edit", async () => {
      await store.getState().addArtworksFromFiles(
        [makeImageFile("one.jpg"), makeImageFile("two.jpg")],
        { destination: "library" }
      );
      const [oneId, twoId] = store.getState().libraryArtworks.map((artwork) => artwork.id);

      await store
        .getState()
        .addExistingArtworksToChecklist([oneId, oneId, "missing-artwork", twoId]);

      const state = store.getState();
      expect(state.project!.checklistArtworkIds).toEqual([oneId, twoId]);
      expect(state.undoStack).toHaveLength(1);
      expect(state.undoStack[0].label).toBe("Add 2 artworks to checklist");

      await state.undo();
      expect(store.getState().project!.checklistArtworkIds).toEqual([]);
      expect(store.getState().libraryArtworks).toHaveLength(2);
    });

    it("does nothing when every requested work is already checklisted", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("one.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const undoBefore = store.getState().undoStack.length;

      await store.getState().addExistingArtworksToChecklist([artworkId, artworkId]);

      expect(store.getState().project!.checklistArtworkIds).toEqual([artworkId]);
      expect(store.getState().undoStack).toHaveLength(undoBefore);
    });
  });

  describe("removeArtworkFromChecklist", () => {
    it("removes checklist membership and any artwork wallObjects, but leaves the library record intact", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];

      // Defensive coverage for a dangling placement.
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

    it("writes an explicit placementForm override in one undoable commit", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      expect(
        store.getState().libraryArtworks.find((a) => a.id === artworkId)?.placementForm
      ).toBeUndefined();
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().updateArtwork(artworkId, { placementForm: "floor" });

      let state = store.getState();
      expect(state.error).toBeNull();
      expect(state.libraryArtworks.find((a) => a.id === artworkId)?.placementForm).toBe("floor");
      expect(artworkLibraryRepository.artworks.get(artworkId)?.placementForm).toBe("floor");
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);

      await store.getState().undo();
      state = store.getState();
      expect(
        state.libraryArtworks.find((a) => a.id === artworkId)?.placementForm
      ).toBeUndefined();
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
      // Artwork edit and placement resize are one undoable step.
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
      expect(placement.heightMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
      expect(
        state.libraryArtworks.find((a) => a.id === artworkId)?.dimensions.widthMm
      ).toBeUndefined();
    });

    it("keeps an override and its stored behavioral footprint on dimension edits", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(artworkId, wallId, 1000, 1450);
      const placementId = store.getState().project!.wallObjects[0].id;

      // Inject an override to verify updateArtwork preserves it.
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
      // An explicit override opts the placement out of dimension rebaking.
      expect(placement.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
      expect(placement.heightMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
      expect(placement.kind).toBe("artwork");
      if (placement.kind === "artwork") {
        expect(placement.displayDimensionsOverride).toEqual({
          widthMm: 300,
          heightMm: 300,
          status: "known"
        });
      }
    });

    it("does not mutate placement geometry for mat- or frame-only edits", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, status: "known" }
      });
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(artworkId, wallId, 1000, 1450);
      const projectWithPersistedSize: Project = {
        ...store.getState().project!,
        wallObjects: store.getState().project!.wallObjects.map((wallObject) => ({
          ...wallObject,
          widthMm: 460,
          heightMm: 360
        }))
      };
      await repository.save(projectWithPersistedSize);
      store.setState({ project: projectWithPersistedSize });
      const before = store.getState().project!.wallObjects[0];

      await store.getState().updateArtwork(artworkId, {
        matWidthMm: 75,
        frame: { widthMm: 25, finish: "black" }
      });

      expect(store.getState().project!.wallObjects[0]).toEqual(before);
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

    it("writes the virtual medium field into metadata, and deletes the key when cleared", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      const read = () => store.getState().libraryArtworks.find((a) => a.id === artworkId)!;

      await store.getState().updateArtwork(artworkId, { medium: "Oil on canvas" });

      // Medium is not a column on Artwork: it lands at metadata.medium, the
      // slot the import wizard writes and every export reads.
      expect(store.getState().error).toBeNull();
      expect(read().metadata.medium).toBe("Oil on canvas");
      expect(artworkLibraryRepository.artworks.get(artworkId)?.metadata.medium).toBe(
        "Oil on canvas"
      );
      expect("medium" in read()).toBe(false);

      const undoStackBefore = store.getState().undoStack.length;
      // Blank clears rather than storing "": an empty key would export as an
      // empty Medium column and re-import as a real (blank) value.
      await store.getState().updateArtwork(artworkId, { medium: "  " });

      expect("medium" in read().metadata).toBe(false);
      expect(store.getState().undoStack).toHaveLength(undoStackBefore + 1);

      await store.getState().undo();
      expect(read().metadata.medium).toBe("Oil on canvas");
    });

    it("makes a metadata-only re-commit of the same medium a no-op", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      await store.getState().updateArtwork(artworkId, { medium: "Oil on canvas" });
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().updateArtwork(artworkId, { medium: "Oil on canvas" });

      expect(store.getState().undoStack).toHaveLength(undoStackBefore);
    });

    it("round-trips a credit line through the library record", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];

      await store.getState().updateArtwork(artworkId, {
        creditLine: "Courtesy of the artist and Gallery X"
      });

      expect(store.getState().error).toBeNull();
      expect(
        artworkLibraryRepository.artworks.get(artworkId)?.creditLine
      ).toBe("Courtesy of the artist and Gallery X");
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

    it("re-runs placement validation when frameIncludedInImage toggles the footprint", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("framed.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];
      // Image 400×300 fits near the wall's left edge; the mat+frame footprint
      // (600×500) crosses x=0, so the framed placement is out of bounds.
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 400, heightMm: 300, status: "known" },
        matWidthMm: 75,
        frame: { widthMm: 25, finish: "black" }
      });
      const wallId = getSelectedWall(
        store.getState().project!,
        store.getState().wallContextId
      )!.id;
      await store.getState().placeArtwork(artworkId, wallId, 250, 1450);

      const placementId = store.getState().project!.wallObjects[0].id;
      expect(
        store.getState().placementWarnings.some((w) => w.wallObjectId === placementId)
      ).toBe(true);

      // Declaring the size frame-inclusive drops the band: footprint == image,
      // which now fits, so the warning must clear (guard includes the flag).
      await store.getState().updateArtwork(artworkId, { frameIncludedInImage: true });

      expect(
        store.getState().placementWarnings.some((w) => w.wallObjectId === placementId)
      ).toBe(false);
    });

    // ─── Floor rebake on a dimension edit ──────────────────────────────────
    // A floor placement's box is a SEPARATE measurement from the work (a board,
    // a plinth, a cabinet), so it follows a dimension edit only while it still
    // equals what placement seeded it with. Once a curator has resized it, the
    // work's numbers must not silently drag it back.
    describe("floor placements follow dimension edits only while undiverged", () => {
      async function placeFloorWork(
        dimensions: { widthMm: number; heightMm: number; depthMm?: number },
        displayAs?: "monitor"
      ) {
        await store.getState().addArtworksFromFiles([makeImageFile("board.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          dimensions: { ...dimensions, status: "known" },
          ...(displayAs ? { displayAs } : {})
        });
        await store.getState().placeArtworkOnFloor(artworkId, 4000, 4000);
        return { artworkId, objectId: store.getState().project!.floorObjects[0]!.id };
      }

      const floorObject = (objectId: string) =>
        store.getState().project!.floorObjects.find((o) => o.id === objectId)!;

      it("resizes an untouched box, in the same undo step as the artwork edit", async () => {
        const { artworkId, objectId } = await placeFloorWork({
          widthMm: 500,
          heightMm: 400,
          depthMm: 300
        });
        expect(floorObject(objectId)).toMatchObject({
          widthMm: 500,
          heightMm: 400,
          depthMm: 300
        });
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 800, heightMm: 600, depthMm: 200, status: "known" }
        });

        expect(floorObject(objectId)).toMatchObject({
          widthMm: 800,
          heightMm: 600,
          depthMm: 200
        });
        // One entry, not two: the artwork edit and the placement rebake are a
        // single undoable step.
        expect(store.getState().undoStack).toHaveLength(undoStackBefore + 1);

        await store.getState().undo();
        expect(floorObject(objectId)).toMatchObject({
          widthMm: 500,
          heightMm: 400,
          depthMm: 300
        });
      });

      it("leaves a widened board alone", async () => {
        const { artworkId, objectId } = await placeFloorWork({
          widthMm: 500,
          heightMm: 400,
          depthMm: 300
        });
        // The curator made the board wider than the work — the exact state the
        // "Match size to work" hint exists to explain.
        await store.getState().updateFloorObject(objectId, { widthMm: 2000 });

        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 800, heightMm: 600, depthMm: 300, status: "known" }
        });

        const after = floorObject(objectId);
        expect(after.widthMm).toBe(2000);
        // The face travels as a pair, so the height stays put with it.
        expect(after.heightMm).toBe(400);
        // Depth is its own concern (how thick the board is) and was untouched,
        // so it still follows — here to the same 300.
        expect(after.depthMm).toBe(300);
      });

      it("leaves a re-thicknessed board's depth alone while the face still follows", async () => {
        const { artworkId, objectId } = await placeFloorWork({
          widthMm: 500,
          heightMm: 400,
          depthMm: 300
        });
        await store.getState().updateFloorObject(objectId, { depthMm: 40 });

        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 800, heightMm: 600, depthMm: 250, status: "known" }
        });

        expect(floorObject(objectId)).toMatchObject({
          widthMm: 800,
          heightMm: 600,
          depthMm: 40
        });
      });

      it("follows a monitor's cabinet through monitorBoxSizeMm", async () => {
        const { artworkId, objectId } = await placeFloorWork(
          { widthMm: 500, heightMm: 400 },
          "monitor"
        );
        const seeded = floorObject(objectId);
        expect(seeded.widthMm).toBe(500);
        expect(seeded.depthMm).toBe(MONITOR_DEPTH_MM);

        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 900, heightMm: 700, status: "known" }
        });

        const after = floorObject(objectId);
        // The cabinet is always 4:3 off the WIDTH — the work's own 900×700 is
        // the picture, not the box.
        expect(after.widthMm).toBe(900);
        expect(after.heightMm).toBeCloseTo(900 / MONITOR_ASPECT_RATIO, 6);
        expect(after.depthMm).toBe(MONITOR_DEPTH_MM);
      });

      it("leaves a resized cabinet alone, all three axes together", async () => {
        const { artworkId, objectId } = await placeFloorWork(
          { widthMm: 500, heightMm: 400 },
          "monitor"
        );
        await store.getState().updateFloorObject(objectId, { widthMm: 1200 });

        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 900, heightMm: 700, status: "known" }
        });

        const after = floorObject(objectId);
        // A cabinet is one indivisible piece of equipment: a diverged width
        // freezes its height and depth too, or the box would stop being 4:3.
        expect(after.widthMm).toBe(1200);
        expect(after.heightMm).toBe(500 / MONITOR_ASPECT_RATIO);
        expect(after.depthMm).toBe(MONITOR_DEPTH_MM);
      });
    });
  });

  describe("opening connections", () => {
    it("a legacy pair can be split, and undo restores it", async () => {
      // wall-north and wall-south belong to ONE room, so this pair is not two
      // faces of a shared boundary and never was. Split is the whole resolution
      // for it — and the only one, since the resolver refuses to rebuild it.
      await store.getState().addOpening("wall-north", "door");
      const doorA = store.getState().project!.wallObjects[0];
      await store.getState().addOpening("wall-south", "door");
      const doorB = store
        .getState()
        .project!.wallObjects.find((object) => object.id !== doorA.id)!;
      linkLegacyPair(store, doorA.id, doorB.id);
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().splitSharedOpening(doorA.id);

      let project = store.getState().project!;
      expect(store.getState().undoStack).toHaveLength(undoStackBefore + 1);
      expect(store.getState().undoStack.at(-1)?.label).toBe("Separate doors");
      expect(
        project.wallObjects.some(
          (object) =>
            (object.kind === "door" || object.kind === "window") &&
            object.connectsToObjectId !== undefined
        )
      ).toBe(false);
      expect(store.getState().error).toBeNull();

      await store.getState().undo();
      project = store.getState().project!;
      const restoredA = project.wallObjects.find((object) => object.id === doorA.id)!;
      const restoredB = project.wallObjects.find((object) => object.id === doorB.id)!;
      expect(restoredA.kind === "door" ? restoredA.connectsToObjectId : undefined).toBe(doorB.id);
      expect(restoredB.kind === "door" ? restoredB.connectsToObjectId : undefined).toBe(doorA.id);
    });

    // Regression: a paired door re-anchored onto its partner's wall left both
    // halves on one wall, which the schema rejects — but only at SAVE time, so
    // the edit landed in the store, the app looked fine, and every subsequent
    // save failed with a raw ZodError JSON banner that never cleared.
    it("disconnects a pair when one half is moved onto its partner's wall, and stays saveable", async () => {
      await store.getState().addOpening("wall-north", "door");
      const doorA = store.getState().project!.wallObjects[0];
      await store.getState().addOpening("wall-south", "door");
      const doorB = store
        .getState()
        .project!.wallObjects.find((object) => object.id !== doorA.id)!;
      linkLegacyPair(store, doorA.id, doorB.id);

      await store.getState().commitPlanMove(doorA.id, {
        anchor: "wall",
        wallId: doorB.wallId,
        xMm: 1500
      });

      const state = store.getState();
      const movedA = state.project!.wallObjects.find((object) => object.id === doorA.id)!;
      const keptB = state.project!.wallObjects.find((object) => object.id === doorB.id)!;

      // The move itself still happens; only the now-impossible pairing is dropped.
      expect(movedA.wallId).toBe(doorB.wallId);
      expect(movedA.kind === "door" ? movedA.connectsToObjectId : undefined).toBeUndefined();
      expect(keptB.kind === "door" ? keptB.connectsToObjectId : undefined).toBeUndefined();

      // The whole point: the document is still persistable.
      expect(state.saveState).toBe("saved");
      expect(state.error).toBeNull();
      // And the repair rides the move's own undo entry.
      await store.getState().undo();
      const restoredA = store
        .getState()
        .project!.wallObjects.find((object) => object.id === doorA.id)!;
      expect(restoredA.wallId).toBe("wall-north");
      expect(restoredA.kind === "door" ? restoredA.connectsToObjectId : undefined).toBe(doorB.id);
    });

    it("keeps a pair whose walls are not facing twins when only sliding along one wall", async () => {
      // A legacy document may hold a pair on non-facing walls. Sliding must
      // never trigger the repair.
      await store.getState().addOpening("wall-north", "door");
      const doorA = store.getState().project!.wallObjects[0];
      await store.getState().addOpening("wall-south", "door");
      const doorB = store
        .getState()
        .project!.wallObjects.find((object) => object.id !== doorA.id)!;
      linkLegacyPair(store, doorA.id, doorB.id);

      await store.getState().commitPlanMove(doorA.id, {
        anchor: "wall",
        wallId: "wall-north",
        xMm: 2500
      });

      const movedA = store
        .getState()
        .project!.wallObjects.find((object) => object.id === doorA.id)!;
      expect(movedA.kind === "door" ? movedA.connectsToObjectId : undefined).toBe(doorB.id);
      expect(store.getState().saveState).toBe("saved");
    });

    it("keeps mirroring a legacy pair on a same-wall nudge, and never refuses it", async () => {
      // wall-north and wall-south of ONE room are not two faces of a shared
      // boundary, so this pair is not one physical opening and never was. It is
      // exactly the data the "existing pairs survive" decision protects, which
      // includes how it MOVES: the partner has always followed a same-wall
      // nudge when its slot was free, and silently dropping that would be
      // changing legacy documents under the user. What it never does is refuse —
      // refusal is reserved for pairs that really are one physical opening.
      await store.getState().addOpening("wall-north", "door");
      const doorA = store.getState().project!.wallObjects[0];
      await store.getState().addOpening("wall-south", "door");
      const doorB = store
        .getState()
        .project!.wallObjects.find((object) => object.id !== doorA.id)!;
      linkLegacyPair(store, doorA.id, doorB.id);
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().moveOpening(doorA.id, 2500, doorA.yMm);

      const state = store.getState();
      const movedA = state.project!.wallObjects.find((object) => object.id === doorA.id)!;
      const movedB = state.project!.wallObjects.find((object) => object.id === doorB.id)!;
      expect(movedA.xMm).toBe(2500);
      // The partner followed, mirrored across the two anti-parallel walls.
      expect(movedB.xMm).not.toBe(doorB.xMm);
      // Committed as one edit, still a pair, no refusal.
      expect(movedA.kind === "door" ? movedA.connectsToObjectId : undefined).toBe(doorB.id);
      expect(state.undoStack).toHaveLength(undoStackBefore + 1);
      expect(state.error).toBeNull();
    });

    it("does not mirror a legacy pair on a plan drag, which never mirrored", async () => {
      // Direct edits (moveOpening/resizeOpening) have always dragged a legacy
      // partner along when its slot was free, and that is preserved. Plan
      // dragging never did — so honouring a legacy best-effort draft here would
      // be a NEW behaviour, not a preserved one.
      await store.getState().addOpening("wall-north", "door");
      const doorA = store.getState().project!.wallObjects[0];
      await store.getState().addOpening("wall-south", "door");
      const doorB = store
        .getState()
        .project!.wallObjects.find((object) => object.id !== doorA.id)!;
      linkLegacyPair(store, doorA.id, doorB.id);

      await store.getState().commitPlanMove(doorA.id, {
        anchor: "wall",
        wallId: "wall-north",
        xMm: 2500
      });

      const objects = store.getState().project!.wallObjects;
      const movedA = objects.find((object) => object.id === doorA.id)!;
      const keptB = objects.find((object) => object.id === doorB.id)!;
      expect(movedA.xMm).toBe(2500);
      expect(keptB.xMm).toBe(doorB.xMm);
      expect(store.getState().error).toBeNull();
    });

    it("resizes a legacy pair on perpendicular walls instead of refusing it", async () => {
      // wall-north and wall-east are perpendicular, so they project to a
      // zero-length mutual run. Solving a legacy pair as one physical hole would
      // report noMutualSpan and refuse — before the non-refusing legacy branch
      // was ever reached. Only a real shared boundary gets the paired span.
      await store.getState().addOpening("wall-north", "door");
      const doorA = store.getState().project!.wallObjects[0];
      await store.getState().addOpening("wall-east", "door");
      const doorB = store
        .getState()
        .project!.wallObjects.find((object) => object.id !== doorA.id)!;
      linkLegacyPair(store, doorA.id, doorB.id);

      const fit = await store.getState().resizeOpening(doorA.id, 1200, doorA.heightMm);

      expect(fit?.noMutualSpan).toBeFalsy();
      expect(fit?.partnerBlocked).toBeFalsy();
      const movedA = store
        .getState()
        .project!.wallObjects.find((object) => object.id === doorA.id)!;
      expect(movedA.widthMm).toBe(1200);
      expect(store.getState().error).toBeNull();
    });

    it("ignores a one-way pointer at a different kind rather than moving it", async () => {
      // resolveLivePartner promises a structurally sound pair, and `no-partner`
      // is documented as covering kind mismatches. Trusting the raw pointer let
      // a broken door -> window reference drag an unrelated object.
      await store.getState().addOpening("wall-north", "door");
      const door = store.getState().project!.wallObjects[0];
      await store.getState().addOpening("wall-south", "window");
      const window = store
        .getState()
        .project!.wallObjects.find((object) => object.id !== door.id)!;

      // A document the schema would reject, written straight into state.
      const base = store.getState().project!;
      store.setState({
        project: {
          ...base,
          wallObjects: base.wallObjects.map((object) =>
            object.id === door.id ? { ...object, connectsToObjectId: window.id } : object
          )
        }
      });

      await store.getState().moveOpening(door.id, 2500, door.yMm);

      const objects = store.getState().project!.wallObjects;
      expect(objects.find((object) => object.id === door.id)!.xMm).toBe(2500);
      // The window is untouched: it was never this door's other face.
      expect(objects.find((object) => object.id === window.id)!.xMm).toBe(window.xMm);
    });

    it("keeps a pair when a group move relocates both halves in one batch", async () => {
      // The order-dependence guard: normalization runs once over the finished
      // draft, so the first half's new wall is never judged against the second
      // half's not-yet-applied wall.
      await store.getState().addOpening("wall-north", "door");
      const doorA = store.getState().project!.wallObjects[0];
      await store.getState().addOpening("wall-south", "door");
      const doorB = store
        .getState()
        .project!.wallObjects.find((object) => object.id !== doorA.id)!;
      linkLegacyPair(store, doorA.id, doorB.id);

      // Swap the two halves' walls in a single batch — every intermediate
      // per-object view of this move looks same-wall, the finished one does not.
      await store.getState().movePlanObjectsGroup([
        { id: doorA.id, xMm: 1200, wallId: "wall-south" },
        { id: doorB.id, xMm: 1200, wallId: "wall-north" }
      ]);

      const objects = store.getState().project!.wallObjects;
      const movedA = objects.find((object) => object.id === doorA.id)!;
      const movedB = objects.find((object) => object.id === doorB.id)!;
      expect(movedA.wallId).toBe("wall-south");
      expect(movedB.wallId).toBe("wall-north");
      expect(movedA.kind === "door" ? movedA.connectsToObjectId : undefined).toBe(doorB.id);
      expect(movedB.kind === "door" ? movedB.connectsToObjectId : undefined).toBe(doorA.id);
      expect(store.getState().saveState).toBe("saved");
    });

    // Replaces "atomically clears displaced partners when re-pairing". Re-pairing
    // no longer exists: a paired opening is already one physical opening, so the
    // resolver refuses rather than silently orphaning the half it displaces.
    it("refuses to re-pair an already-paired opening", async () => {
      const { primaryId, twinId } = await sharedPairOnBoundary(store);
      const before = store.getState().project!.wallObjects;
      const undoStackBefore = store.getState().undoStack.length;

      await store.getState().resolveSharedOpening(primaryId, { kind: "wall", wallId: A_NORTH });

      // Named specifically: falling through to the candidate guard would refuse
      // too, but for the wrong reason and with the wrong sentence.
      expect(store.getState().error).toBe(
        "This is already one half of a shared opening."
      );
      expect(store.getState().undoStack).toHaveLength(undoStackBefore);
      expect(store.getState().project!.wallObjects).toEqual(before);
      expect(partnerOfId(store, twinId)).toBe(primaryId);
    });

    it("rejects cross-kind and blocked-zone connections without committing", async () => {
      await store.getState().addOpening("wall-north", "door");
      await store.getState().addOpening("wall-south", "window");
      await store.getState().addOpening("wall-east", "blocked-zone");
      const [door, window, blocked] = store.getState().project!.wallObjects;
      const undoStackBefore = store.getState().undoStack.length;

      await store
        .getState()
        .resolveSharedOpening(door.id, { kind: "opening", openingId: window.id });
      expect(store.getState().error).toMatch(/same kind/i);

      await store
        .getState()
        .resolveSharedOpening(door.id, { kind: "opening", openingId: blocked.id });

      expect(store.getState().undoStack).toHaveLength(undoStackBefore);
      expect(store.getState().project!.wallObjects).toEqual([door, window, blocked]);
      expect(store.getState().error).toMatch(/only doors and windows/i);
    });

  });

  describe("framed placement validation", () => {
    it("revalidates existing placements when framing changes without rebaking stored dimensions", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("frame-added-later.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, status: "known" }
      });

      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().placeArtwork(artworkId, wall.id, 300, 1450, true);
      const placementBefore = store.getState().project!.wallObjects.at(-1)!;
      expect(store.getState().placementWarnings).toEqual([]);

      await store.getState().updateArtwork(artworkId, {
        matWidthMm: 75,
        frame: { widthMm: 25, finish: "black" }
      });

      expect(store.getState().project!.wallObjects.at(-1)).toEqual(placementBefore);
      expect(store.getState().placementWarnings).toEqual([
        expect.objectContaining({
          wallObjectId: placementBefore.id,
          message: "Placement extends beyond the wall's length.",
          type: "bounds"
        })
      ]);
    });

    it("warns when outer frames overlap even though the stored image rectangles do not", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("framed-a.jpg")]);
      const artworkAId = store.getState().project!.checklistArtworkIds.at(-1)!;
      await store.getState().addArtworksFromFiles([makeImageFile("framed-b.jpg")]);
      const artworkBId = store.getState().project!.checklistArtworkIds.at(-1)!;

      for (const artworkId of [artworkAId, artworkBId]) {
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 500, heightMm: 400, status: "known" },
          matWidthMm: 75,
          frame: { widthMm: 25, finish: "black" }
        });
      }

      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().placeArtwork(artworkAId, wall.id, 1000, 1450, true);
      await store.getState().placeArtwork(artworkBId, wall.id, 1650, 1450, true);

      expect(store.getState().placementWarnings).toEqual([
        expect.objectContaining({
          message: "Artworks overlap on this wall.",
          type: "collision",
          overridable: true
        })
      ]);
    });

    it("flags a frame past the wall edge while the stored image rectangle remains inside", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("framed-edge.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 500, heightMm: 400, status: "known" },
        matWidthMm: 75,
        frame: { widthMm: 25, finish: "black" }
      });

      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().placeArtwork(artworkId, wall.id, 300, 1450, true);

      const placement = store.getState().project!.wallObjects.at(-1)!;
      expect(placement.widthMm).toBe(500);
      expect(placement.xMm - placement.widthMm / 2).toBeGreaterThan(0);
      expect(store.getState().placementWarnings).toEqual([
        expect.objectContaining({
          wallObjectId: placement.id,
          message: "Placement extends beyond the wall's length.",
          type: "bounds"
        })
      ]);
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

      it("re-anchors an artwork member onto another wall (wallId), keeping hang height, in one undo entry", async () => {
        const art = await placeArtworkOnWall(500, 1450);
        const otherWall = store
          .getState()
          .project!.floor.rooms[0].room.walls.find((wall) => wall.id !== art.wall.id)!;
        const undoStackBefore = store.getState().undoStack.length;

        await store
          .getState()
          .movePlanObjectsGroup([{ id: art.placementId, xMm: 700, wallId: otherWall.id }]);

        let state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        let wallObject = state.project!.wallObjects.find((o) => o.id === art.placementId)!;
        expect(wallObject.wallId).toBe(otherWall.id);
        expect(wallObject.xMm).toBe(700);
        // Hang height carries over unchanged across the wall change.
        expect(wallObject.yMm).toBe(1450);

        await store.getState().undo();

        state = store.getState();
        wallObject = state.project!.wallObjects.find((o) => o.id === art.placementId)!;
        expect(wallObject.wallId).toBe(art.wall.id);
        expect(wallObject.xMm).toBe(500);
        expect(wallObject.yMm).toBe(1450);
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

      it.each(["door", "window"] as const)(
        "removes both halves of a paired %s via selection in one undo step",
        async (kind) => {
          await store.getState().addOpening("wall-north", kind);
          const openingA = store.getState().project!.wallObjects[0];
          await store.getState().addOpening("wall-south", kind);
          const openingB = store
            .getState()
            .project!.wallObjects.find((wallObject) => wallObject.id !== openingA.id)!;

          const pairedProject: Project = {
            ...store.getState().project!,
            wallObjects: store.getState().project!.wallObjects.map((wallObject) => {
              if (wallObject.id === openingA.id) {
                return { ...wallObject, connectsToObjectId: openingB.id };
              }
              if (wallObject.id === openingB.id) {
                return { ...wallObject, connectsToObjectId: openingA.id };
              }
              return wallObject;
            })
          };
          await repository.save(pairedProject);
          store.setState({ project: pairedProject });

          store.getState().setObjectSelection([openingB.id]);
          const undoStackBefore = store.getState().undoStack.length;
          await store.getState().removeSelectedPlacements();

          expect(store.getState().project!.wallObjects).toHaveLength(0);
          expect(store.getState().undoStack).toHaveLength(undoStackBefore + 1);
          expect(store.getState().undoStack.at(-1)?.label).toBe("Remove 1 object");

          await store.getState().undo();
          expect(store.getState().project!.wallObjects).toEqual(pairedProject.wallObjects);
        }
      );

      it("includes linked twins when deleting a mixed multi-selection", async () => {
        const artwork = await placeArtworkOnWall(500, 1450);
        await store.getState().addOpening("wall-north", "window");
        const windowA = store
          .getState()
          .project!.wallObjects.find((wallObject) => wallObject.kind === "window")!;
        await store.getState().addOpening("wall-south", "window");
        const windowB = store
          .getState()
          .project!.wallObjects.find(
            (wallObject) => wallObject.kind === "window" && wallObject.id !== windowA.id
          )!;
        linkLegacyPair(store, windowA.id, windowB.id);

        store.getState().setObjectSelection([artwork.placementId, windowB.id]);
        await store.getState().removeSelectedPlacements();

        expect(store.getState().project!.wallObjects).toHaveLength(0);
        expect(store.getState().undoStack.at(-1)?.label).toBe("Remove 2 objects");
      });
    });

    describe("arrange session", () => {
      // Canonical 2540 mm wall with three 508 mm works.
      async function threeWorksOnWall() {
        const wallId = getSelectedWall(store.getState().project!, store.getState().wallContextId)!.id;
        await store.getState().resizeWall(wallId, 2540);
        const a = await placeArtworkOnWall(200, 1450, 508);
        const b = await placeArtworkOnWall(1000, 1450, 508);
        const c = await placeArtworkOnWall(2000, 1450, 508);
        store.getState().setObjectSelection([a.placementId, b.placementId, c.placementId]);
        const wall = getSelectedWall(store.getState().project!, wallId)!;
        return { wall, a, b, c };
      }

      function xById(id: string): number {
        return store.getState().project!.wallObjects.find((o) => o.id === id)!.xMm;
      }

      it("bounds the session at a partition standing in front of the wall", async () => {
        // A partition close to a wall carves it into bays; an arrange session
        // must distribute inside the bay, not run past the slab to the wall end.
        const wallId = getSelectedWall(
          store.getState().project!,
          store.getState().wallContextId
        )!.id;
        await store.getState().resizeWall(wallId, 4000);
        const a = await placeArtworkOnWall(2600, 1450, 400);
        const b = await placeArtworkOnWall(3400, 1450, 400);

        // Parallel to the wall, 400 mm into the room (interior = LEFT normal of
        // start→end), covering 200..2000 along the run.
        const floorWall = getFloorWalls(store.getState().project!.floor).find(
          (wall) => wall.id === wallId
        )!;
        const uxMm = (floorWall.endFloorMm.xMm - floorWall.startFloorMm.xMm) / floorWall.lengthMm;
        const uyMm = (floorWall.endFloorMm.yMm - floorWall.startFloorMm.yMm) / floorWall.lengthMm;
        const at = (alongMm: number) => ({
          xMm: floorWall.startFloorMm.xMm + uxMm * alongMm + -uyMm * 400,
          yMm: floorWall.startFloorMm.yMm + uyMm * alongMm + uxMm * 400
        });
        await store.getState().addFreestandingWall(at(200), at(2000));
        const partition =
          store.getState().project!.floor.rooms.flatMap((placement) =>
            placement.room.freestandingWalls
          )[0];
        expect(partition).toBeDefined();

        store.getState().setObjectSelection([a.placementId, b.placementId]);
        store.getState().beginArrangeSession("equal");

        const session = store.getState().arrangeSession!;
        // The bay runs from the slab's projected right edge to the wall end.
        expect(session.openZoneBoundsMm.startMm).toBeCloseTo(2000);
        expect(session.openZoneBoundsMm.endMm).toBeCloseTo(4000);
        // And the frozen "From edges" target names the partition, not the wall.
        expect(session.insetBoundary.left).toMatchObject({
          type: "object",
          objectId: partition.id
        });
        expect(session.insetBoundary.right).toMatchObject({ type: "wall" });
      });

      describe("centerSelectionBetweenBoundaries", () => {
        // Same scene as the session test above: a slab covering 200..2000 of a
        // 4000 mm wall, so the works hang in the bay it leaves behind.
        async function twoWorksInAPartitionBay() {
          const wallId = getSelectedWall(
            store.getState().project!,
            store.getState().wallContextId
          )!.id;
          await store.getState().resizeWall(wallId, 4000);
          const a = await placeArtworkOnWall(2600, 1450, 400);
          const b = await placeArtworkOnWall(3200, 1450, 400);

          const floorWall = getFloorWalls(store.getState().project!.floor).find(
            (wall) => wall.id === wallId
          )!;
          const uxMm =
            (floorWall.endFloorMm.xMm - floorWall.startFloorMm.xMm) / floorWall.lengthMm;
          const uyMm =
            (floorWall.endFloorMm.yMm - floorWall.startFloorMm.yMm) / floorWall.lengthMm;
          const at = (alongMm: number) => ({
            xMm: floorWall.startFloorMm.xMm + uxMm * alongMm + -uyMm * 400,
            yMm: floorWall.startFloorMm.yMm + uyMm * alongMm + uxMm * 400
          });
          await store.getState().addFreestandingWall(at(200), at(2000));

          store.getState().setObjectSelection([a.placementId, b.placementId]);
          return { a, b };
        }

        it("centers the group in the bay a real partition opens, in one undo step", async () => {
          const { a, b } = await twoWorksInAPartitionBay();
          const undoStackBefore = store.getState().undoStack.length;

          await store.getState().centerSelectionBetweenBoundaries();

          // Group spans 2400..3400; the bay runs 2000..4000, so the whole block
          // slides 100 mm right and the 600 mm interval is untouched.
          expect(xById(a.placementId)).toBeCloseTo(2700);
          expect(xById(b.placementId)).toBeCloseTo(3300);
          expect(xById(b.placementId) - xById(a.placementId)).toBeCloseTo(600);

          expect(store.getState().undoStack).toHaveLength(undoStackBefore + 1);
          expect(store.getState().undoStack.at(-1)?.label).toBe("Center on wall");

          await store.getState().undo();
          expect(xById(a.placementId)).toBeCloseTo(2600);
          expect(xById(b.placementId)).toBeCloseTo(3200);
        });

        it("centers on the wall itself once the partition is gone", async () => {
          await twoWorksInAPartitionBay();
          const partitionId = store.getState().project!.floor.rooms.flatMap(
            (placement) => placement.room.freestandingWalls
          )[0].id;
          const ids = objectIdsOf(store.getState().selection);

          await store.getState().deleteFreestandingWall(partitionId);
          store.getState().setObjectSelection(ids);
          await store.getState().centerSelectionBetweenBoundaries();

          // Wall 0..4000 with a 1000 mm span: the block centers at 1500/2100.
          expect(xById(ids[0])).toBeCloseTo(1700);
          expect(xById(ids[1])).toBeCloseTo(2300);
        });

        it("does nothing for a selection the arrange controls refuse", async () => {
          const a = await placeArtworkOnWall(500, 1450);
          await store.getState().addArtworksFromFiles([makeImageFile("floor-center.jpg")]);
          const floorArtworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
          await store.getState().placeArtworkOnFloor(floorArtworkId, 1000, 1000);
          const floorObjectId = store.getState().project!.floorObjects[0].id;
          store.getState().setObjectSelection([a.placementId, floorObjectId]);
          const undoStackBefore = store.getState().undoStack.length;

          await store.getState().centerSelectionBetweenBoundaries();

          expect(store.getState().undoStack).toHaveLength(undoStackBefore);
          expect(xById(a.placementId)).toBe(500);
        });

        it("routes into a live session's preview instead of committing behind it", async () => {
          const { a, b } = await twoWorksInAPartitionBay();
          store.getState().beginArrangeSession("inset");
          const undoStackBefore = store.getState().undoStack.length;

          await store.getState().centerSelectionBetweenBoundaries();

          // Pending, not committed: Apply/Cancel still governs the move.
          expect(store.getState().undoStack).toHaveLength(undoStackBefore);
          expect(xById(a.placementId)).toBeCloseTo(2600);
          const session = store.getState().arrangeSession!;
          expect(session.previewById[a.placementId].xMm).toBeCloseTo(2700);
          expect(session.previewById[b.placementId].xMm).toBeCloseTo(3300);

          store.getState().commitArrangeSession();
          expect(xById(a.placementId)).toBeCloseTo(2700);
          expect(store.getState().undoStack).toHaveLength(undoStackBefore + 1);
        });
      });

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
          expect(session.previewById).toEqual(previewAfterEqual);
        });

        it("remembers the last arrange mode across begins (default inset)", async () => {
          expect(store.getState().lastArrangeMode).toBe("inset");

          await threeWorksOnWall();
          store.getState().beginArrangeSession("gap");
          expect(store.getState().lastArrangeMode).toBe("gap");

          store.getState().beginArrangeSession("equal");
          expect(store.getState().lastArrangeMode).toBe("equal");

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
        expect(store.getState().project).toBe(projectBefore);
        expect(store.getState().undoStack).toHaveLength(undoBefore);
      });

      it("spaces mixed framed and unframed works equally between their outer edges", async () => {
        const { wall, a, b, c } = await threeWorksOnWall();
        await store.getState().updateArtwork(a.artworkId, {
          matWidthMm: 75,
          frame: { widthMm: 25, finish: "black" }
        });
        const persistedBefore = store.getState().project!.wallObjects.filter((object) =>
          [a.placementId, b.placementId, c.placementId].includes(object.id)
        );

        store.getState().beginArrangeSession("equal");
        store.getState().updateArrangeSession({ equal: true });

        const preview = store.getState().arrangeSession!.previewById;
        const artworksById = new Map(
          store.getState().libraryArtworks.map((artwork) => [artwork.id, artwork])
        );
        const footprintMembers = persistedBefore.map((object) => {
          const previewCenter = preview[object.id];
          const previewed = { ...object, xMm: previewCenter.xMm, yMm: previewCenter.yMm };
          return withArtworkFootprint(
            previewed,
            previewed.kind === "artwork"
              ? artworksById.get(previewed.artworkId)
              : undefined
          );
        });
        const spaces = getSpacingSegments(footprintMembers, wall.lengthMm).map(
          (segment) => segment.toMm - segment.fromMm
        );

        expect(new Set(spaces.map((space) => space.toFixed(6))).size).toBe(1);
        expect(footprintMembers.find((member) => member.id === a.placementId)?.widthMm).toBe(
          708
        );
        expect(
          store.getState().project!.wallObjects.find((object) => object.id === a.placementId)
            ?.widthMm
        ).toBe(508);
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
        const newLeftEdge = Math.min(
          ...movedMembers.map((m) => m.xMm - m.widthMm / 2)
        );
        expect(newLeftEdge).toBeCloseTo(300);
        const gapsAfter = getSpacingSegments(movedMembers, wall.lengthMm)
          .slice(1, -1)
          .map((s) => s.toMm - s.fromMm);
        expect(gapsAfter).toEqual(gapsBefore);
        const deltas = movedMembers.map(
          (m, i) => m.xMm - membersBefore[i].xMm
        );
        expect(new Set(deltas.map((d) => d.toFixed(6))).size).toBe(1);
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
        // Make the door the nearest left boundary. Flush against the wall's
        // start — x is the CENTRE, so the smallest legal value is half the
        // width; moveOpening clamps anything lower back onto the wall.
        await store.getState().moveOpening(door.id, door.widthMm / 2, door.yMm, true);

        store.getState().setObjectSelection([a.placementId, b.placementId]);
        store.getState().beginArrangeSession("inset");
        store.getState().setArrangeAnchor("left");

        const session = store.getState().arrangeSession!;
        const doorRightEdgeMm = door.widthMm;
        expect(session.insetBoundary.left).toEqual({
          type: "object",
          edgeMm: doorRightEdgeMm,
          objectId: door.id
        });
        expect(session.insetBoundary.right).toEqual({ type: "wall", edgeMm: 3000 });

        store.getState().updateArrangeSession({ insetMm: 100, anchor: "left" });
        const preview = store.getState().arrangeSession!.previewById;
        const groupLeftEdgeMm = preview[a.placementId].xMm - 400 / 2;
        expect(groupLeftEdgeMm).toBeCloseTo(doorRightEdgeMm + 100);

        // The detected boundary itself must not move on commit.
        store.getState().commitArrangeSession(true);
        const doorAfter = store
          .getState()
          .project!.wallObjects.find((o) => o.id === door.id)!;
        expect(doorAfter.xMm).toBe(door.widthMm / 2);
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
        // Regression: changing a gap must preserve an off-center pair's union center.
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

        expect(dx1 - w / 2 - (cx1 + w / 2)).toBeCloseTo(newGap);
        const newCenter = (cx1 - w / 2 + (dx1 + w / 2)) / 2;
        expect(newCenter).toBeCloseTo(oldCenter);
        expect(Math.abs(newCenter - wall.lengthMm / 2)).toBeGreaterThan(500);
        const delta = newGap - oldGap;
        expect(cx1 - cx0).toBeCloseTo(-delta / 2);
        expect(dx1 - dx0).toBeCloseTo(delta / 2);
        expect(store.getState().undoStack).toHaveLength(undoBefore);

        store.getState().commitArrangeSession();
        const state = store.getState();
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
        expect(xById(c.placementId)).toBeCloseTo(cx1);
        expect(xById(d.placementId)).toBeCloseTo(dx1);
      });

      describe("space-within zone (Space evenly)", () => {
        // An unselected neighbor bounds the open-space zone on the left.
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
          const equalOpen = solveEqualArrangementInZone(members, 800, 3000);
          expect(groupLeftEdge(ids)).toBeCloseTo(800 + equalOpen.insetMm, 4);
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

  // Artwork collisions are blockable; the explicit overlap preference opts in.
  describe("artwork/artwork overlap (blockable)", () => {
    async function placeTwoArtworks() {
      await store.getState().addArtworksFromFiles([makeImageFile("overlap-a.jpg")]);
      const artworkAId = store.getState().project!.checklistArtworkIds.at(-1)!;
      await store.getState().addArtworksFromFiles([makeImageFile("overlap-b.jpg")]);
      const artworkBId = store.getState().project!.checklistArtworkIds.at(-1)!;

      const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
      await store.getState().placeArtwork(artworkAId, wall.id, 500, 1450, true);
      const a = store.getState().project!.wallObjects.at(-1)!;
      await store.getState().placeArtwork(artworkBId, wall.id, 1500, 1450, true);
      const b = store.getState().project!.wallObjects.at(-1)!;
      return { a, b };
    }

    it("blocks stacking two artworks when Allow overlap is off", async () => {
      const { a, b } = await placeTwoArtworks();
      store.getState().setObjectSelection([a.id, b.id]);
      const undoBefore = store.getState().undoStack.length;

      store.getState().beginArrangeSession("gap");
      store.getState().setArrangeSessionPreview([
        { id: a.id, xMm: 1000, yMm: 1450 },
        { id: b.id, xMm: 1000, yMm: 1450 }
      ]);
      store.getState().commitArrangeSession(false);

      const state = store.getState();
      expect(state.error).toBe(OVERLAP_BLOCKED_MESSAGE);
      expect(state.undoStack).toHaveLength(undoBefore);
    });

    it("commits stacked artworks when Allow overlap is on, surfacing a collision (not 'overlap') warning", async () => {
      const { a, b } = await placeTwoArtworks();
      store.getState().setObjectSelection([a.id, b.id]);
      const undoBefore = store.getState().undoStack.length;

      store.getState().beginArrangeSession("gap");
      store.getState().setArrangeSessionPreview([
        { id: a.id, xMm: 1000, yMm: 1450 },
        { id: b.id, xMm: 1000, yMm: 1450 }
      ]);
      store.getState().commitArrangeSession(true);

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.arrangeSession).toBeNull();
      expect(state.undoStack).toHaveLength(undoBefore + 1);
      expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
      expect(state.placementWarnings.some((warning) => warning.type === "collision")).toBe(true);
      expect(state.placementWarnings.every((warning) => warning.type !== "overlap")).toBe(true);
    });
  });

  describe("save-error provenance", () => {
    it("classifies a failed project save as scope 'project' and its retry re-runs persist", async () => {
      const saveSpy = vi
        .spyOn(repository, "save")
        .mockRejectedValueOnce(new Error("disk full"));

      // Any project edit routes through persist().
      await store.getState().resizeSelectedWall(9_000);

      let state = store.getState();
      expect(state.saveState).toBe("error");
      expect(state.saveError?.scope).toBe("project");
      expect(state.saveError?.message).toMatch(/disk full/);
      expect(state.error).toMatch(/disk full/);
      // First attempt only; the mock rejected once so the retry can succeed.
      expect(saveSpy).toHaveBeenCalledTimes(1);

      // The Retry closure re-runs the same persist and recovers on success.
      await state.saveError!.retry();

      state = store.getState();
      expect(saveSpy).toHaveBeenCalledTimes(2);
      expect(state.saveState).toBe("saved");
      expect(state.saveError).toBeNull();
    });

    it("renders a schema rejection as a sentence, not the raw ZodError JSON", async () => {
      // A ZodError's .message is JSON.stringify(issues), which used to be
      // dumped verbatim into the banner and the retry toast.
      const zodError = new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: "Paired openings must be on different walls (edb52a21-890a-4d31-9df1-d27ba5b2e17b).",
          path: ["wallObjects", "edb52a21-890a-4d31-9df1-d27ba5b2e17b", "connectsToObjectId"]
        }
      ]);
      vi.spyOn(repository, "save").mockRejectedValueOnce(zodError);

      await store.getState().resizeSelectedWall(9_000);

      const state = store.getState();
      expect(state.error).toBe(
        "Couldn't save: paired openings must be on different walls."
      );
      // No JSON punctuation, no internal object id.
      expect(state.error).not.toMatch(/[[\]{}"]/);
      expect(state.error).not.toMatch(/edb52a21/);
      expect(state.saveError?.message).toBe(state.error);
    });

    it("classifies a failed artwork-library save as scope 'artworkLibrary' and its retry re-runs the artwork save", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];

      const artworkSave = vi
        .spyOn(artworkLibraryRepository, "save")
        .mockRejectedValueOnce(new Error("library write failed"));

      await store.getState().updateArtwork(artworkId, { title: "Untitled No. 4" });

      let state = store.getState();
      expect(state.saveState).toBe("error");
      expect(state.saveError?.scope).toBe("artworkLibrary");
      expect(state.saveError?.message).toMatch(/library write failed/);
      expect(artworkSave).toHaveBeenCalledTimes(1);

      // Retry re-runs exactly the artwork save; on success the state recovers.
      await state.saveError!.retry();

      state = store.getState();
      expect(artworkSave).toHaveBeenCalledTimes(2);
      expect(state.saveState).toBe("saved");
      expect(state.saveError).toBeNull();
      expect(artworkLibraryRepository.artworks.get(artworkId)?.title).toBe("Untitled No. 4");
    });

    it("repeated same-scope failures never re-toast: shouldAnnounceSaveError fires only on transition into error", () => {
      const project: SaveError = { scope: "project", message: "a", retry: async () => {} };
      const projectAgain: SaveError = { scope: "project", message: "b", retry: async () => {} };
      const artwork: SaveError = { scope: "artworkLibrary", message: "c", retry: async () => {} };

      // Clean → error announces; a fresh same-scope failure (keystroke) does not.
      expect(shouldAnnounceSaveError(null, project)).toBe(true);
      expect(shouldAnnounceSaveError(project, projectAgain)).toBe(false);
      // A different failing scope announces; recovery (→ null) never toasts.
      expect(shouldAnnounceSaveError(project, artwork)).toBe(true);
      expect(shouldAnnounceSaveError(project, null)).toBe(false);
      // After a recovery, the next failure announces again.
      expect(shouldAnnounceSaveError(null, artwork)).toBe(true);
    });
  });
});

// Bypass applyEdit to construct a dangling-placement fixture.
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
