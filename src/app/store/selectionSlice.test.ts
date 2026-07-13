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

// Fixture with real artwork and opening IDs for selection resolution.
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

  it("selectionWrite returns just the union and wall context", () => {
    const fields = selectionWrite(project, { kind: "objects", ids: [artworkPlacement.id] }, "wall-1");
    expect(fields).toEqual({
      selection: { kind: "objects", ids: [artworkPlacement.id] },
      wallContextId: "wall-1"
    });
  });

  it("selectionWrite normalizes an empty objects selection to none", () => {
    const fields = selectionWrite(project, { kind: "objects", ids: [] }, "wall-1");
    expect(fields.selection).toEqual(NO_SELECTION);
    expect(fields.wallContextId).toBe("wall-1");
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

  // Produce a nontrivial arrange preview for settle tests.
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
    expect(objectIdsOf(state.selection)).toEqual([placementId]);
    expect(getSelectedArtworkId(state.project, state.selection)).toBe(artworkId);
  });

  it("selectArtwork with an unplaced checklist artwork selects libraryArtwork", async () => {
    const artworkId = await addChecklistArtwork("unplaced.jpg");

    store.getState().selectArtwork(artworkId);

    const state = store.getState();
    expect(state.selection).toEqual({ kind: "libraryArtwork", artworkId });
    expect(objectIdsOf(state.selection)).toEqual([]);
    expect(getSelectedArtworkId(state.project, state.selection)).toBe(artworkId);
    expect(getSelectedOpeningId(state.project, state.selection)).toBeNull();
  });

  it("selectOpening lands in objects; dead id is a no-op", async () => {
    const openingId = await addDoor();
    store.getState().clearObjectSelection();

    store.getState().selectOpening(openingId);

    expect(store.getState().selection).toEqual({ kind: "objects", ids: [openingId] });
    expect(
      getSelectedOpeningId(store.getState().project, store.getState().selection)
    ).toBe(openingId);

    const before = store.getState().selection;
    store.getState().selectOpening("dead-id");
    expect(store.getState().selection).toBe(before);
  });

  it("selectWall clears selection but keeps it as context", async () => {
    const { placementId } = await placeOnWall("p.jpg");
    store.getState().selectObject(placementId);

    store.getState().selectWall("wall-east");

    const state = store.getState();
    expect(state.selection).toEqual(NO_SELECTION);
    expect(state.wallContextId).toBe("wall-east");
    expect(objectIdsOf(state.selection)).toEqual([]);
  });

  it("selectRoom drops wall context; selectWall drops room", () => {
    store.getState().selectRoom("room-main");
    let state = store.getState();
    expect(state.selection).toEqual({ kind: "room", roomId: "room-main" });
    expect(state.wallContextId).toBeNull();
    expect(roomIdOf(state.selection)).toBe("room-main");

    store.getState().selectWall("wall-east");
    state = store.getState();
    expect(state.selection).toEqual(NO_SELECTION);
    expect(roomIdOf(state.selection)).toBeNull();
    expect(state.wallContextId).toBe("wall-east");
  });

  it("selectObject additive toggles; removing the last id normalizes to none", async () => {
    const a = await placeOnWall("a.jpg", 500);
    const b = await placeOnWall("b.jpg", 1500);

    store.getState().selectObject(a.placementId);
    expect(objectIdsOf(store.getState().selection)).toEqual([a.placementId]);

    store.getState().selectObject(b.placementId, { additive: true });
    expect([...objectIdsOf(store.getState().selection)].sort()).toEqual(
      [a.placementId, b.placementId].sort()
    );

    store.getState().selectObject(b.placementId, { additive: true });
    expect(objectIdsOf(store.getState().selection)).toEqual([a.placementId]);

    store.getState().selectObject(a.placementId, { additive: true });
    expect(store.getState().selection).toEqual(NO_SELECTION);
    expect(objectIdsOf(store.getState().selection)).toEqual([]);
  });

  it("every selection action lands the union and its derivations on the intended value", async () => {
    const a = await placeOnWall("drift-a.jpg", 500);
    const b = await placeOnWall("drift-b.jpg", 1500);
    const openingId = await addDoor();
    const unplaced = await addChecklistArtwork("drift-unplaced.jpg");

    // Verify each action directly against the unified selection state.
    type Expectation = {
      act: () => void;
      selection: Selection;
      wallContextId: string | null;
      artworkId: string | null;
      openingId: string | null;
      objectIds: string[];
      roomId: string | null;
    };
    const cases: Expectation[] = [
      {
        act: () => store.getState().selectWall("wall-east"),
        selection: NO_SELECTION,
        wallContextId: "wall-east",
        artworkId: null,
        openingId: null,
        objectIds: [],
        roomId: null
      },
      {
        act: () => store.getState().selectArtwork(a.artworkId),
        selection: { kind: "objects", ids: [a.placementId] },
        wallContextId: "wall-east",
        artworkId: a.artworkId,
        openingId: null,
        objectIds: [a.placementId],
        roomId: null
      },
      {
        act: () => store.getState().selectArtwork(unplaced),
        selection: { kind: "libraryArtwork", artworkId: unplaced },
        wallContextId: "wall-east",
        artworkId: unplaced,
        openingId: null,
        objectIds: [],
        roomId: null
      },
      {
        act: () => store.getState().selectOpening(openingId),
        selection: { kind: "objects", ids: [openingId] },
        wallContextId: "wall-east",
        artworkId: null,
        openingId,
        objectIds: [openingId],
        roomId: null
      },
      {
        act: () => store.getState().selectObject(b.placementId),
        selection: { kind: "objects", ids: [b.placementId] },
        wallContextId: "wall-east",
        artworkId: b.artworkId,
        openingId: null,
        objectIds: [b.placementId],
        roomId: null
      },
      {
        act: () => store.getState().selectObject(a.placementId, { additive: true }),
        selection: { kind: "objects", ids: [b.placementId, a.placementId] },
        wallContextId: "wall-east",
        artworkId: null, // multi-select resolves to no single artwork
        openingId: null,
        objectIds: [b.placementId, a.placementId],
        roomId: null
      },
      {
        act: () => store.getState().selectRoom("room-main"),
        selection: { kind: "room", roomId: "room-main" },
        wallContextId: null,
        artworkId: null,
        openingId: null,
        objectIds: [],
        roomId: "room-main"
      },
      {
        act: () => store.getState().clearObjectSelection(),
        selection: NO_SELECTION,
        wallContextId: null,
        artworkId: null,
        openingId: null,
        objectIds: [],
        roomId: null
      }
    ];

    for (const expected of cases) {
      expected.act();
      const state = store.getState();
      expect(state.selection).toEqual(expected.selection);
      expect(state.wallContextId).toBe(expected.wallContextId);
      expect(objectIdsOf(state.selection)).toEqual(expected.objectIds);
      expect(roomIdOf(state.selection)).toBe(expected.roomId);
      expect(getSelectedArtworkId(state.project, state.selection)).toBe(expected.artworkId);
      expect(getSelectedOpeningId(state.project, state.selection)).toBe(expected.openingId);
    }
  });

  it("deleteRoom clears a selected dying opening but preserves dangling multi-select ids", async () => {
    // Preserve the tolerated dangling multi-select behavior after room deletion.
    await store.getState().addRectangleRoom();

    await store.getState().addOpening("room-2-wall-north", "door");
    const openingId = store.getState().project!.wallObjects.find(
      (object) => object.kind === "door"
    )!.id;
    store.getState().selectOpening(openingId);

    await store.getState().deleteRoom("room-2");

    let state = store.getState();
    expect(state.selection).toEqual(NO_SELECTION);
    expect(getSelectedOpeningId(state.project, state.selection)).toBeNull();
    expect(objectIdsOf(state.selection)).toEqual([]);

    await store.getState().undo(); // resurrect room-2 (and its door)
    const a = await addChecklistArtwork("dying-a.jpg");
    const b = await addChecklistArtwork("dying-b.jpg");
    await store.getState().placeArtwork(a, "room-2-wall-north", 500, 1450, true);
    const aPlacement = store.getState().project!.wallObjects.at(-1)!.id;
    await store.getState().placeArtwork(b, "room-2-wall-north", 1500, 1450, true);
    const bPlacement = store.getState().project!.wallObjects.at(-1)!.id;
    store.getState().setObjectSelection([aPlacement, bPlacement]);

    await store.getState().deleteRoom("room-2");

    state = store.getState();
    expect(
      state.project!.wallObjects.some(
        (object) => object.id === aPlacement || object.id === bPlacement
      )
    ).toBe(false);
    expect(state.selection).toEqual({ kind: "objects", ids: [aPlacement, bPlacement] });
    expect(objectIdsOf(state.selection)).toEqual([aPlacement, bPlacement]);
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

// Settle-matrix cases not covered in store.test.ts.
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
    expect(state.undoStack.at(-1)?.label).toBe("Move artwork");
  });
});
