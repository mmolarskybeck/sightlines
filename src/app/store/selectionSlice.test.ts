import { beforeEach, describe, expect, it } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import type {
  ArtworkWallObject,
  OpeningWallObject,
  Project
} from "../../domain/project";
import {
  FakeImageProcessor,
  InMemoryArtworkLibraryRepository,
  InMemoryAssetRepository,
  InMemoryProjectRepository,
  makeImageFile
} from "../../test/inMemoryRepositories";
import { createAppStore } from "../store";
import {
  getSelectedArtworkId,
  getSelectedOpeningId,
  NO_SELECTION,
  objectIdsOf,
  roomIdOf,
  selectionWrite,
  type Selection
} from "./selectionSlice";

// The stock sample project ships with EMPTY wallObjects/floorObjects, so
// (unlike the brief's sketch) we can't pluck a placement off it — we build a
// fixture project with one artwork placement and one opening placement whose
// ids the helpers resolve against.
const artworkPlacement: ArtworkWallObject = {
  id: "wo-artwork-1",
  wallId: "wall-north",
  kind: "artwork",
  artworkId: "lib-artwork-1",
  xMm: 1000,
  yMm: 1450,
  widthMm: 500,
  heightMm: 400
};
const openingPlacement: OpeningWallObject = {
  id: "wo-door-1",
  wallId: "wall-north",
  kind: "door",
  blocksPlacement: true,
  xMm: 2000,
  yMm: 1000,
  widthMm: 900,
  heightMm: 2000
};
const project: Project = {
  ...createSampleProject(),
  wallObjects: [artworkPlacement, openingPlacement]
};

describe("selection helpers", () => {
  it("objectIdsOf returns the ids for objects and a stable [] otherwise", () => {
    const sel: Selection = { kind: "objects", ids: ["a"] };
    expect(objectIdsOf(sel)).toEqual(["a"]);
    expect(objectIdsOf(NO_SELECTION)).toBe(objectIdsOf({ kind: "room", roomId: "r" })); // same identity
  });

  it("roomIdOf", () => {
    expect(roomIdOf({ kind: "room", roomId: "r1" })).toBe("r1");
    expect(roomIdOf(NO_SELECTION)).toBeNull();
  });

  it("a single artwork placement derives its library artworkId", () => {
    const sel: Selection = { kind: "objects", ids: [artworkPlacement.id] };
    expect(getSelectedArtworkId(project, sel)).toBe(artworkPlacement.artworkId);
    expect(getSelectedOpeningId(project, sel)).toBeNull();
  });

  it("a single opening placement derives selectedOpeningId", () => {
    const sel: Selection = { kind: "objects", ids: [openingPlacement.id] };
    expect(getSelectedOpeningId(project, sel)).toBe(openingPlacement.id);
    expect(getSelectedArtworkId(project, sel)).toBeNull();
  });

  it("multi-select and dangling ids derive neither single-select", () => {
    expect(
      getSelectedArtworkId(project, {
        kind: "objects",
        ids: [artworkPlacement.id, openingPlacement.id]
      })
    ).toBeNull();
    expect(getSelectedArtworkId(project, { kind: "objects", ids: ["dead-id"] })).toBeNull();
    expect(getSelectedOpeningId(project, { kind: "objects", ids: ["dead-id"] })).toBeNull();
  });

  it("libraryArtwork selection derives artworkId without a placement", () => {
    expect(getSelectedArtworkId(project, { kind: "libraryArtwork", artworkId: "lib-1" })).toBe(
      "lib-1"
    );
    expect(getSelectedOpeningId(project, { kind: "libraryArtwork", artworkId: "lib-1" })).toBeNull();
  });

  it("selectionWrite mirrors every legacy field", () => {
    const fields = selectionWrite(project, { kind: "objects", ids: [artworkPlacement.id] }, "wall-1");
    expect(fields).toEqual({
      selection: { kind: "objects", ids: [artworkPlacement.id] },
      wallContextId: "wall-1",
      selectedWallId: "wall-1",
      selectedArtworkId: artworkPlacement.artworkId,
      selectedOpeningId: null,
      selectedObjectIds: [artworkPlacement.id],
      selectedRoomId: null
    });
  });

  it("selectionWrite normalizes an empty objects selection to none", () => {
    const fields = selectionWrite(project, { kind: "objects", ids: [] }, "wall-1");
    expect(fields.selection).toEqual(NO_SELECTION);
    expect(fields.selectedObjectIds).toEqual([]);
    expect(fields.selectedWallId).toBe("wall-1");
  });
});

function makeStore() {
  return createAppStore({
    projectRepository: new InMemoryProjectRepository(),
    artworkLibraryRepository: new InMemoryArtworkLibraryRepository(),
    assetRepository: new InMemoryAssetRepository(),
    imageProcessor: new FakeImageProcessor()
  });
}

describe("selection transitions through the store", () => {
  // The booted sample project has room-main with wall-north/east/south/west
  // and empty object arrays — we add the placements/openings/checklist entries
  // each test needs.
  let store: ReturnType<typeof makeStore>;

  beforeEach(async () => {
    store = makeStore();
    await store.getState().boot();
  });

  async function addChecklistArtwork(name: string): Promise<string> {
    await store.getState().addArtworksFromFiles([makeImageFile(name)]);
    return store.getState().project!.checklistArtworkIds.at(-1)!;
  }

  async function placeOnWall(
    name: string,
    xMm = 1000,
    widthMm?: number
  ): Promise<{ artworkId: string; placementId: string }> {
    const artworkId = await addChecklistArtwork(name);
    if (widthMm !== undefined) {
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm, heightMm: 400, status: "known" }
      });
    }
    await store.getState().placeArtwork(artworkId, "wall-north", xMm, 1450, true);
    const placementId = store.getState().project!.wallObjects.at(-1)!.id;
    return { artworkId, placementId };
  }

  async function addDoor(): Promise<string> {
    await store.getState().addOpening("wall-north", "door");
    return store.getState().project!.wallObjects.find((object) => object.kind === "door")!.id;
  }

  // Three equal-width works on a wall too short for their current spread, then
  // selected — begin+update produces a real preview delta the settle logic can
  // commit.
  async function threeWorksOnWall(): Promise<string[]> {
    await store.getState().resizeWall("wall-north", 2540);
    const ids: string[] = [];
    for (const [index, xMm] of [200, 1000, 2000].entries()) {
      const { placementId } = await placeOnWall(`work-${index}.jpg`, xMm, 508);
      ids.push(placementId);
    }
    store.getState().setObjectSelection(ids);
    return ids;
  }

  it("selectArtwork with a placed artwork selects its placement (wart fix)", async () => {
    const { artworkId, placementId } = await placeOnWall("placed.jpg");
    store.getState().clearObjectSelection();

    store.getState().selectArtwork(artworkId);

    const state = store.getState();
    expect(state.selection).toEqual({ kind: "objects", ids: [placementId] });
    expect(state.selectedObjectIds).toEqual([placementId]);
    expect(state.selectedArtworkId).toBe(artworkId);
  });

  it("selectArtwork with an unplaced checklist artwork selects libraryArtwork", async () => {
    const artworkId = await addChecklistArtwork("unplaced.jpg");

    store.getState().selectArtwork(artworkId);

    const state = store.getState();
    expect(state.selection).toEqual({ kind: "libraryArtwork", artworkId });
    expect(state.selectedObjectIds).toEqual([]);
    expect(state.selectedArtworkId).toBe(artworkId);
    expect(state.selectedOpeningId).toBeNull();
  });

  it("selectOpening lands in objects; dead id is a no-op", async () => {
    const openingId = await addDoor();
    store.getState().clearObjectSelection();

    store.getState().selectOpening(openingId);

    expect(store.getState().selection).toEqual({ kind: "objects", ids: [openingId] });
    expect(store.getState().selectedOpeningId).toBe(openingId);

    const before = store.getState().selection;
    store.getState().selectOpening("dead-id");
    // A dead id leaves the selection untouched (same object reference).
    expect(store.getState().selection).toBe(before);
  });

  it("selectWall clears selection but keeps it as context", async () => {
    const { placementId } = await placeOnWall("p.jpg");
    store.getState().selectObject(placementId);

    store.getState().selectWall("wall-east");

    const state = store.getState();
    expect(state.selection).toEqual(NO_SELECTION);
    expect(state.wallContextId).toBe("wall-east");
    expect(state.selectedWallId).toBe("wall-east");
    expect(state.selectedObjectIds).toEqual([]);
  });

  it("selectRoom drops wall context; selectWall drops room", () => {
    store.getState().selectRoom("room-main");
    let state = store.getState();
    expect(state.selection).toEqual({ kind: "room", roomId: "room-main" });
    expect(state.wallContextId).toBeNull();
    expect(state.selectedRoomId).toBe("room-main");

    store.getState().selectWall("wall-east");
    state = store.getState();
    expect(state.selection).toEqual(NO_SELECTION);
    expect(state.selectedRoomId).toBeNull();
    expect(state.wallContextId).toBe("wall-east");
  });

  it("selectObject additive toggles; removing the last id normalizes to none", async () => {
    const a = await placeOnWall("a.jpg", 500);
    const b = await placeOnWall("b.jpg", 1500);

    store.getState().selectObject(a.placementId);
    expect(store.getState().selectedObjectIds).toEqual([a.placementId]);

    store.getState().selectObject(b.placementId, { additive: true });
    expect([...store.getState().selectedObjectIds].sort()).toEqual(
      [a.placementId, b.placementId].sort()
    );

    store.getState().selectObject(b.placementId, { additive: true });
    expect(store.getState().selectedObjectIds).toEqual([a.placementId]);

    store.getState().selectObject(a.placementId, { additive: true });
    expect(store.getState().selection).toEqual(NO_SELECTION);
    expect(store.getState().selectedObjectIds).toEqual([]);
  });

  it("mirrors never drift from the union after every action", async () => {
    const a = await placeOnWall("drift-a.jpg", 500);
    const b = await placeOnWall("drift-b.jpg", 1500);
    const openingId = await addDoor();
    const unplaced = await addChecklistArtwork("drift-unplaced.jpg");

    const actions: Array<() => void> = [
      () => store.getState().selectWall("wall-east"),
      () => store.getState().selectArtwork(a.artworkId),
      () => store.getState().selectArtwork(unplaced),
      () => store.getState().selectOpening(openingId),
      () => store.getState().selectObject(b.placementId),
      () => store.getState().selectObject(a.placementId, { additive: true }),
      () => store.getState().selectRoom("room-main"),
      () => store.getState().clearObjectSelection()
    ];

    for (const act of actions) {
      act();
      const state = store.getState();
      // Every mirror is exactly what the pure derivation says it should be.
      expect(state.selectedObjectIds).toBe(objectIdsOf(state.selection));
      expect(state.selectedRoomId).toBe(roomIdOf(state.selection));
      expect(state.selectedArtworkId).toBe(getSelectedArtworkId(state.project, state.selection));
      expect(state.selectedOpeningId).toBe(getSelectedOpeningId(state.project, state.selection));
      expect(state.selectedWallId).toBe(state.wallContextId);
    }
  });

  it("a selection change auto-accepts a live arrange session that moved", async () => {
    await threeWorksOnWall();
    store.getState().beginArrangeSession("equal");
    store.getState().updateArrangeSession({ equal: true });
    const undoBefore = store.getState().undoStack.length;

    store.getState().selectWall("wall-east");

    const state = store.getState();
    expect(state.arrangeSession).toBeNull();
    expect(state.undoStack).toHaveLength(undoBefore + 1);
    expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
  });
});

// The spec asks for an explicit settle matrix. These rows are NOT already
// covered in store.test.ts (which covers: selection change → accept via
// selectObject/clearObjectSelection, foreign edit → cancel, undo → cancel,
// collision-blocked auto-accept → cancel). The rows added here fill the gaps.
describe("arrange-session settle matrix (rows missing from store.test.ts)", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(async () => {
    store = makeStore();
    await store.getState().boot();
  });

  async function threeWorksOnWall(): Promise<string[]> {
    await store.getState().resizeWall("wall-north", 2540);
    const ids: string[] = [];
    for (const [index, xMm] of [200, 1000, 2000].entries()) {
      await store.getState().addArtworksFromFiles([makeImageFile(`m-work-${index}.jpg`)]);
      const artworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
      await store.getState().updateArtwork(artworkId, {
        dimensions: { widthMm: 508, heightMm: 400, status: "known" }
      });
      await store.getState().placeArtwork(artworkId, "wall-north", xMm, 1450, true);
      ids.push(store.getState().project!.wallObjects.at(-1)!.id);
    }
    store.getState().setObjectSelection(ids);
    return ids;
  }

  it("view-mode change → accept (undo entry when the preview moved)", async () => {
    await threeWorksOnWall();
    store.getState().beginArrangeSession("equal");
    store.getState().updateArrangeSession({ equal: true });
    const undoBefore = store.getState().undoStack.length;

    store.getState().setViewMode("elevation");

    const state = store.getState();
    expect(state.arrangeSession).toBeNull();
    expect(state.viewMode).toBe("elevation");
    expect(state.undoStack).toHaveLength(undoBefore + 1);
    expect(state.undoStack.at(-1)?.label).toBe("Arrange on wall");
  });

  it("selection change with no preview delta settles silently (no undo entry)", async () => {
    await threeWorksOnWall();
    store.getState().beginArrangeSession("equal");
    // No updateArrangeSession: the preview equals the committed layout.
    const undoBefore = store.getState().undoStack.length;

    store.getState().selectWall("wall-east");

    const state = store.getState();
    expect(state.arrangeSession).toBeNull();
    expect(state.undoStack).toHaveLength(undoBefore);
  });

  it("redo → session dropped, no extra 'Arrange on wall' entry", async () => {
    const ids = await threeWorksOnWall();
    await store.getState().moveArtworkPlacement(ids[0], 350, 1450);
    await store.getState().undo(); // a redo is now available
    store.getState().setObjectSelection(ids);
    store.getState().beginArrangeSession("equal");
    store.getState().updateArrangeSession({ equal: true });

    await store.getState().redo();

    const state = store.getState();
    expect(state.arrangeSession).toBeNull();
    // The redone entry is the move, not a phantom arrange commit.
    expect(state.undoStack.at(-1)?.label).toBe("Move artwork");
  });
});
