// Placement slice: placing, moving, resizing and removing artwork, openings
// (doors/windows/blocked zones), display cases and wall text — the
// wall/floor object lifecycle owned by placementSlice.ts, including the
// shared-opening MIRRORING that addOpening/moveOpening/resizeOpening/
// updateDoorLeaf apply automatically across a shared boundary.
//
// The sharedOpeningSlice RESOLVER actions (resolveSharedOpening and friends)
// live in ./sharedOpeningSlice.test.ts. Cross-slice flows — boot/persist/
// recovery, updateArtwork's own record-edit-plus-rebake undo entry, arrange
// sessions, multi-select, and the "opening connections" tests that pose
// addOpening/moveOpening alongside a resolver action in the same test — stay
// in ../store.test.ts, the integration suite.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  DEFAULT_FLOOR_CASE_DEPTH_MM,
  DEFAULT_FLOOR_CASE_HEIGHT_MM,
  DEFAULT_FLOOR_CASE_WIDTH_MM,
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  DEFAULT_WALL_CASE_CENTER_Y_MM,
  DEFAULT_WALL_CASE_DEPTH_MM,
  DEFAULT_WALL_CASE_HEIGHT_MM,
  DEFAULT_WALL_CASE_WIDTH_MM,
  MONITOR_ASPECT_RATIO,
  DEFAULT_SHELF_DEPTH_MM,
  DEFAULT_SHELF_THICKNESS_MM,
  DEFAULT_SHELF_TOP_MM,
  DEFAULT_SHELF_WIDTH_MM,
  MONITOR_DEPTH_MM,
  MONITOR_PEDESTAL_HEIGHT_MM,
  SHELF_END_MARGIN_MM
} from "../../domain/project";
import type { Project, ShelfWallObject } from "../../domain/project";
import { shelfTopYMm } from "../../domain/geometry/shelfGlyphs";
import { createShelf } from "../../domain/placement/createShelf";
import { getShelfRiders } from "../../domain/placement/shelfRiders";
import { PLACEHOLDER_ARTWORK_WIDTH_MM } from "../../domain/placement/placeArtwork";
import { createRectangularRoomPlacement } from "../../domain/geometry/createRoom";
import { getFloorWalls } from "../../domain/geometry/planObjects";
import { evaluateOpeningPair } from "../../domain/geometry/openingConnections";
import { parseProject } from "../../domain/schema/projectSchema";
import { feetToMm } from "../../domain/units/length";
import { InMemoryProjectRepository, makeImageFile } from "../../test/inMemoryRepositories";
import { exportProjectJson } from "../../test/exportProjectJson";
import { createTestAppStore } from "../../test/testAppStore";
import { linkLegacyPair, sharedPairOnBoundary } from "../../test/storeFixtures";
import {
  createAppStore,
  FORBIDDEN_OVERLAP_MESSAGE,
  getSelectedArtworkId,
  getSelectedOpeningId,
  getSelectedWall
} from "../store";

// The shelf-removal notice speaks through sonner (the same channel store.ts's
// reportSupportRepairs uses), not the error banner; capture it without
// rendering a Toaster.
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn()
  }
}));

describe("placement slice", () => {
  let repository: InMemoryProjectRepository;
  let store: ReturnType<typeof createAppStore>;

  beforeEach(async () => {
    vi.mocked(toast.info).mockClear();
    const testStore = createTestAppStore();
    repository = testStore.projectRepository;
    store = testStore.store;
    await store.getState().boot();
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

      // The size passed in by the caller (plan/elevation/3D) may still be a
      // placeholder if the image aspect hadn't loaded when the drop resolved;
      // placeArtwork bakes the real size from the artwork's known dimensions,
      // so seating has to happen AFTER that bake, from the shelf the caller
      // says it seated on, not from the y the caller computed beforehand.
      it("re-seats onto the given shelf using the size baked during this call", async () => {
        await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 500, heightMm: 400, status: "known" }
        });
        const wallId = getSelectedWall(
          store.getState().project!,
          store.getState().wallContextId
        )!.id;

        const shelf = createShelf({ wallId, xMm: 1200, topMm: 1000 });
        const base = store.getState().project!;
        store.setState({
          project: { ...base, wallObjects: [...base.wallObjects, shelf] }
        });

        await store
          .getState()
          .placeArtwork(artworkId, wallId, 1200, 9999, false, { seatOnShelfId: shelf.id });

        const placement = store
          .getState()
          .project!.wallObjects.find((object) => object.kind === "artwork")!;
        expect(placement.yMm - placement.heightMm / 2).toBe(1000);
      });

      // The framed OUTER bottom is what stands on the slab, so a framed work
      // dropped onto a shelf sits one band (mat + frame) higher than its image
      // box alone would put it — which is also the only y that makes it a rider.
      it("stands a framed work's OUTER bottom on the shelf it was seated on", async () => {
        await store.getState().addArtworksFromFiles([makeImageFile("framed-seat.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 500, heightMm: 400, status: "known" },
          matWidthMm: 50,
          frame: { widthMm: 25, finish: "black" }
        });
        const wallId = getSelectedWall(
          store.getState().project!,
          store.getState().wallContextId
        )!.id;

        const shelf = createShelf({ wallId, xMm: 1200, topMm: 1000 });
        const base = store.getState().project!;
        store.setState({
          project: { ...base, wallObjects: [...base.wallObjects, shelf] }
        });

        await store
          .getState()
          .placeArtwork(artworkId, wallId, 1200, 9999, false, { seatOnShelfId: shelf.id });

        const state = store.getState();
        const placement = state.project!.wallObjects.find(
          (object) => object.kind === "artwork"
        )!;
        // Stored box is still the image (400 tall), but its centre sits half
        // the OUTER height (550/2) above the top face.
        expect(placement.heightMm).toBe(400);
        expect(placement.yMm - (400 + 2 * 75) / 2).toBe(1000);
        const artworksById = new Map(
          state.libraryArtworks.map((artwork) => [artwork.id, artwork])
        );
        expect(
          getShelfRiders(shelf, state.project!.wallObjects, artworksById).map(
            (rider) => rider.id
          )
        ).toEqual([placement.id]);
      });

      it("stores image dimensions for a framed placement", async () => {
        await store.getState().addArtworksFromFiles([makeImageFile("framed.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 400, heightMm: 300, status: "known" },
          matWidthMm: 75,
          frame: { widthMm: 25, finish: "black" }
        });
        const wallId = getSelectedWall(
          store.getState().project!,
          store.getState().wallContextId
        )!.id;

        await store.getState().placeArtwork(artworkId, wallId, 1200, 1450);

        expect(store.getState().project!.wallObjects[0]).toMatchObject({
          widthMm: 400,
          heightMm: 300
        });
      });

      it("sizes an unknown-dims artwork from its image within the placeholder box", async () => {
        await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        const wallId = getSelectedWall(
          store.getState().project!,
          store.getState().wallContextId
        )!.id;

        await store.getState().placeArtwork(artworkId, wallId, 0, 1450);

        const placement = store.getState().project!.wallObjects[0];
        expect(placement.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
        expect(placement.heightMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
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

      it("makes the wall it was dropped on the elevation view's wall context", async () => {
        await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        // Point the wall context at a DIFFERENT wall than the one we're about
        // to place on, the way it would be left after browsing elsewhere.
        store.getState().focusWallContext("wall-north");
        expect(store.getState().wallContextId).toBe("wall-north");

        await store.getState().placeArtwork(artworkId, "wall-east", 1000, 1450);

        const state = store.getState();
        const placement = state.project!.wallObjects[0];
        expect(state.wallContextId).toBe("wall-east");
        expect(state.selection).toEqual({ kind: "objects", ids: [placement.id] });
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

    // The 3D pointer drag's commit: both wall axes AND a possible wall change, in
    // one undo entry.
    describe("moveWallObjectPlacement", () => {
      async function placeOnFirstWall() {
        await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        const wallId = getSelectedWall(
          store.getState().project!,
          store.getState().wallContextId
        )!.id;
        await store.getState().placeArtwork(artworkId, wallId, 1000, 1450);
        return {
          wallId,
          placementId: store.getState().project!.wallObjects[0].id
        };
      }

      it("moves in both wall axes on the same wall, in one undo entry", async () => {
        const { wallId, placementId } = await placeOnFirstWall();
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().moveWallObjectPlacement(placementId, wallId, 2000, 1600);

        let state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        expect(state.project!.wallObjects[0]).toMatchObject({
          wallId,
          xMm: 2000,
          yMm: 1600
        });

        await store.getState().undo();
        expect(store.getState().project!.wallObjects[0]).toMatchObject({
          wallId,
          xMm: 1000,
          yMm: 1450
        });
      });

      it("re-anchors onto another wall and carries the new hang height", async () => {
        const { wallId, placementId } = await placeOnFirstWall();
        const otherWall = store
          .getState()
          .project!.floor.rooms[0].room.walls.find((wall) => wall.id !== wallId)!;
        const undoStackBefore = store.getState().undoStack.length;

        await store
          .getState()
          .moveWallObjectPlacement(placementId, otherWall.id, 800, 1700);

        const state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        expect(state.project!.wallObjects[0]).toMatchObject({
          wallId: otherWall.id,
          xMm: 800,
          yMm: 1700
        });
      });

      it("is a no-op when nothing changed — a click must not push an undo entry", async () => {
        const { wallId, placementId } = await placeOnFirstWall();
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().moveWallObjectPlacement(placementId, wallId, 1000, 1450);

        expect(store.getState().undoStack).toHaveLength(undoStackBefore);
      });

      it("moves the height alone when only yMm changed", async () => {
        const { wallId, placementId } = await placeOnFirstWall();

        await store.getState().moveWallObjectPlacement(placementId, wallId, 1000, 1900);

        expect(store.getState().project!.wallObjects[0]).toMatchObject({
          xMm: 1000,
          yMm: 1900
        });
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

      it("adds a wall display case centered on the wall at the default mount height", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

        await store.getState().addWallCase(wall.id);

        const state = store.getState();
        expect(state.undoStack.at(-1)?.label).toBe("Add display case");
        const wallCase = state.project!.wallObjects[0];
        expect(wallCase.kind).toBe("case");
        expect(wallCase.wallId).toBe(wall.id);
        expect(wallCase.xMm).toBeCloseTo(wall.lengthMm / 2);
        expect(wallCase.yMm).toBe(DEFAULT_WALL_CASE_CENTER_Y_MM);
        expect(state.selection).toEqual(
          expect.objectContaining({ kind: "objects", ids: [wallCase.id] })
        );
      });

      it("adds an elevation-placed opening at the requested wall-local position", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

        await store.getState().placeOpeningOnElevation("window", wall.id, 1800, 1650);

        const state = store.getState();
        const opening = state.project!.wallObjects[0];
        expect(opening.kind).toBe("window");
        expect(opening.xMm).toBe(1800);
        expect(opening.yMm).toBe(1650);
        expect(state.undoStack.at(-1)?.label).toBe("Add window");
      });

      it("pins an elevation-placed door to the floorline (yMm = heightMm/2) regardless of pointer y", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

        await store.getState().placeOpeningOnElevation("door", wall.id, 1800, 1650);

        const state = store.getState();
        const door = state.project!.wallObjects[0];
        expect(door.kind).toBe("door");
        expect(door.xMm).toBe(1800);
        expect(door.heightMm).toBe(2030);
        expect(door.yMm).toBe(1015);
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

      it("clamps a door to the floorline (yMm = heightMm/2) and ignores vertical drag requests", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().addOpening(wall.id, "door");
        const door = store.getState().project!.wallObjects[0];
        const originalYMm = door.yMm;
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().moveOpening(door.id, door.xMm + 500, 1500);

        let state = store.getState();
        let movedDoor = state.project!.wallObjects[0];
        expect(movedDoor.xMm).toBe(door.xMm + 500);
        expect(movedDoor.yMm).toBe(1015);
        expect(movedDoor.yMm).toBe(movedDoor.heightMm / 2);
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);

        await store.getState().undo();
        state = store.getState();
        movedDoor = state.project!.wallObjects[0];
        expect(movedDoor.xMm).toBe(door.xMm);
        expect(movedDoor.yMm).toBe(originalYMm);
      });

      it("allows windows to move vertically while doors stay on the floorline", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().addOpening(wall.id, "window");
        const window = store.getState().project!.wallObjects[0];

        await store.getState().moveOpening(window.id, window.xMm, 1500);

        let state = store.getState();
        let movedWindow = state.project!.wallObjects[0];
        expect(movedWindow.yMm).toBe(1500);
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

      it("recomputes a door's yMm to keep its bottom on the floorline when height changes", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().addOpening(wall.id, "door");
        const door = store.getState().project!.wallObjects[0];
        const originalYMm = door.yMm; // Should be 2030/2 = 1015
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().resizeOpening(door.id, 915, 1800);

        let state = store.getState();
        let resizedDoor = state.project!.wallObjects[0];
        expect(resizedDoor.heightMm).toBe(1800);
        expect(resizedDoor.yMm).toBe(900); // 1800 / 2
        expect(resizedDoor.yMm).toBe(resizedDoor.heightMm / 2);
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);

        await store.getState().undo();
        state = store.getState();
        resizedDoor = state.project!.wallObjects[0];
        expect(resizedDoor.heightMm).toBe(2030);
        expect(resizedDoor.yMm).toBe(originalYMm);
      });

      it("does not recompute window yMm when resizing height", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().addOpening(wall.id, "window");
        const window = store.getState().project!.wallObjects[0];
        const originalYMm = window.yMm;

        await store.getState().resizeOpening(window.id, 1500, 1000);

        let state = store.getState();
        let resizedWindow = state.project!.wallObjects[0];
        expect(resizedWindow.heightMm).toBe(1000);
        expect(resizedWindow.yMm).toBe(originalYMm); // Unchanged
      });

      // Making a door nearly as wide as its wall used to mean hand-coordinating
      // Width and X, with any overshoot committing geometry that hung off the wall.
      describe("fitting a requested width onto the wall", () => {
        async function doorOnWall(wallLengthMm: number, widthMm: number, xMm: number) {
          const wallId = getSelectedWall(
            store.getState().project!,
            store.getState().wallContextId
          )!.id;
          await store.getState().resizeWall(wallId, wallLengthMm);
          await store.getState().addOpening(wallId, "door");
          const door = store.getState().project!.wallObjects[0];
          await store.getState().resizeOpening(door.id, widthMm, door.heightMm);
          await store.getState().moveOpening(door.id, xMm, door.yMm);
          return { wallId, doorId: door.id, heightMm: door.heightMm };
        }

        const doorNow = (id: string) =>
          store.getState().project!.wallObjects.find((object) => object.id === id)!;

        it("keeps a width that fits and slides the door the minimum distance", async () => {
          // 12' wall, 3' door at 3'; ask for 11'.
          const { doorId, heightMm } = await doorOnWall(feetToMm(12), feetToMm(3), feetToMm(3));

          const fit = await store.getState().resizeOpening(doorId, feetToMm(11), heightMm);

          const door = doorNow(doorId);
          expect(door.widthMm).toBe(feetToMm(11));
          // Legal range is [5'6", 6'6"] — the nearest point to 3' is 5'6",
          // NOT the tidier 6' centre.
          expect(door.xMm).toBeCloseTo(feetToMm(5.5), 6);
          expect(fit?.widthClamped).toBe(false);
          expect(fit?.positionAdjusted).toBe(true);
          expect(store.getState().error).toBeNull();
        });

        it("clamps to the widest that fits when the request cannot fit at all", async () => {
          const { doorId, heightMm } = await doorOnWall(feetToMm(12), feetToMm(3), feetToMm(3));

          const fit = await store.getState().resizeOpening(doorId, feetToMm(14), heightMm);

          const door = doorNow(doorId);
          expect(door.widthMm).toBe(feetToMm(12));
          expect(door.xMm).toBeCloseTo(feetToMm(6), 6);
          expect(fit?.widthClamped).toBe(true);
          expect(fit?.requestedWidthMm).toBe(feetToMm(14));
        });

        it("accepts a door exactly as wide as its wall", async () => {
          const { doorId, heightMm } = await doorOnWall(feetToMm(12), feetToMm(3), feetToMm(3));

          const fit = await store.getState().resizeOpening(doorId, feetToMm(12), heightMm);

          expect(fit?.widthClamped).toBe(false);
          expect(doorNow(doorId).widthMm).toBe(feetToMm(12));
          expect(store.getState().error).toBeNull();
        });

        it("commits the new width and position as a single undo entry", async () => {
          const { doorId, heightMm } = await doorOnWall(feetToMm(12), feetToMm(3), feetToMm(3));
          const undoBefore = store.getState().undoStack.length;

          await store.getState().resizeOpening(doorId, feetToMm(11), heightMm);

          expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
          await store.getState().undo();
          const door = doorNow(doorId);
          expect(door.widthMm).toBe(feetToMm(3));
          expect(door.xMm).toBeCloseTo(feetToMm(3), 6);
        });

        it("re-requesting an impossible width reports the limit without stacking undo entries", async () => {
          const { doorId, heightMm } = await doorOnWall(feetToMm(12), feetToMm(3), feetToMm(3));
          await store.getState().resizeOpening(doorId, feetToMm(14), heightMm);
          const undoAfterFirst = store.getState().undoStack.length;

          const fit = await store.getState().resizeOpening(doorId, feetToMm(14), heightMm);

          // Still explains itself, but the document did not change.
          expect(fit?.widthClamped).toBe(true);
          expect(fit?.widthMm).toBe(feetToMm(12));
          expect(store.getState().undoStack).toHaveLength(undoAfterFirst);
        });

        it("stops at a neighbouring opening rather than widening through it", async () => {
          const { wallId, doorId, heightMm } = await doorOnWall(
            feetToMm(12),
            feetToMm(3),
            feetToMm(2)
          );
          // A second door occupying 9'–10'.
          await store.getState().addOpening(wallId, "door");
          const other = store.getState().project!.wallObjects.find((o) => o.id !== doorId)!;
          await store.getState().resizeOpening(other.id, feetToMm(1), other.heightMm);
          await store.getState().moveOpening(other.id, feetToMm(9.5), other.yMm);

          const fit = await store.getState().resizeOpening(doorId, feetToMm(11), heightMm);

          const door = doorNow(doorId);
          // The free run is 0'–9'; the door fills it and stops flush.
          expect(door.widthMm).toBeCloseTo(feetToMm(9), 6);
          expect(door.xMm + door.widthMm / 2).toBeCloseTo(feetToMm(9), 6);
          expect(fit?.constraint).toBe("neighbor");
          // Flush contact is not a collision, so nothing was blocked.
          expect(store.getState().error).toBeNull();
        });

        it("fitOpeningToAvailableSpan fills the run the door is already in, without relocating it", async () => {
          const { wallId, doorId } = await doorOnWall(feetToMm(12), feetToMm(2), feetToMm(2));
          // A second door at 9'–10' leaves a 0'–9' run around the first door and
          // a smaller 10'–12' run beyond it.
          await store.getState().addOpening(wallId, "door");
          const other = store.getState().project!.wallObjects.find((o) => o.id !== doorId)!;
          await store.getState().resizeOpening(other.id, feetToMm(1), other.heightMm);
          await store.getState().moveOpening(other.id, feetToMm(9.5), other.yMm);

          await store.getState().fitOpeningToAvailableSpan(doorId);

          const door = doorNow(doorId);
          expect(door.widthMm).toBeCloseTo(feetToMm(9), 6);
          expect(door.xMm).toBeCloseTo(feetToMm(4.5), 6);
          expect(store.getState().error).toBeNull();
        });

        it("keeps a typed X on the wall instead of committing an off-wall door", async () => {
          const { doorId } = await doorOnWall(feetToMm(12), feetToMm(3), feetToMm(3));
          const before = doorNow(doorId);

          const fit = await store.getState().moveOpening(doorId, feetToMm(50), before.yMm);

          const door = doorNow(doorId);
          expect(door.xMm).toBeCloseTo(feetToMm(12) - feetToMm(1.5), 6);
          // A move never resizes.
          expect(door.widthMm).toBe(feetToMm(3));
          expect(fit?.widthClamped).toBe(false);
          expect(fit?.positionAdjusted).toBe(true);
        });
      });
    });

    describe("hinged handing", () => {
      function leafOfId(openingId: string) {
        const object = store
          .getState()
          .project!.wallObjects.find((candidate) => candidate.id === openingId);
        return object?.kind === "door" ? object.leaf : undefined;
      }

      it("mirrors BOTH flags onto the far half of a real shared boundary", async () => {
        const { primaryId, twinId } = await sharedPairOnBoundary(store);

        await store.getState().updateDoorLeaf(primaryId, {
          hingeAtStart: true,
          swingsToLeft: true
        });

        // Twin walls are anti-parallel AND face opposite interiors, so both
        // flags invert — which is what leaves the leaf in the same physical
        // quadrant seen from either room.
        expect(leafOfId(primaryId)).toEqual({ hingeAtStart: true, swingsToLeft: true });
        expect(leafOfId(twinId)).toEqual({ hingeAtStart: false, swingsToLeft: false });
        // One undo step covers both halves.
        expect(store.getState().undoStack.at(-1)?.label).toBe("Edit door");
        await store.getState().undo();
        expect(leafOfId(primaryId)).toBeUndefined();
        expect(leafOfId(twinId)).toBeUndefined();
      });

      it("clears the far half when the near half goes back to a doorway", async () => {
        const { primaryId, twinId } = await sharedPairOnBoundary(store);
        await store.getState().updateDoorLeaf(primaryId, {});

        await store.getState().updateDoorLeaf(primaryId, undefined);

        expect(leafOfId(twinId)).toBeUndefined();
      });

      it("leaves a legacy pair on unrelated walls INDEPENDENT", async () => {
        // connectsToObjectId does not imply the walls face each other, so these
        // two halves are not one physical door and have no shared handing —
        // the same carve-out the position mirror makes.
        await store.getState().addOpening("wall-north", "door");
        const doorA = store.getState().project!.wallObjects[0];
        await store.getState().addOpening("wall-south", "door");
        const doorB = store
          .getState()
          .project!.wallObjects.find((object) => object.id !== doorA.id)!;
        linkLegacyPair(store, doorA.id, doorB.id);

        await store.getState().updateDoorLeaf(doorA.id, {});

        expect(leafOfId(doorA.id)).not.toBeUndefined();
        expect(leafOfId(doorB.id)).toBeUndefined();
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

      it.each(["door", "window"] as const)(
        "full-syncs a paired deletion: removing one paired %s removes its twin in one undo step",
        async (kind) => {
          // Paired openings must disappear together in one undoable commit.
          await store.getState().addOpening("wall-north", kind);
          const openingA = store.getState().project!.wallObjects[0];
          await store.getState().addOpening("wall-south", kind);
          const openingB = store
            .getState()
            .project!.wallObjects.find((wallObject) => wallObject.id !== openingA.id)!;
          linkLegacyPair(store, openingA.id, openingB.id);
          const undoStackBefore = store.getState().undoStack.length;

          await store.getState().removePlacement(openingB.id);

          expect(store.getState().project!.wallObjects).toHaveLength(0);
          expect(store.getState().undoStack).toHaveLength(undoStackBefore + 1);

          await store.getState().undo();
          const restored = store.getState().project!.wallObjects;
          expect(restored).toHaveLength(2);
          const restoredA = restored.find((object) => object.id === openingA.id)!;
          const restoredB = restored.find((object) => object.id === openingB.id)!;
          expect(
            restoredA.kind === "door" || restoredA.kind === "window"
              ? restoredA.connectsToObjectId
              : undefined
          ).toBe(openingB.id);
          expect(
            restoredB.kind === "door" || restoredB.kind === "window"
              ? restoredB.connectsToObjectId
              : undefined
          ).toBe(openingA.id);
        }
      );
    });

    describe("shared wall opening mirroring", () => {
      // Coincident anti-parallel walls mirror opening x as 3000 - x.
      const A_EAST = "room-a-wall-east";
      const B_WEST = "room-b-wall-west";
      const DOOR_Y_MM = 1015; // door center = height/2 (2030/2), the placement default.

      function setupSharedWallRooms(): void {
        const base = store.getState().project!;
        const shared: Project = {
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
        store.setState({ project: shared });
      }

      const onWall = (wallId: string) =>
        store.getState().project!.wallObjects.find((object) => object.wallId === wallId)!;
      const partnerOf = (object: { id: string; connectsToObjectId?: string }) =>
        object.connectsToObjectId;

      it("creates a twin with symmetric pointers in one undo step, selecting only the primary", async () => {
        setupSharedWallRooms();
        const undoBefore = store.getState().undoStack.length;

        await store.getState().addOpening(A_EAST, "door");

        const objects = store.getState().project!.wallObjects;
        expect(objects).toHaveLength(2);
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);
        expect(primary.kind).toBe("door");
        expect(twin.kind).toBe("door");
        expect(partnerOf(primary)).toBe(twin.id);
        expect(partnerOf(twin)).toBe(primary.id);
        expect(twin.xMm).toBeCloseTo(1500);
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
        expect(
          getSelectedOpeningId(store.getState().project, store.getState().selection)
        ).toBe(primary.id);

        await store.getState().undo();
        expect(store.getState().project!.wallObjects).toHaveLength(0);
      });

      it("connects to an existing alignable opening on the twin wall instead of duplicating", async () => {
        setupSharedWallRooms();
        const base = store.getState().project!;
        store.setState({
          project: {
            ...base,
            wallObjects: [
              {
                id: "existing-door",
                kind: "door",
                blocksPlacement: true,
                wallId: B_WEST,
                xMm: 1500,
                yMm: DOOR_Y_MM,
                widthMm: 915,
                heightMm: 2030
              }
            ]
          }
        });

        await store.getState().addOpening(A_EAST, "door");

        const objects = store.getState().project!.wallObjects;
        expect(objects).toHaveLength(2);
        const primary = onWall(A_EAST);
        const existing = objects.find((object) => object.id === "existing-door")!;
        expect(partnerOf(primary)).toBe("existing-door");
        expect(partnerOf(existing)).toBe(primary.id);
      });

      it("drags the twin on a move so the pair stays aligned, in one undo step", async () => {
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().moveOpening(primary.id, 800, primary.yMm);

        const movedPrimary = store
          .getState()
          .project!.wallObjects.find((object) => object.id === primary.id)!;
        const movedTwin = store
          .getState()
          .project!.wallObjects.find((object) => object.id === twin.id)!;
        expect(movedPrimary.xMm).toBe(800);
        expect(movedTwin.xMm).toBeCloseTo(2200);
        expect(movedTwin.yMm).toBe(primary.yMm);
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
        expect(
          evaluateOpeningPair(store.getState().project!, movedPrimary.id, movedTwin.id).status
        ).toBe("aligned");
      });

      // Was "leaves the twin put when a move's mirrored slot would collide (pair
      // goes misaligned)": the move landed, the twin stayed, and one physical
      // opening silently became two facing alcoves. A live shared pair either
      // moves as one opening or the edit fails.
      it("refuses a move whose mirrored slot would collide, leaving both halves put", async () => {
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);

        // Block only the twin's proposed mirrored destination.
        const base = store.getState().project!;
        store.setState({
          project: {
            ...base,
            wallObjects: [
              ...base.wallObjects,
              {
                id: "blocker",
                kind: "door",
                blocksPlacement: true,
                wallId: B_WEST,
                xMm: 800,
                yMm: DOOR_Y_MM,
                widthMm: 300,
                heightMm: 2030
              }
            ]
          }
        });
        const undoBefore = store.getState().undoStack.length;

        const fit = await store.getState().moveOpening(primary.id, 2200, primary.yMm);

        const state = store.getState();
        const keptPrimary = state.project!.wallObjects.find((object) => object.id === primary.id)!;
        const keptTwin = state.project!.wallObjects.find((object) => object.id === twin.id)!;
        // Nothing moved, nothing to undo, and the user is told why.
        expect(keptPrimary.xMm).toBeCloseTo(1500);
        expect(keptTwin.xMm).toBeCloseTo(1500);
        expect(state.undoStack).toHaveLength(undoBefore);
        expect(state.error).toMatch(/shared with the room next door/i);
        // Reported the same way noMutualSpan is, so the inspector can explain it.
        expect(fit?.partnerBlocked).toBe(true);
        // Above all: the pair is still one opening.
        expect(evaluateOpeningPair(state.project!, primary.id, twin.id).status).toBe("aligned");
      });

      it("refuses a resize whose mirrored footprint would collide on the facing wall", async () => {
        // Normally unreachable: resolvePairedOpeningSpan folds BOTH faces' free
        // runs into one interval, so a solved resize already clears the twin's
        // neighbours. It becomes reachable on legacy geometry — an opening that
        // already overlaps a neighbour makes getOpeningLegalSpan fall back to the
        // bare wall, and the solved span then knows nothing about the blocker.
        // The guard is what stops that resizing one face onto another opening.
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);

        const base = store.getState().project!;
        store.setState({
          project: {
            ...base,
            wallObjects: [
              ...base.wallObjects,
              {
                id: "blocker",
                kind: "blocked-zone",
                blocksPlacement: true,
                wallId: B_WEST,
                xMm: twin.xMm,
                yMm: DOOR_Y_MM,
                widthMm: 400,
                heightMm: 2030
              }
            ]
          }
        });
        const undoBefore = store.getState().undoStack.length;

        const fit = await store.getState().resizeOpening(primary.id, 3000, 2030);

        const state = store.getState();
        expect(state.project!.wallObjects.find((o) => o.id === primary.id)!.widthMm).toBe(915);
        expect(state.project!.wallObjects.find((o) => o.id === twin.id)!.widthMm).toBe(915);
        expect(state.undoStack).toHaveLength(undoBefore);
        expect(fit?.partnerBlocked).toBe(true);
        expect(state.error).toMatch(/shared with the room next door/i);
      });

      it("propagates that refusal through Fit wall rather than swallowing it", async () => {
        // fitOpeningToAvailableSpan delegates to resizeOpening, so the refusal
        // has to travel back out instead of being reported as a committed fit.
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);

        const base = store.getState().project!;
        store.setState({
          project: {
            ...base,
            wallObjects: [
              ...base.wallObjects,
              {
                id: "blocker",
                kind: "blocked-zone",
                blocksPlacement: true,
                wallId: B_WEST,
                xMm: twin.xMm,
                yMm: DOOR_Y_MM,
                widthMm: 400,
                heightMm: 2030
              }
            ]
          }
        });
        const undoBefore = store.getState().undoStack.length;

        const fit = await store.getState().fitOpeningToAvailableSpan(primary.id);

        expect(fit?.partnerBlocked).toBe(true);
        expect(store.getState().project!.wallObjects.find((o) => o.id === primary.id)!.widthMm).toBe(
          915
        );
        expect(store.getState().undoStack).toHaveLength(undoBefore);
      });

      it("moves the target alone when the partner's wall has vanished", async () => {
        // A missing wall is a broken document, not a user error: refusing here
        // would wedge the opening with no way to edit it back into shape.
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);

        const base = store.getState().project!;
        store.setState({
          project: {
            ...base,
            wallObjects: base.wallObjects.map((object) =>
              object.id === twin.id ? { ...object, wallId: "wall-that-vanished" } : object
            )
          }
        });
        const undoBefore = store.getState().undoStack.length;

        await store.getState().moveOpening(primary.id, 800, primary.yMm);

        const state = store.getState();
        expect(state.project!.wallObjects.find((o) => o.id === primary.id)!.xMm).toBe(800);
        expect(state.project!.wallObjects.find((o) => o.id === twin.id)!.xMm).toBeCloseTo(1500);
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        expect(state.error).toBeNull();
      });

      it("drags the twin when a plan drag moves one half of a shared pair", async () => {
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().commitPlanMove(primary.id, {
          anchor: "wall",
          wallId: A_EAST,
          xMm: 800
        });

        const state = store.getState();
        const movedPrimary = state.project!.wallObjects.find((o) => o.id === primary.id)!;
        const movedTwin = state.project!.wallObjects.find((o) => o.id === twin.id)!;
        expect(movedPrimary.xMm).toBe(800);
        expect(movedTwin.xMm).toBeCloseTo(2200);
        // One drag, one undo step, still one opening.
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        expect(partnerOf(movedTwin)).toBe(primary.id);
        expect(evaluateOpeningPair(state.project!, primary.id, twin.id).status).toBe("aligned");
      });

      // The shared-pair counterpart of "disconnects a pair when one half is moved
      // onto its partner's wall": for a LIVE shared pair there is nothing to
      // disconnect — one physical opening cannot have both faces in one room —
      // so the drag is refused instead of being laundered into a severed pair.
      it("refuses a plan drag of one half onto its partner's own wall", async () => {
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().commitPlanMove(primary.id, {
          anchor: "wall",
          wallId: B_WEST,
          xMm: 1500
        });

        const state = store.getState();
        const keptPrimary = state.project!.wallObjects.find((o) => o.id === primary.id)!;
        expect(keptPrimary.wallId).toBe(A_EAST);
        expect(partnerOf(keptPrimary)).toBe(twin.id);
        expect(state.undoStack).toHaveLength(undoBefore);
        expect(state.error).toMatch(/shared with the room next door/i);
        expect(state.saveState).toBe("saved");
      });

      it("refuses a plan drag that re-anchors one half onto another wall", async () => {
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().commitPlanMove(primary.id, {
          anchor: "wall",
          wallId: "room-a-wall-north",
          xMm: 1500
        });

        const state = store.getState();
        const keptPrimary = state.project!.wallObjects.find((o) => o.id === primary.id)!;
        // The half stays on its own wall rather than being severed from its twin.
        expect(keptPrimary.wallId).toBe(A_EAST);
        expect(partnerOf(keptPrimary)).toBeDefined();
        expect(state.undoStack).toHaveLength(undoBefore);
        expect(state.error).toMatch(/shared with the room next door/i);
      });

      it("drags the twin when an elevation group move includes only one half", async () => {
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);

        await store
          .getState()
          .moveWallObjectsGroup([{ id: primary.id, xMm: 800, yMm: primary.yMm }]);

        const objects = store.getState().project!.wallObjects;
        expect(objects.find((o) => o.id === primary.id)!.xMm).toBe(800);
        expect(objects.find((o) => o.id === twin.id)!.xMm).toBeCloseTo(2200);
      });

      describe("group moves of a shared pair", () => {
        it("drags the twin when only one half is in the batch", async () => {
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);
          const twin = onWall(B_WEST);

          await store.getState().movePlanObjectsGroup([{ id: primary.id, xMm: 800 }]);

          const objects = store.getState().project!.wallObjects;
          expect(objects.find((o) => o.id === primary.id)!.xMm).toBe(800);
          expect(objects.find((o) => o.id === twin.id)!.xMm).toBeCloseTo(2200);
          expect(store.getState().error).toBeNull();
        });

        it("commits a batch that moves both halves in step", async () => {
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);
          const twin = onWall(B_WEST);

          // The two faces run in opposite directions, so a group drag of the pair
          // sends them to mirrored local positions.
          await store.getState().movePlanObjectsGroup([
            { id: primary.id, xMm: 800 },
            { id: twin.id, xMm: 2200 }
          ]);

          const state = store.getState();
          expect(state.project!.wallObjects.find((o) => o.id === primary.id)!.xMm).toBe(800);
          expect(state.project!.wallObjects.find((o) => o.id === twin.id)!.xMm).toBe(2200);
          expect(state.error).toBeNull();
          expect(evaluateOpeningPair(state.project!, primary.id, twin.id).status).toBe("aligned");
        });

        it("refuses a batch that would leave the two halves out of step", async () => {
          // "Both halves moved" is not on its own proof the pair survived: this
          // batch would leave one opening reading as two.
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);
          const twin = onWall(B_WEST);
          const undoBefore = store.getState().undoStack.length;

          await store.getState().movePlanObjectsGroup([
            { id: primary.id, xMm: 800 },
            { id: twin.id, xMm: 2900 }
          ]);

          const state = store.getState();
          expect(state.project!.wallObjects.find((o) => o.id === primary.id)!.xMm).toBeCloseTo(1500);
          expect(state.project!.wallObjects.find((o) => o.id === twin.id)!.xMm).toBeCloseTo(1500);
          expect(state.undoStack).toHaveLength(undoBefore);
          expect(state.error).toBeTruthy();
        });
      });

      // Two rooms that meet over only PART of one wall's run: room B is shallower
      // than room A, so room A's east wall is shared for its first 2000mm and
      // exterior beyond that. Local x on the east wall is the floor y coordinate,
      // and the facing west wall runs the other way (x -> 2000 - x).
      describe("a wall shared over only part of its run", () => {
        function setupPartialSharedWallRooms(): void {
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
                  }),
                  createRectangularRoomPlacement({
                    roomId: "room-b",
                    name: "Room B",
                    widthMm: 4000,
                    depthMm: 2000,
                    heightMm: 2500,
                    offsetXMm: 4000,
                    offsetYMm: 0
                  })
                ]
              }
            }
          });
        }

        it("refuses a move that would carry the pair past the run the rooms share", async () => {
          setupPartialSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);
          const twin = onWall(B_WEST);
          expect(primary.xMm).toBeCloseTo(1500);
          expect(twin.xMm).toBeCloseTo(500);
          const undoBefore = store.getState().undoStack.length;

          // 2500 is comfortably on room A's own 3000mm wall, but past the 2000mm
          // the two rooms actually share — the twin would have no wall to sit on.
          const fit = await store.getState().moveOpening(primary.id, 2500, primary.yMm);

          const state = store.getState();
          expect(state.project!.wallObjects.find((o) => o.id === primary.id)!.xMm).toBeCloseTo(1500);
          expect(state.project!.wallObjects.find((o) => o.id === twin.id)!.xMm).toBeCloseTo(500);
          expect(state.undoStack).toHaveLength(undoBefore);
          expect(fit?.partnerBlocked).toBe(true);
          expect(state.error).toMatch(/wall the two rooms share/i);
        });

        it("refuses the same drag from the plan", async () => {
          setupPartialSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);
          const undoBefore = store.getState().undoStack.length;

          await store.getState().commitPlanMove(primary.id, {
            anchor: "wall",
            wallId: A_EAST,
            xMm: 2500
          });

          const state = store.getState();
          expect(state.project!.wallObjects.find((o) => o.id === primary.id)!.xMm).toBeCloseTo(1500);
          expect(state.undoStack).toHaveLength(undoBefore);
          expect(state.error).toMatch(/wall the two rooms share/i);
        });

        it("still allows a move that stays inside the shared run", async () => {
          setupPartialSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);
          const twin = onWall(B_WEST);

          await store.getState().moveOpening(primary.id, 1000, primary.yMm);

          const objects = store.getState().project!.wallObjects;
          expect(objects.find((o) => o.id === primary.id)!.xMm).toBe(1000);
          expect(objects.find((o) => o.id === twin.id)!.xMm).toBeCloseTo(1000);
          expect(store.getState().error).toBeNull();
        });
      });

      it("mirrors a resize onto the twin in one undo step", async () => {
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);
        const twin = onWall(B_WEST);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().resizeOpening(primary.id, 1000, 1800);

        const resizedTwin = store
          .getState()
          .project!.wallObjects.find((object) => object.id === twin.id)!;
        expect(resizedTwin.widthMm).toBe(1000);
        expect(resizedTwin.heightMm).toBe(1800);
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
      });

      it("removing a room only disconnects the neighbor's opening, never deletes it", async () => {
        setupSharedWallRooms();
        await store.getState().addOpening(A_EAST, "door");
        const primary = onWall(A_EAST);

        await store.getState().deleteRoom("room-b");

        const objects = store.getState().project!.wallObjects;
        // Deleting one room leaves the surviving opening disconnected.
        expect(objects).toHaveLength(1);
        const survivor = objects[0];
        expect(survivor.id).toBe(primary.id);
        expect(survivor.wallId).toBe(A_EAST);
        expect(partnerOf(survivor)).toBeUndefined();
      });

      // A pair is ONE physical hole through ONE wall, so a resize is solved once
      // against the run both faces share. Fitting each face independently would
      // let the two halves settle at locally valid but physically different
      // centres — a shared opening visibly offset between the two rooms.
      describe("group moves of a shared pair", () => {
        it("refuses a batch that leaves the halves slightly out of step", async () => {
          // The certification for a both-halves batch has to be an EXACT mirror
          // check, not evaluateOpeningPair: that predicate exists to infer whether
          // two independent openings read as a passage, so it accepts roughly half
          // a door of offset. A pair left 200 mm out of step is not one opening.
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const a = onWall(A_EAST);
          const b = onWall(B_WEST);
          const undoBefore = store.getState().undoStack.length;

          await store.getState().movePlanObjectsGroup([
            { id: a.id, xMm: 1200, wallId: A_EAST },
            // Mirrored would be 1800; 1700 is well inside evaluateOpeningPair's
            // tolerance and well outside the 1 mm mirror tolerance.
            { id: b.id, xMm: 1700, wallId: B_WEST }
          ]);

          const state = store.getState();
          expect(state.undoStack).toHaveLength(undoBefore);
          expect(state.project!.wallObjects.find((object) => object.id === a.id)!.xMm).toBe(a.xMm);
          expect(state.project!.wallObjects.find((object) => object.id === b.id)!.xMm).toBe(b.xMm);
          expect(state.error).toBeTruthy();
        });

        it("accepts a batch that moves the blocker out of the twin's destination", async () => {
          // Occupancy has to be read from the COMPLETED draft. Judging the twin's
          // destination against the pre-edit project refuses a transaction whose
          // own finished state is perfectly legal.
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const a = onWall(A_EAST);
          const b = onWall(B_WEST);
          // A blocked zone parked exactly where the twin will need to land: the
          // door starts centred at 1500, so sliding it to 500 sends the twin to
          // 2500. The zone sits there first, clear of the twin's current spot.
          await store.getState().addOpening(B_WEST, "blocked-zone");
          const zone = store
            .getState()
            .project!.wallObjects.find((object) => object.kind === "blocked-zone")!;
          await store.getState().moveOpening(zone.id, 2500, zone.yMm);
          expect(
            store.getState().project!.wallObjects.find((object) => object.id === zone.id)!.xMm
          ).toBe(2500);

          // One batch: the door slides so its twin must land at 2500, and the
          // zone vacates that exact spot in the same transaction.
          await store.getState().movePlanObjectsGroup([
            { id: a.id, xMm: 500, wallId: A_EAST },
            { id: zone.id, xMm: 800, wallId: B_WEST }
          ]);

          const objects = store.getState().project!.wallObjects;
          expect(objects.find((object) => object.id === a.id)!.xMm).toBe(500);
          expect(objects.find((object) => object.id === b.id)!.xMm).toBeCloseTo(2500, 6);
          expect(store.getState().error).toBeNull();
        });
      });

      describe("reconciliation on geometry edits", () => {
        // Two rooms 1000 mm apart, so their facing walls are NOT a boundary yet.
        function setupSeparatedRooms(): void {
          const base = store.getState().project!;
          store.setState({
            project: {
              ...base,
              wallObjects: [],
              floorObjects: [],
              floor: {
                rooms: [
                  createRectangularRoomPlacement({
                    roomId: "room-a", name: "Room A", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 0, offsetYMm: 0
                  }),
                  createRectangularRoomPlacement({
                    roomId: "room-b", name: "Room B", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 5000, offsetYMm: 0
                  })
                ]
              }
            }
          });
        }

        it("creates the twin in ONE undo step when a room slides flush", async () => {
          setupSeparatedRooms();
          await store.getState().addOpening(A_EAST, "door");
          // No neighbour yet, so no twin.
          expect(store.getState().project!.wallObjects).toHaveLength(1);
          const undoBefore = store.getState().undoStack.length;

          await store.getState().moveRoom("room-b", 4000, 0);

          const objects = store.getState().project!.wallObjects;
          expect(objects).toHaveLength(2);
          const a = objects.find((object) => object.wallId === A_EAST)!;
          const b = objects.find((object) => object.wallId === B_WEST)!;
          expect(partnerOf(a)).toBe(b.id);
          expect(partnerOf(b)).toBe(a.id);
          // The move and the twin are ONE edit: undo restores both.
          expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
          await store.getState().undo();
          expect(store.getState().project!.wallObjects).toHaveLength(1);
        });

        it("keeps the pair and the twin when the room slides away again", async () => {
          setupSeparatedRooms();
          await store.getState().addOpening(A_EAST, "door");
          await store.getState().moveRoom("room-b", 4000, 0);
          expect(store.getState().project!.wallObjects).toHaveLength(2);

          await store.getState().moveRoom("room-b", 5000, 0);

          // Never auto-severed: identity survives, the user resolves it.
          const objects = store.getState().project!.wallObjects;
          expect(objects).toHaveLength(2);
          expect(partnerOf(objects[0])).toBe(objects[1].id);
        });

        it("does not duplicate the twin when the room slides back", async () => {
          setupSeparatedRooms();
          await store.getState().addOpening(A_EAST, "door");
          await store.getState().moveRoom("room-b", 4000, 0);
          await store.getState().moveRoom("room-b", 5000, 0);

          await store.getState().moveRoom("room-b", 4000, 0);

          expect(store.getState().project!.wallObjects).toHaveLength(2);
        });

        it.each([
          ["renaming a room", async () => store.getState().renameRoom("room-b", "Gallery 2")],
          ["resizing room height", async () => store.getState().resizeRoomHeight("room-b", 2800)]
        ])("creates nothing when %s", async (_label, act) => {
          setupSharedWallRooms();
          // A door with no twin: something reconciliation WOULD repair if it ran.
          const base = store.getState().project!;
          store.setState({
            project: {
              ...base,
              wallObjects: [
                {
                  id: "stray-door", kind: "door", blocksPlacement: true, wallId: A_EAST,
                  xMm: 1500, yMm: DOOR_Y_MM, widthMm: 915, heightMm: 2030
                }
              ]
            }
          });

          await act();

          // Both rebuild `floor`, which is exactly why a referential gate would
          // have been wrong: neither changes which walls face which.
          expect(store.getState().project!.wallObjects).toHaveLength(1);
        });

        it("leaves a stray opening in an unrelated room alone", async () => {
          // The scoping guarantee. Rooms A|B share a wall; rooms C|D share their
          // own, far away, and carry an unpaired door. Editing in A must not
          // reach across the document and repair D.
          const base = store.getState().project!;
          store.setState({
            project: {
              ...base,
              wallObjects: [],
              floorObjects: [],
              floor: {
                rooms: [
                  createRectangularRoomPlacement({
                    roomId: "room-a", name: "Room A", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 0, offsetYMm: 0
                  }),
                  createRectangularRoomPlacement({
                    roomId: "room-b", name: "Room B", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 4000, offsetYMm: 0
                  }),
                  createRectangularRoomPlacement({
                    roomId: "room-c", name: "Room C", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 0, offsetYMm: 20000
                  }),
                  createRectangularRoomPlacement({
                    roomId: "room-d", name: "Room D", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 4000, offsetYMm: 20000
                  })
                ]
              }
            }
          });
          // A one-sided door on the far pair's shared wall.
          store.setState({
            project: {
              ...store.getState().project!,
              wallObjects: [
                {
                  id: "far-door", kind: "door", blocksPlacement: true,
                  wallId: "room-c-wall-east", xMm: 1500, yMm: DOOR_Y_MM,
                  widthMm: 915, heightMm: 2030
                }
              ]
            }
          });

          await store.getState().addOpening(A_EAST, "door");

          const objects = store.getState().project!.wallObjects;
          const far = objects.find((object) => object.id === "far-door")!;
          // A|B got their pair; C|D's stray is untouched.
          expect(objects.filter((object) => object.wallId === A_EAST)).toHaveLength(1);
          expect(objects.filter((object) => object.wallId === B_WEST)).toHaveLength(1);
          expect(partnerOf(far)).toBeUndefined();
          expect(objects.filter((object) => object.wallId === "room-d-wall-west")).toHaveLength(0);
        });
      });

      describe("reconciliation across removed topology and batch paths", () => {
        // room-c overlaps room-b, so BOTH back A_EAST: adding a door there is
        // ambiguous and stays unpaired. Removing room-c is what resolves it.
        function setupAmbiguousRooms(): void {
          const base = store.getState().project!;
          store.setState({
            project: {
              ...base,
              wallObjects: [],
              floorObjects: [],
              floor: {
                rooms: [
                  createRectangularRoomPlacement({
                    roomId: "room-a", name: "Room A", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 0, offsetYMm: 0
                  }),
                  createRectangularRoomPlacement({
                    roomId: "room-b", name: "Room B", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 4000, offsetYMm: 0
                  }),
                  createRectangularRoomPlacement({
                    roomId: "room-c", name: "Room C", widthMm: 4000, depthMm: 3000,
                    heightMm: 2500, offsetXMm: 4100, offsetYMm: 0
                  })
                ]
              }
            }
          });
        }

        it("moving the ambiguous third room away resolves the surviving pair", async () => {
          setupAmbiguousRooms();
          await store.getState().addOpening(A_EAST, "door");
          // Two rooms back the wall: no silent pick, so no twin yet.
          expect(store.getState().project!.wallObjects).toHaveLength(1);

          await store.getState().moveRoom("room-c", 12000, 0);

          // Post-edit topology alone would never revisit A_EAST — room-c's walls
          // no longer lead back to it. The pre-edit half of the scope does.
          const objects = store.getState().project!.wallObjects;
          expect(objects).toHaveLength(2);
          const twin = objects.find((object) => object.wallId === B_WEST)!;
          expect(partnerOf(twin)).toBe(objects.find((o) => o.wallId === A_EAST)!.id);
        });

        // The twin appears on a wall NEITHER the pre nor the post scope of the
        // changed walls contains: the union holds only room-c's walls and A_EAST,
        // and B_WEST is reached only by reconciliation's own second expansion
        // through the now-unique boundary. Validating the scope that was passed IN
        // rather than the one analysis ran OVER let this twin land unchecked.
        it("validates a twin created on a wall only reconciliation's own expansion reached", async () => {
          setupAmbiguousRooms();
          await store.getState().addOpening(A_EAST, "door");
          expect(store.getState().project!.wallObjects).toHaveLength(1);

          // Hang a work on B_WEST exactly where the twin will be mirrored to.
          // A_EAST is 3000 long and the two faces are anti-parallel, so the door
          // centred at 1500 mirrors to 1500 on B_WEST.
          await store.getState().addArtworksFromFiles([makeImageFile("on-b.jpg")]);
          const artworkId = store.getState().project!.checklistArtworkIds[0];
          await store.getState().placeArtwork(artworkId, B_WEST, 1500, 1400);
          const artworkPlacementId = store
            .getState()
            .project!.wallObjects.find((object) => object.wallId === B_WEST)!.id;

          await store.getState().moveRoom("room-c", 12000, 0);

          const objects = store.getState().project!.wallObjects;
          const twin = objects.find(
            (object) => object.wallId === B_WEST && object.kind === "door"
          )!;
          expect(twin).toBeDefined();

          // The twin really does land on top of the work...
          const artwork = objects.find((object) => object.id === artworkPlacementId)!;
          expect(Math.abs(twin.xMm - artwork.xMm)).toBeLessThan(
            twin.widthMm / 2 + artwork.widthMm / 2
          );
          // ...and the collision is reported rather than committed in silence.
          const warnings = store.getState().placementWarnings;
          expect(
            warnings.some(
              (warning) =>
                warning.type === "collision" &&
                (warning.wallObjectId === twin.id ||
                  warning.wallObjectId === artworkPlacementId)
            )
          ).toBe(true);
        });

        it("deleting the ambiguous third room resolves the surviving pair", async () => {
          setupAmbiguousRooms();
          await store.getState().addOpening(A_EAST, "door");
          expect(store.getState().project!.wallObjects).toHaveLength(1);

          await store.getState().deleteRoom("room-c");

          const objects = store.getState().project!.wallObjects;
          expect(objects).toHaveLength(2);
          expect(objects.some((object) => object.wallId === B_WEST)).toBe(true);
        });

        it("still only disconnects when the deleted room owned the other half", async () => {
          // The disconnect-only contract survives reconciliation on delete: the
          // survivor's counterpart wall died with the room, so it reads as
          // exterior and nothing is recreated.
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          expect(store.getState().project!.wallObjects).toHaveLength(2);

          await store.getState().deleteRoom("room-b");

          const objects = store.getState().project!.wallObjects;
          expect(objects).toHaveLength(1);
          expect(objects[0].wallId).toBe(A_EAST);
          expect(partnerOf(objects[0])).toBeUndefined();
        });

        it("pairs an unpaired opening carried onto a shared wall by a group drag", async () => {
          setupSharedWallRooms();
          // An unpaired door far from the boundary on room-b's east wall.
          const base = store.getState().project!;
          store.setState({
            project: {
              ...base,
              wallObjects: [
                {
                  id: "lone-door", kind: "door", blocksPlacement: true,
                  wallId: "room-b-wall-east", xMm: 1500, yMm: DOOR_Y_MM, widthMm: 915, heightMm: 2030
                }
              ]
            }
          });

          await store.getState().movePlanObjectsGroup([
            { id: "lone-door", xMm: 1500, wallId: B_WEST }
          ]);

          const objects = store.getState().project!.wallObjects;
          expect(objects).toHaveLength(2);
          const moved = objects.find((object) => object.id === "lone-door")!;
          expect(moved.wallId).toBe(B_WEST);
          expect(partnerOf(moved)).toBeDefined();
        });

        it("keeps counterpart-wall warnings visible through a room add", async () => {
          // applyEdit wipes placementWarnings unconditionally, and the add-room
          // paths used to pass none — so the very edit that creates a twin also
          // silently discarded every warning on the walls it touched.
          setupSharedWallRooms();
          store.setState({
            project: {
              ...store.getState().project!,
              floor: { rooms: [store.getState().project!.floor.rooms[0]] }
            }
          });
          // A door overlapping an artwork on A_EAST: a real, overridable warning.
          store.setState({
            project: {
              ...store.getState().project!,
              wallObjects: [
                {
                  id: "warn-door", kind: "door", blocksPlacement: true, wallId: A_EAST,
                  xMm: 1500, yMm: DOOR_Y_MM, widthMm: 915, heightMm: 2030
                },
                {
                  id: "warn-art", wallId: A_EAST, kind: "artwork", artworkId: "artwork-1",
                  xMm: 1500, yMm: 1000, widthMm: 600, heightMm: 800
                }
              ]
            }
          });

          await store.getState().addDrawnRectangleRoom({
            offsetXMm: 4000, offsetYMm: 0, widthMm: 4000, depthMm: 3000
          });

          const state = store.getState();
          // The flush room gave the door its twin...
          expect(state.project!.wallObjects.filter((o) => o.kind === "door")).toHaveLength(2);
          // ...and the pre-existing collision on the counterpart wall is
          // reported, not wiped.
          expect(
            state.placementWarnings.some((warning) => warning.type === "collision")
          ).toBe(true);
        });
      });

      describe("resizing a paired opening", () => {
        // The shared wall is 3000 long and the two faces are anti-parallel, so
        // the mapping between them is x -> 3000 - x.
        const SHARED_WALL_MM = 3000;

        it("gives both faces the same width and physically aligned centres", async () => {
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);

          await store.getState().resizeOpening(primary.id, 2000, primary.heightMm);

          const a = onWall(A_EAST);
          const b = onWall(B_WEST);
          expect(a.widthMm).toBe(2000);
          expect(b.widthMm).toBe(2000);
          // Mirrored, not merely equal: the twin's local x runs the other way.
          expect(b.xMm).toBeCloseTo(SHARED_WALL_MM - a.xMm, 6);
          expect(store.getState().saveState).toBe("saved");
        });

        it("keeps both halves at the same height when a door's height changes", async () => {
          // A door's y is recomputed as heightMm / 2 so its bottom stays on the
          // floor. Mirroring width, height and x but NOT y left the two halves at
          // different heights — manufacturing the very paired-geometry-mismatch
          // this stage exists to prevent.
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);

          await store.getState().resizeOpening(primary.id, primary.widthMm, 1800);

          const a = onWall(A_EAST);
          const b = onWall(B_WEST);
          expect(a.heightMm).toBe(1800);
          expect(b.heightMm).toBe(1800);
          expect(a.yMm).toBe(900);
          expect(b.yMm).toBe(900);
          expect(a.widthMm).toBe(b.widthMm);
          expect(b.xMm).toBeCloseTo(SHARED_WALL_MM - a.xMm, 6);
        });

        it("stays non-empty even though the twin's local x runs in the opposite direction", async () => {
          // The order-reversal guard. Intersecting the two spans without
          // re-deriving min/max after mapping compares a start against an end and
          // silently yields an empty span, which would block every paired resize.
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);

          const fit = await store
            .getState()
            .resizeOpening(primary.id, SHARED_WALL_MM, primary.heightMm);

          expect(fit?.noMutualSpan).toBeFalsy();
          // The full shared wall is available to both faces.
          expect(onWall(A_EAST).widthMm).toBeCloseTo(SHARED_WALL_MM, 6);
          expect(onWall(B_WEST).widthMm).toBeCloseTo(SHARED_WALL_MM, 6);
        });

        it("takes the narrower of the two faces' available runs and names the facing wall", async () => {
          setupSharedWallRooms();
          await store.getState().addOpening(A_EAST, "door");
          const primary = onWall(A_EAST);
          const twin = onWall(B_WEST);

          // Put a blocked zone on the TWIN's wall only, so that face is the
          // binding constraint. Room B's west wall runs the other way, so this
          // occupies the far end from room A's point of view.
          await store.getState().addOpening(B_WEST, "blocked-zone");
          const blocker = store
            .getState()
            .project!.wallObjects.find(
              (object) => object.kind === "blocked-zone" && object.wallId === B_WEST
            )!;
          await store.getState().moveOpening(blocker.id, 2600, twin.yMm, true);

          const fit = await store
            .getState()
            .resizeOpening(primary.id, SHARED_WALL_MM, primary.heightMm);

          const a = onWall(A_EAST);
          const b = store.getState().project!.wallObjects.find((o) => o.id === twin.id)!;
          // Constrained below the full wall, and identical on both faces.
          expect(a.widthMm).toBeLessThan(SHARED_WALL_MM);
          expect(b.widthMm).toBeCloseTo(a.widthMm, 6);
          expect(b.xMm).toBeCloseTo(SHARED_WALL_MM - a.xMm, 6);
          expect(fit?.constraint).toMatch(/^paired-/);
          expect(store.getState().error).toBeNull();
        });

        it("leaves both halves untouched when the two faces share no run at all", async () => {
          // Note this state is not reachable by dragging: while a pair is
          // correctly mirrored, each face's run necessarily contains the opening,
          // so the two always intersect. It takes an already-desynced pair —
          // legacy data, or a sync that previously bailed — which is exactly why
          // the guard exists. Written directly for that reason.
          setupSharedWallRooms();
          const base = store.getState().project!;
          const zone = (id: string, wallId: string, xMm: number) => ({
            id,
            kind: "blocked-zone" as const,
            blocksPlacement: true as const,
            wallId,
            xMm,
            yMm: DOOR_Y_MM,
            widthMm: 600,
            heightMm: 2030
          });
          const door = (id: string, wallId: string, partnerId: string) => ({
            id,
            kind: "door" as const,
            blocksPlacement: true as const,
            wallId,
            xMm: 400,
            yMm: DOOR_Y_MM,
            widthMm: 400,
            heightMm: 2030,
            connectsToObjectId: partnerId
          });

          store.setState({
            project: {
              ...base,
              wallObjects: [
                // Both halves sit at x = 400 on their own wall — a desynced pair,
                // since the true mirror of 400 is 2600.
                door("door-a", A_EAST, "door-b"),
                door("door-b", B_WEST, "door-a"),
                // Each face is walled off at 700, so each run is [0, 700]. Mapped
                // across the anti-parallel twin that becomes [2300, 3000], which
                // does not meet [0, 700].
                zone("zone-a", A_EAST, 1000),
                zone("zone-b", B_WEST, 1000)
              ]
            }
          });
          const undoBefore = store.getState().undoStack.length;

          const fit = await store.getState().resizeOpening("door-a", 2500, 2030);

          expect(fit?.noMutualSpan).toBe(true);
          // Nothing committed, and above all the two halves stay in step.
          const objects = store.getState().project!.wallObjects;
          expect(objects.find((o) => o.id === "door-a")!.widthMm).toBe(400);
          expect(objects.find((o) => o.id === "door-b")!.widthMm).toBe(400);
          expect(store.getState().undoStack).toHaveLength(undoBefore);
        });
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

        // Revalidation is symmetric and clears stale collision warnings.
        expect(store.getState().placementWarnings).toEqual([]);
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

    describe("placeCaseFromPlan", () => {
      it("creates a wall case at the plan xMm with the wall-case defaults and selects it", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

        await store.getState().placeCaseFromPlan({ anchor: "wall", wallId: wall.id, xMm: 1234 });

        const state = store.getState();
        expect(state.undoStack.at(-1)?.label).toBe("Add display case");
        expect(state.project!.floorObjects).toHaveLength(0);
        const wallCase = state.project!.wallObjects[0];
        expect(wallCase.kind).toBe("case");
        expect(wallCase.wallId).toBe(wall.id);
        expect(wallCase.xMm).toBe(1234);
        expect(wallCase.yMm).toBe(DEFAULT_WALL_CASE_CENTER_Y_MM);
        expect(wallCase.widthMm).toBe(DEFAULT_WALL_CASE_WIDTH_MM);
        expect(wallCase.heightMm).toBe(DEFAULT_WALL_CASE_HEIGHT_MM);
        expect((wallCase as { depthMm: number }).depthMm).toBe(DEFAULT_WALL_CASE_DEPTH_MM);
        expect(getSelectedOpeningId(state.project, state.selection)).toBe(wallCase.id);
      });

      it("creates a freestanding floor case at the plan xy with the floor-case defaults and selects it", async () => {
        await store.getState().placeCaseFromPlan({ anchor: "floor", xMm: 2000, yMm: 3000 });

        const state = store.getState();
        expect(state.undoStack.at(-1)?.label).toBe("Add display case");
        expect(state.project!.wallObjects).toHaveLength(0);
        const floorCase = state.project!.floorObjects[0];
        expect(floorCase.kind).toBe("case");
        expect(floorCase.xMm).toBe(2000);
        expect(floorCase.yMm).toBe(3000);
        expect(floorCase.widthMm).toBe(DEFAULT_FLOOR_CASE_WIDTH_MM);
        expect(floorCase.depthMm).toBe(DEFAULT_FLOOR_CASE_DEPTH_MM);
        expect(floorCase.heightMm).toBe(DEFAULT_FLOOR_CASE_HEIGHT_MM);
        expect(floorCase.rotationDeg).toBe(0);
        expect(getSelectedOpeningId(state.project, state.selection)).toBe(floorCase.id);
      });

      it("updateWallCase edits width/height/depth/position and updateFloorObject edits floor-case height", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().placeCaseFromPlan({ anchor: "wall", wallId: wall.id, xMm: 1000 });
        const wallCaseId = store.getState().project!.wallObjects[0].id;

        await store.getState().updateWallCase(wallCaseId, {
          widthMm: 1200,
          heightMm: 220,
          depthMm: 500,
          yMm: 1050,
          xMm: 1100
        });

        const wallCase = store.getState().project!.wallObjects[0];
        expect(wallCase.widthMm).toBe(1200);
        expect(wallCase.heightMm).toBe(220);
        expect((wallCase as { depthMm: number }).depthMm).toBe(500);
        expect(wallCase.yMm).toBe(1050);
        expect(wallCase.xMm).toBe(1100);

        await store.getState().placeCaseFromPlan({ anchor: "floor", xMm: 500, yMm: 500 });
        const floorCaseId = store.getState().project!.floorObjects[0].id;

        await store.getState().updateFloorObject(floorCaseId, { heightMm: 1200 });
        expect(store.getState().project!.floorObjects[0].heightMm).toBe(1200);
      });

      // The schema declares baseHeightMm nonnegative and parseProject THROWS, and
      // that parse runs on every save — so an unclamped negative commits fine in
      // memory and then wedges persistence/export/backup behind a generic error,
      // while all three views still draw the object as ordinary floor-resting
      // (3D strips <= 0, elevation gates on > 0). Clamping is what keeps the
      // inspector's deliberately-not-positiveOnly field (0 must stay typeable to
      // un-suspend a work) from being able to write an unsaveable project.
      it("clamps a negative baseHeightMm to 0 so a suspended object can never wedge saving", async () => {
        await store.getState().placeCaseFromPlan({ anchor: "floor", xMm: 500, yMm: 500 });
        const floorId = store.getState().project!.floorObjects[0].id;

        await store.getState().updateFloorObject(floorId, { baseHeightMm: -2000 });

        const clamped = store.getState().project!.floorObjects[0];
        expect(clamped.baseHeightMm).toBe(0);
        // The whole point of the clamp: the result still parses, i.e. still saves.
        expect(() => parseProject(store.getState().project!)).not.toThrow();

        // 0 stays writable (un-suspending), and a real height still round-trips.
        await store.getState().updateFloorObject(floorId, { baseHeightMm: 1200 });
        expect(store.getState().project!.floorObjects[0].baseHeightMm).toBe(1200);
        await store.getState().updateFloorObject(floorId, { baseHeightMm: 0 });
        expect(store.getState().project!.floorObjects[0].baseHeightMm).toBe(0);
      });

      it("refuses to convert a floor case onto a wall (no case wall↔floor conversion)", async () => {
        await store.getState().placeCaseFromPlan({ anchor: "floor", xMm: 500, yMm: 500 });
        const floorCaseId = store.getState().project!.floorObjects[0].id;
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;

        await expect(
          store
            .getState()
            .commitPlanMove(floorCaseId, { anchor: "wall", wallId: wall.id, xMm: 1000 })
        ).rejects.toThrow(/display case cannot be moved onto a wall/);
        // The case stays on the floor, unconverted.
        expect(store.getState().project!.floorObjects).toHaveLength(1);
        expect(store.getState().project!.wallObjects).toHaveLength(0);
      });
    });

    describe("updateDoorLeaf", () => {
      async function addDoor(): Promise<string> {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().addOpening(wall.id, "door");
        return store.getState().project!.wallObjects.at(-1)!.id;
      }

      function doorById(id: string) {
        const found = store.getState().project!.wallObjects.find((object) => object.id === id);
        return found?.kind === "door" ? found : null;
      }

      it("a new door is a plain doorway — no leaf key at all", async () => {
        const doorId = await addDoor();
        expect(Object.keys(doorById(doorId)!)).not.toContain("leaf");
      });

      it("an empty partial makes it hinged with the derived default handing", async () => {
        const doorId = await addDoor();

        await store.getState().updateDoorLeaf(doorId, {});

        // The sample room is wound counter-clockwise, so the interior IS the left
        // of the authored direction; the door is centred on the wall, so the
        // hinge goes to the nearer (start) jamb.
        expect(doorById(doorId)!.leaf).toEqual({ hingeAtStart: true, swingsToLeft: true });
        expect(store.getState().undoStack.at(-1)?.label).toBe("Edit door");
      });

      it("a partial flips one flag and leaves the other alone", async () => {
        const doorId = await addDoor();
        await store.getState().updateDoorLeaf(doorId, {});

        await store.getState().updateDoorLeaf(doorId, { swingsToLeft: false });

        // Filling from the CURRENT handing, not from the default: otherwise
        // "flip the swing" would silently reset the hinge.
        expect(doorById(doorId)!.leaf).toEqual({ hingeAtStart: true, swingsToLeft: false });
      });

      it("undefined turns it back into a doorway, deleting the key", async () => {
        const doorId = await addDoor();
        await store.getState().updateDoorLeaf(doorId, {});

        await store.getState().updateDoorLeaf(doorId, undefined);

        expect(Object.keys(doorById(doorId)!)).not.toContain("leaf");
      });

      it("pushes no undo entry when nothing actually changes", async () => {
        const doorId = await addDoor();
        await store.getState().updateDoorLeaf(doorId, {});
        const doorwayId = await addDoor();
        const depth = store.getState().undoStack.length;

        await store.getState().updateDoorLeaf(doorId, { hingeAtStart: true, swingsToLeft: true });
        // ...and clearing an already-clear leaf is a no-op too.
        await store.getState().updateDoorLeaf(doorwayId, undefined);

        expect(store.getState().undoStack).toHaveLength(depth);
      });

      it("ignores a window (and anything that is not a door)", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().addOpening(wall.id, "window");
        const windowId = store.getState().project!.wallObjects.at(-1)!.id;
        const depth = store.getState().undoStack.length;

        await store.getState().updateDoorLeaf(windowId, {});

        expect(store.getState().undoStack).toHaveLength(depth);
        expect(
          Object.keys(store.getState().project!.wallObjects.find((o) => o.id === windowId)!)
        ).not.toContain("leaf");
      });

      it("survives undo/redo and reaches the persisted document", async () => {
        const doorId = await addDoor();
        await store.getState().updateDoorLeaf(doorId, { hingeAtStart: false, swingsToLeft: false });

        await store.getState().undo();
        expect(doorById(doorId)!.leaf).toBeUndefined();

        await store.getState().redo();
        expect(doorById(doorId)!.leaf).toEqual({ hingeAtStart: false, swingsToLeft: false });

        const persisted = repository.projects.get(store.getState().project!.id)!;
        const stored = persisted.wallObjects.find((object) => object.id === doorId);
        expect(stored?.kind === "door" ? stored.leaf : null).toEqual({
          hingeAtStart: false,
          swingsToLeft: false
        });
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
        expect(floorObject.heightMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
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
        // Inject a schema-valid legacy duplicate that current actions forbid.
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

      it("re-anchoring onto a different wall makes it the elevation view's wall context", async () => {
        const { placementId } = await placeArtworkOnWall(1000, 1450);
        store.getState().focusWallContext("wall-north");
        expect(store.getState().wallContextId).toBe("wall-north");

        await store.getState().commitPlanMove(placementId, {
          anchor: "wall",
          wallId: "wall-east",
          xMm: 800
        });

        expect(store.getState().wallContextId).toBe("wall-east");
      });

      it("dragging along the same wall leaves the wall context on that wall", async () => {
        const { placementId, wall } = await placeArtworkOnWall(1000, 1450);
        store.getState().focusWallContext(wall.id);

        await store.getState().commitPlanMove(placementId, {
          anchor: "wall",
          wallId: wall.id,
          xMm: 2000
        });

        expect(store.getState().wallContextId).toBe(wall.id);
      });

      it("converts a wall artwork to a floor object: same id, one undo entry, and undo restores the wall placement", async () => {
        const { placementId } = await placeArtworkOnWall(1000, 1450);
        const projectWithOverride: Project = {
          ...store.getState().project!,
          wallObjects: store.getState().project!.wallObjects.map((object) =>
            object.id === placementId && object.kind === "artwork"
              ? {
                  ...object,
                  widthMm: 437,
                  heightMm: 319,
                  displayDimensionsOverride: {
                    widthMm: 900,
                    heightMm: 700,
                    status: "known" as const
                  }
                }
              : object
          )
        };
        await repository.save(projectWithOverride);
        store.setState({ project: projectWithOverride });
        const before = projectWithOverride.wallObjects.find((o) => o.id === placementId)!;
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
        expect(floorObject.wallYMm).toBe(1450);
        expect(floorObject.widthMm).toBe(before.widthMm);
        expect(floorObject.heightMm).toBe(before.heightMm);
        expect(floorObject.kind).toBe("artwork");
        if (floorObject.kind === "artwork" && before.kind === "artwork") {
          expect(floorObject.displayDimensionsOverride).toEqual(before.displayDimensionsOverride);
        }

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
        const projectWithOverride: Project = {
          ...store.getState().project!,
          floorObjects: store.getState().project!.floorObjects.map((object) =>
            object.kind === "artwork"
              ? {
                  ...object,
                  widthMm: 437,
                  heightMm: 319,
                  displayDimensionsOverride: {
                    widthMm: 900,
                    heightMm: 700,
                    status: "known" as const
                  }
                }
              : object
          )
        };
        await repository.save(projectWithOverride);
        store.setState({ project: projectWithOverride });
        const floorObject = projectWithOverride.floorObjects[0];
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
        expect(wallObject.widthMm).toBe(floorObject.widthMm);
        expect(wallObject.heightMm).toBe(floorObject.heightMm);
        expect(wallObject.kind).toBe("artwork");
        if (wallObject.kind === "artwork" && floorObject.kind === "artwork") {
          expect(wallObject.displayDimensionsOverride).toEqual(
            floorObject.displayDimensionsOverride
          );
        }
      });

      // Capture round trip (FloorMemory in domain/project.ts). A floor object
      // dragged near a wall is CONVERTED to a wall object, and a wall cannot
      // express suspension, a plan angle, or which box faces carry the image.
      // These exercise the real store actions in both directions rather than
      // asserting the memory field in isolation: the round trip is the contract.
      async function placeFloorArtwork() {
        await store.getState().addArtworksFromFiles([makeImageFile("board.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().placeArtworkOnFloor(artworkId, 4000, 4000);
        return store.getState().project!.floorObjects[0].id;
      }

      // wall-east runs across the room, so its inherited angle is nowhere near
      // the authored 45° below — capturing onto it is what makes "the remembered
      // angle won" distinguishable from "the wall's angle happened to match".
      async function captureOntoWallEast(objectId: string) {
        await store
          .getState()
          .commitPlanMove(objectId, { anchor: "wall", wallId: "wall-east", xMm: 1200 });
      }

      it("restores suspension, plan angle, and image faces across a floor → wall → floor capture", async () => {
        const objectId = await placeFloorArtwork();
        await store
          .getState()
          .updateFloorObject(objectId, { rotationDeg: 45, baseHeightMm: 1200 });
        await store.getState().setFloorArtworkImageFaces(objectId, ["top"]);
        const before = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;

        await captureOntoWallEast(objectId);
        expect(store.getState().project!.floorObjects).toHaveLength(0);

        await store
          .getState()
          .commitPlanMove(objectId, { anchor: "floor", xMm: 4200, yMm: 4100 });

        const after = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        expect(after.rotationDeg).toBe(before.rotationDeg);
        expect(after.baseHeightMm).toBe(before.baseHeightMm);
        expect(after.kind).toBe("artwork");
        if (after.kind === "artwork" && before.kind === "artwork") {
          expect(after.imageFaces).toEqual(before.imageFaces);
        }
      });

      it("capturing a floor object onto a wall makes it the elevation view's wall context", async () => {
        const objectId = await placeFloorArtwork();
        store.getState().focusWallContext("wall-north");
        expect(store.getState().wallContextId).toBe("wall-north");

        await captureOntoWallEast(objectId);

        expect(store.getState().wallContextId).toBe("wall-east");
      });

      it("round-trips an unauthored floor object with baseHeightMm and imageFaces still ABSENT", async () => {
        const objectId = await placeFloorArtwork();

        await captureOntoWallEast(objectId);

        // The memory itself must not materialize keys either: absence encodes
        // "never chosen", and a spurious key makes a clean project hash dirty.
        const captured = store.getState().project!.wallObjects.find((o) => o.id === objectId)!;
        expect(captured.kind).toBe("artwork");
        if (captured.kind === "artwork") {
          expect("baseHeightMm" in captured.floorMemory!).toBe(false);
          expect("imageFaces" in captured.floorMemory!).toBe(false);
        }

        await store
          .getState()
          .commitPlanMove(objectId, { anchor: "floor", xMm: 4200, yMm: 4100 });

        const after = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        expect("baseHeightMm" in after).toBe(false);
        expect("imageFaces" in after).toBe(false);
        // Absent is not "defaulted either": the front+back default stays a read
        // -time fallback, never a stored value.
        expect(after.baseHeightMm).toBeUndefined();
      });

      it("keeps an empty imageFaces selection empty across the round trip", async () => {
        const objectId = await placeFloorArtwork();
        // Every face deliberately off — a neutral volume. Distinct from absent,
        // which means front + back, and the sharpest case of the three: it is a
        // stated curatorial choice, not a measurement.
        await store.getState().setFloorArtworkImageFaces(objectId, []);

        await captureOntoWallEast(objectId);
        await store
          .getState()
          .commitPlanMove(objectId, { anchor: "floor", xMm: 4200, yMm: 4100 });

        const after = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        expect(after.kind).toBe("artwork");
        if (after.kind === "artwork") {
          expect(after.imageFaces).toEqual([]);
        }
      });

      // A pedestal is a sized, curator-authored object: losing it on a stray
      // drag onto a wall is the same class of loss as losing the plan angle,
      // and worse, because the restored work silently drops to the floor.
      it("carries a floor support through a floor → wall → floor capture unchanged", async () => {
        const objectId = await placeFloorArtwork();
        await store.getState().setFloorArtworkStandsOn(objectId, "pedestal");
        await store.getState().updateFloorArtworkSupport(objectId, { offsetXMm: 40 });
        const before = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        const supportBefore = before.kind === "artwork" ? before.support : undefined;
        expect(supportBefore).toBeDefined();

        await captureOntoWallEast(objectId);
        // Parked in the memory slot, not rendered from there (see FloorMemory).
        const captured = store.getState().project!.wallObjects.find((o) => o.id === objectId)!;
        expect(captured.kind === "artwork" && captured.floorMemory?.support).toEqual(
          supportBefore
        );

        await store
          .getState()
          .commitPlanMove(objectId, { anchor: "floor", xMm: 4200, yMm: 4100 });

        const after = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        expect(after.kind === "artwork" && after.support).toEqual(supportBefore);
      });

      it("re-fits a restored support against a work that was resized on the wall", async () => {
        await store.getState().addArtworksFromFiles([makeImageFile("bronze.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 400, heightMm: 600, depthMm: 400, status: "known" }
        });
        await store.getState().placeArtworkOnFloor(artworkId, 4000, 4000);
        const objectId = store.getState().project!.floorObjects[0].id;
        await store.getState().setFloorArtworkStandsOn(objectId, "pedestal");
        // 400mm work + 100mm reveal per side.
        expect(
          store.getState().project!.floorObjects[0].kind === "artwork" &&
            (store.getState().project!.floorObjects[0] as { support?: { widthMm: number } })
              .support?.widthMm
        ).toBe(600);

        await captureOntoWallEast(objectId);
        // Unlike baseHeightMm, the WORK's own width is editable while it hangs
        // on the wall (the dimension rebake follows the placement), so the
        // parked support can be stale by the time it comes back down.
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm: 1200, heightMm: 600, depthMm: 400, status: "known" }
        });

        await store
          .getState()
          .commitPlanMove(objectId, { anchor: "floor", xMm: 4200, yMm: 4100 });

        const after = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        // Grow the support, never shrink the work: a 600mm pedestal cannot hold
        // a 1200mm work with overhang off.
        expect(after.widthMm).toBe(1200);
        expect(after.kind === "artwork" && after.support!.widthMm).toBe(1200);
      });

      it("leaves a support-less work support-less across the round trip", async () => {
        const objectId = await placeFloorArtwork();

        await captureOntoWallEast(objectId);
        const captured = store.getState().project!.wallObjects.find((o) => o.id === objectId)!;
        expect(
          captured.kind === "artwork" && "support" in (captured.floorMemory ?? {})
        ).toBe(false);

        await store
          .getState()
          .commitPlanMove(objectId, { anchor: "floor", xMm: 4200, yMm: 4100 });

        const after = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        // Absence is how this codebase records "never chosen" — a spurious key
        // would dirty a clean project's cloud-backup fingerprint.
        expect("support" in after).toBe(false);
        expect("monitorSupport" in after).toBe(false);
      });

      // ─── Box monitors (Artwork.displayAs === "monitor") ────────────────────
      // The floor object of a monitor work is the CABINET, not the work: these
      // pin the two routes onto the floor to the same 4:3 / MONITOR_DEPTH_MM
      // source, and the absent-means-pedestal rule for the per-placement support.

      async function addMonitorArtwork() {
        await store.getState().addArtworksFromFiles([makeImageFile("video.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, { displayAs: "monitor" });
        return artworkId;
      }

      it("seeds a monitor placement from the cabinet's geometry, not the work's", async () => {
        const artworkId = await addMonitorArtwork();
        await store.getState().placeArtworkOnFloor(artworkId, 4000, 4000);

        const placed = store.getState().project!.floorObjects[0]!;
        expect(placed.depthMm).toBe(MONITOR_DEPTH_MM);
        expect(placed.widthMm / placed.heightMm).toBeCloseTo(MONITOR_ASPECT_RATIO, 6);
        // The pedestal is deliberately NOT in heightMm — it is added by the
        // renderers from monitorSupport, so toggling it rewrites no geometry.
        expect(placed.heightMm).toBeLessThan(MONITOR_PEDESTAL_HEIGHT_MM);
      });

      it("re-seeds an already-placed work's box when it becomes a monitor", async () => {
        await store.getState().addArtworksFromFiles([makeImageFile("video.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().placeArtworkOnFloor(artworkId, 4000, 4000);
        const objectId = store.getState().project!.floorObjects[0]!.id;
        await store.getState().updateFloorObject(objectId, { depthMm: 20 });

        await store.getState().updateArtwork(artworkId, { displayAs: "monitor" });

        const placed = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        // A paper-thin board would render as a CRT with no tube.
        expect(placed.depthMm).toBe(MONITOR_DEPTH_MM);
        expect(placed.widthMm / placed.heightMm).toBeCloseTo(MONITOR_ASPECT_RATIO, 6);
      });

      it("re-seeds the cabinet when a monitor work is converted from a wall to the floor", async () => {
        const { artworkId, placementId } = await placeArtworkOnWall(1000, 1450);
        await store.getState().updateArtwork(artworkId, { displayAs: "monitor" });

        await store
          .getState()
          .commitPlanMove(placementId, { anchor: "floor", xMm: 4000, yMm: 4000 });

        const placed = store.getState().project!.floorObjects.find((o) => o.id === placementId)!;
        expect(placed.depthMm).toBe(MONITOR_DEPTH_MM);
        expect(placed.widthMm / placed.heightMm).toBeCloseTo(MONITOR_ASPECT_RATIO, 6);
      });

      it("leaves monitorSupport ABSENT until the curator overrides the pedestal default", async () => {
        const artworkId = await addMonitorArtwork();
        await store.getState().placeArtworkOnFloor(artworkId, 4000, 4000);
        const objectId = store.getState().project!.floorObjects[0]!.id;

        const placed = store.getState().project!.floorObjects[0]!;
        expect("monitorSupport" in placed).toBe(false);

        // Re-choosing the resolved default is a no-op: absence stays absence, so
        // a clean project's hash never dirties and no dead undo entry is pushed.
        await store.getState().setFloorArtworkMonitorSupport(objectId, "pedestal");
        expect(
          "monitorSupport" in store.getState().project!.floorObjects.find((o) => o.id === objectId)!
        ).toBe(false);

        await store.getState().setFloorArtworkMonitorSupport(objectId, "floor");
        const onFloor = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        expect(onFloor.kind === "artwork" && onFloor.monitorSupport).toBe("floor");

        // ...and back to an EXPLICIT pedestal, which now differs from the stored
        // value and therefore does get written.
        await store.getState().setFloorArtworkMonitorSupport(objectId, "pedestal");
        const back = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        expect(back.kind === "artwork" && back.monitorSupport).toBe("pedestal");
      });

      it("still inherits the source wall's angle on a first-ever wall → floor conversion", async () => {
        const { placementId } = await placeArtworkOnWall(1000, 1450);
        await store
          .getState()
          .commitPlanMove(placementId, { anchor: "wall", wallId: "wall-east", xMm: 800 });

        // A work that has never been on the floor has no remembered angle, so
        // wall-angle inheritance must still apply — it should face the way the
        // wall it just left faced.
        const captured = store.getState().project!.wallObjects.find((o) => o.id === placementId)!;
        expect(captured.kind === "artwork" && captured.floorMemory).toBeUndefined();
        const wall = getFloorWalls(store.getState().project!.floor).find(
          (candidate) => candidate.id === "wall-east"
        )!;
        const wallAngleDeg = (wall.angleRad * 180) / Math.PI;
        // Guard the fixture: an axis-aligned 0° wall would make this test unable
        // to fail, since 0 is also the fresh-placement default.
        expect(wallAngleDeg).not.toBe(0);

        await store
          .getState()
          .commitPlanMove(placementId, { anchor: "floor", xMm: 5000, yMm: 3000 });

        const floorObject = store.getState().project!.floorObjects.find((o) => o.id === placementId)!;
        expect(floorObject.rotationDeg).toBeCloseTo(wallAngleDeg);
      });

      it("preserves a captured blocked zone's plan angle on the way back to the floor", async () => {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().addOpening(wall.id, "blocked-zone");
        const zoneId = store.getState().project!.wallObjects[0].id;
        await store.getState().commitPlanMove(zoneId, { anchor: "floor", xMm: 4000, yMm: 4000 });
        // A blocked zone's rotationDeg is live floor geometry too (its flat wash
        // rotates), so it carries the base memory shape — no imageFaces.
        await store.getState().updateFloorObject(zoneId, { rotationDeg: 30 });

        await captureOntoWallEast(zoneId);
        const captured = store.getState().project!.wallObjects.find((o) => o.id === zoneId)!;
        expect(captured.kind === "blocked-zone" && captured.floorMemory).toEqual({
          rotationDeg: 30
        });

        await store.getState().commitPlanMove(zoneId, { anchor: "floor", xMm: 4200, yMm: 4100 });
        const after = store.getState().project!.floorObjects.find((o) => o.id === zoneId)!;
        expect(after.rotationDeg).toBe(30);
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

    // The inspector's Wall|Floor "Type" control. For a placed work it drives the
    // same conversion machinery a cross-boundary plan drag uses, so these exercise
    // the store action end to end rather than asserting the handoff.
    describe("setArtworkPlacementForm", () => {
      async function addArtwork(name = "type-row.jpg") {
        await store.getState().addArtworksFromFiles([makeImageFile(name)]);
        return store.getState().project!.checklistArtworkIds.at(-1)!;
      }

      async function hangArtwork(xMm = 1000, yMm = 1450) {
        const artworkId = await addArtwork();
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().placeArtwork(artworkId, wall.id, xMm, yMm);
        return { artworkId, wall };
      }

      function floorArtwork(artworkId: string) {
        return store
          .getState()
          .project!.floorObjects.find(
            (object) => object.kind === "artwork" && object.artworkId === artworkId
          )!;
      }

      function wallArtwork(artworkId: string) {
        return store
          .getState()
          .project!.wallObjects.find(
            (object) => object.kind === "artwork" && object.artworkId === artworkId
          )!;
      }

      it("round-trips hang height, suspension, plan angle and image faces across wall → floor → wall → floor", async () => {
        const { artworkId } = await hangArtwork(1000, 1450);

        await store.getState().setArtworkPlacementForm(artworkId, "floor");
        const onFloor = floorArtwork(artworkId);
        // Stood down at the same point along the wall, its back flat against the
        // wall face: half its own footprint depth into the room.
        expect(onFloor.xMm).toBeCloseTo(1000);
        expect(onFloor.yMm).toBeCloseTo(DEFAULT_FLOOR_OBJECT_DEPTH_MM / 2);
        expect(onFloor.wallYMm).toBe(1450);

        // Floor-only state a wall cannot express — the whole reason the memory
        // contract exists.
        await store
          .getState()
          .updateFloorObject(onFloor.id, { rotationDeg: 45, baseHeightMm: 914.4 });
        await store.getState().setFloorArtworkImageFaces(onFloor.id, ["top"]);

        await store.getState().setArtworkPlacementForm(artworkId, "wall");
        const backOnWall = wallArtwork(artworkId);
        expect(backOnWall.yMm).toBe(1450);

        await store.getState().setArtworkPlacementForm(artworkId, "floor");
        const backOnFloor = floorArtwork(artworkId);
        expect(backOnFloor.rotationDeg).toBe(45);
        expect(backOnFloor.baseHeightMm).toBe(914.4);
        expect(backOnFloor.wallYMm).toBe(1450);
        expect(backOnFloor.kind).toBe("artwork");
        if (backOnFloor.kind === "artwork") {
          expect(backOnFloor.imageFaces).toEqual(["top"]);
        }
        // The id survives every leg, so selection and undo both track one object.
        expect(backOnFloor.id).toBe(onFloor.id);
      });

      it("keeps imageFaces ABSENT absent and EMPTY empty across the round trip", async () => {
        // Two records, one for each state, because the distinction only shows up
        // by comparing them: absent means "never chosen" (front + back at read
        // time) and [] means "every face deliberately off". Collapsing either into
        // the other silently rewrites a curatorial choice.
        const untouchedId = await addArtwork("faces-absent.jpg");
        const clearedId = await addArtwork("faces-empty.jpg");
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().placeArtwork(untouchedId, wall.id, 1000, 1450);
        await store.getState().placeArtwork(clearedId, wall.id, 3000, 1450, true);

        for (const artworkId of [untouchedId, clearedId]) {
          await store.getState().setArtworkPlacementForm(artworkId, "floor");
        }
        await store.getState().setFloorArtworkImageFaces(floorArtwork(clearedId).id, []);

        for (const artworkId of [untouchedId, clearedId]) {
          await store.getState().setArtworkPlacementForm(artworkId, "wall");
          await store.getState().setArtworkPlacementForm(artworkId, "floor");
        }

        expect("imageFaces" in floorArtwork(untouchedId)).toBe(false);
        const cleared = floorArtwork(clearedId);
        expect(cleared.kind).toBe("artwork");
        if (cleared.kind === "artwork") {
          expect(cleared.imageFaces).toEqual([]);
        }
      });

      it("hangs a floor work on the NEAREST placeable wall, clamped to stay fully on it", async () => {
        const artworkId = await addArtwork();
        // Deep in the south-east corner: nearest to wall-south (36.4 mm) rather
        // than wall-east (134.4 mm) or wall-north, so "nearest" is distinguishable
        // from "first in the list". Its projection lands 134.4 mm from the south
        // wall's start, which is inside the work's own half-width — without the
        // clamp it would hang off the end of the wall.
        await store.getState().placeArtworkOnFloor(artworkId, 8400, 5450);
        const before = floorArtwork(artworkId);

        await store.getState().setArtworkPlacementForm(artworkId, "wall");

        const hung = wallArtwork(artworkId);
        expect(hung.wallId).toBe("wall-south");
        expect(hung.xMm).toBe(before.widthMm / 2);
        expect(hung.yMm).toBe(before.wallYMm);
      });

      it("refuses to hang a floor work when every wall is open, changing nothing", async () => {
        const artworkId = await addArtwork();
        await store.getState().placeArtworkOnFloor(artworkId, 4000, 4000);
        // An open wall has no surface, so a floor with nothing but open walls
        // offers a standing work nowhere to go. The inspector disables the segment
        // for exactly this; the store's refusal is the backstop behind it.
        const base = store.getState().project!;
        store.setState({
          project: {
            ...base,
            floor: {
              ...base.floor,
              rooms: base.floor.rooms.map((placement) => ({
                ...placement,
                room: {
                  ...placement.room,
                  walls: placement.room.walls.map((wall) => ({ ...wall, isOpenSide: true }))
                }
              }))
            }
          }
        });
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().setArtworkPlacementForm(artworkId, "wall");

        const state = store.getState();
        expect(state.error).toBeTruthy();
        expect(state.undoStack).toHaveLength(undoStackBefore);
        expect(state.project!.wallObjects).toHaveLength(0);
        expect(state.project!.floorObjects).toHaveLength(1);
      });

      it("writes the library placementForm — and only that — while the work is unplaced", async () => {
        const artworkId = await addArtwork();
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().setArtworkPlacementForm(artworkId, "floor");

        const state = store.getState();
        expect(state.libraryArtworks.find((a) => a.id === artworkId)?.placementForm).toBe("floor");
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        expect(state.project!.floorObjects).toHaveLength(0);
        expect(state.project!.wallObjects).toHaveLength(0);
      });

      it("converts a PLACED work in one undo step, leaving the library flag alone", async () => {
        const { artworkId } = await hangArtwork(1000, 1450);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().setArtworkPlacementForm(artworkId, "floor");

        let state = store.getState();
        expect(state.undoStack).toHaveLength(undoStackBefore + 1);
        // Deliberately NOT written: updateArtwork pushes an undo entry of its own,
        // so writing it would make one click two undo steps. The placement is the
        // source of truth for a placed work.
        expect(
          state.libraryArtworks.find((a) => a.id === artworkId)?.placementForm
        ).toBeUndefined();

        await store.getState().undo();

        state = store.getState();
        expect(state.project!.floorObjects).toHaveLength(0);
        const restored = wallArtwork(artworkId);
        expect(restored.xMm).toBe(1000);
        expect(restored.yMm).toBe(1450);
      });

      it("is a no-op when the work is already on the requested surface", async () => {
        const { artworkId } = await hangArtwork(1000, 1450);
        const undoStackBefore = store.getState().undoStack.length;

        await store.getState().setArtworkPlacementForm(artworkId, "wall");

        expect(store.getState().undoStack).toHaveLength(undoStackBefore);
        expect(store.getState().project!.wallObjects).toHaveLength(1);
      });
    });

    // Opening/opening overlap is forbidden regardless of the overlap preference.
    describe("opening/opening overlap (forbidden)", () => {
      async function addTwoOpenings() {
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        await store.getState().addOpening(wall.id, "door");
        const door = store.getState().project!.wallObjects.at(-1)!;
        await store.getState().addOpening(wall.id, "window");
        const window_ = store.getState().project!.wallObjects.at(-1)!;
        return { wall, door, window_ };
      }

      it("addOpening twice lands the second opening beside the first — never overlapping", async () => {
        const { door, window_ } = await addTwoOpenings();

        expect(store.getState().project!.wallObjects).toHaveLength(2);
        expect(store.getState().error).toBeNull();

        // Edge-touch is legal.
        const doorRight = door.xMm + door.widthMm / 2;
        const windowLeft = window_.xMm - window_.widthMm / 2;
        const doorLeft = door.xMm - door.widthMm / 2;
        const windowRight = window_.xMm + window_.widthMm / 2;
        const overlap = doorLeft < windowRight && doorRight > windowLeft;
        expect(overlap).toBe(false);
      });

      it("moveOpening onto another opening is blocked even with Allow overlap on", async () => {
        const { door, window_ } = await addTwoOpenings();
        const undoBefore = store.getState().undoStack.length;

        await store.getState().moveOpening(window_.id, door.xMm, door.yMm, true);

        const state = store.getState();
        expect(state.error).toBe(FORBIDDEN_OVERLAP_MESSAGE);
        expect(state.undoStack).toHaveLength(undoBefore);
        const stillThere = state.project!.wallObjects.find((o) => o.id === window_.id)!;
        expect(stillThere.xMm).toBe(window_.xMm);
      });

      it("moving a legacy already-overlapping opening OUT of the overlap commits fine", async () => {
        // Inject legacy data that predates the overlap policy.
        const wall = getSelectedWall(store.getState().project!, store.getState().wallContextId)!;
        const project = store.getState().project!;
        const overlapping: Project = {
          ...project,
          wallObjects: [
            {
              id: "door-legacy",
              kind: "door",
              blocksPlacement: true,
              wallId: wall.id,
              xMm: 2000,
              yMm: 1015,
              widthMm: 915,
              heightMm: 2030
            },
            {
              id: "window-legacy",
              kind: "window",
              blocksPlacement: true,
              wallId: wall.id,
              xMm: 2000,
              yMm: 1450,
              widthMm: 1200,
              heightMm: 1200
            }
          ]
        };
        store.setState({ project: overlapping });
        const undoBefore = store.getState().undoStack.length;

        // The gate validates the destination, not the legacy origin.
        await store.getState().moveOpening("window-legacy", 6000, 1450, false);

        const state = store.getState();
        expect(state.error).toBeNull();
        expect(state.undoStack).toHaveLength(undoBefore + 1);
        const moved = state.project!.wallObjects.find((o) => o.id === "window-legacy")!;
        expect(moved.xMm).toBe(6000);
      });
    });

    describe("wall text", () => {
      it("places a wall text on a wall via the elevation insert path and selects it", async () => {
        await store.getState().placeOpeningOnElevation("wall-text", "wall-north", 1500, 1400);

        const state = store.getState();
        expect(state.error).toBeNull();
        const wallText = state.project!.wallObjects.find((o) => o.kind === "wall-text");
        expect(wallText).toBeDefined();
        expect(wallText!.wallId).toBe("wall-north");
        // Default size and a name, no blocksPlacement flag.
        expect(wallText!.widthMm).toBe(600);
        expect(wallText!.heightMm).toBe(400);
        expect("blocksPlacement" in wallText!).toBe(false);
        expect(state.selection).toEqual({ kind: "objects", ids: [wallText!.id] });
      });

      it("renames a wall text and resets a blank name to the default", async () => {
        await store.getState().placeOpeningOnElevation("wall-text", "wall-north", 1500, 1400);
        const id = store.getState().project!.wallObjects.find((o) => o.kind === "wall-text")!.id;

        await store.getState().renameWallText(id, "Intro panel");
        let wallText = store.getState().project!.wallObjects.find((o) => o.id === id)!;
        expect(wallText.kind === "wall-text" && wallText.name).toBe("Intro panel");

        await store.getState().renameWallText(id, "   ");
        wallText = store.getState().project!.wallObjects.find((o) => o.id === id)!;
        expect(wallText.kind === "wall-text" && wallText.name).toBe("Wall text");
      });

      it("resizes a wall text through the shared resizeOpening machinery", async () => {
        await store.getState().placeOpeningOnElevation("wall-text", "wall-north", 1500, 1400);
        const id = store.getState().project!.wallObjects.find((o) => o.kind === "wall-text")!.id;

        await store.getState().resizeOpening(id, 900, 500, false);
        const wallText = store.getState().project!.wallObjects.find((o) => o.id === id)!;
        expect(wallText.widthMm).toBe(900);
        expect(wallText.heightMm).toBe(500);
      });
    });

    // Shelves: their own wall object, whose relationship to the works standing
    // on it (its RIDERS) is derived from geometry on every path and never
    // stored — so these tests are about whether each store path rederives it
    // the same way. See domain/placement/shelfRiders.ts.
    describe("shelves", () => {
      // A placed work with known dimensions, hung on the north wall.
      async function placeWork({
        xMm,
        yMm,
        widthMm = 500,
        heightMm = 400
      }: {
        xMm: number;
        yMm: number;
        widthMm?: number;
        heightMm?: number;
      }): Promise<string> {
        await store.getState().addArtworksFromFiles([makeImageFile(`work-${xMm}-${yMm}.jpg`)]);
        const artworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm, heightMm, status: "known" }
        });
        await store.getState().placeArtwork(artworkId, "wall-north", xMm, yMm);
        return store.getState().project!.wallObjects.find(
          (object) => object.kind === "artwork" && object.artworkId === artworkId
        )!.id;
      }

      // Same as placeWork, but the record carries a 50mm mat and a 25mm frame
      // face — so its framed outer footprint is 150mm wider and taller than the
      // stored image box (75mm of band per side).
      const FRAMED_BAND_PER_SIDE_MM = 75;
      async function placeFramedWork({
        xMm,
        yMm,
        widthMm = 500,
        heightMm = 400
      }: {
        xMm: number;
        yMm: number;
        widthMm?: number;
        heightMm?: number;
      }): Promise<string> {
        await store
          .getState()
          .addArtworksFromFiles([makeImageFile(`framed-${xMm}-${yMm}.jpg`)]);
        const artworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
        await store.getState().updateArtwork(artworkId, {
          dimensions: { widthMm, heightMm, status: "known" },
          matWidthMm: 50,
          frame: { widthMm: 25, finish: "black" }
        });
        await store.getState().placeArtwork(artworkId, "wall-north", xMm, yMm);
        return store.getState().project!.wallObjects.find(
          (object) => object.kind === "artwork" && object.artworkId === artworkId
        )!.id;
      }

      function shelfOf(): ShelfWallObject {
        return store
          .getState()
          .project!.wallObjects.find((object): object is ShelfWallObject =>
            object.kind === "shelf"
          )!;
      }

      function objectById(id: string) {
        return store.getState().project!.wallObjects.find((object) => object.id === id)!;
      }

      describe("addShelfUnderWallArtwork", () => {
        it("sizes the slab from the work, seats its TOP at the work's bottom edge, and selects both", async () => {
          const workId = await placeWork({ xMm: 2000, yMm: 1500, widthMm: 600, heightMm: 400 });

          await store.getState().addShelfUnderWallArtwork(workId);

          const state = store.getState();
          expect(state.undoStack.at(-1)?.label).toBe("Add shelf");
          const shelf = shelfOf();
          expect(shelf.wallId).toBe("wall-north");
          expect(shelf.xMm).toBe(2000);
          expect(shelf.widthMm).toBe(600 + 2 * SHELF_END_MARGIN_MM);
          expect(shelf.heightMm).toBe(DEFAULT_SHELF_THICKNESS_MM);
          expect(shelf.depthMm).toBe(DEFAULT_SHELF_DEPTH_MM);
          // Top face flush with the work's bottom edge (1500 - 400/2 = 1300),
          // which is exactly what makes the work a RIDER of this shelf.
          expect(shelfTopYMm(shelf)).toBe(1300);
          expect(getShelfRiders(shelf, state.project!.wallObjects).map((r) => r.id)).toEqual([
            workId
          ]);
          // Both selected, so the next drag moves the little assembly together.
          expect(state.selection).toEqual({ kind: "objects", ids: [workId, shelf.id] });
        });

        // The framed OUTER footprint bottom is the foot, everywhere: seating
        // the slab under the stored image bottom used to leave the frame
        // overlapping the slab AND — because getShelfRiders measures the same
        // outer edge — left the work not carried by the shelf it just got.
        it("seats the slab under a framed work's OUTER bottom, and it rides", async () => {
          const workId = await placeFramedWork({
            xMm: 2000,
            yMm: 1500,
            widthMm: 600,
            heightMm: 400
          });

          await store.getState().addShelfUnderWallArtwork(workId);

          const state = store.getState();
          const shelf = shelfOf();
          // Outer bottom = 1500 - (400 + 2*75)/2 = 1225, not the image bottom
          // at 1300; outer width 600 + 150 = 750 plus the end margins.
          expect(shelfTopYMm(shelf)).toBe(1500 - (400 + 2 * FRAMED_BAND_PER_SIDE_MM) / 2);
          expect(shelf.widthMm).toBe(
            600 + 2 * FRAMED_BAND_PER_SIDE_MM + 2 * SHELF_END_MARGIN_MM
          );
          const artworksById = new Map(
            state.libraryArtworks.map((artwork) => [artwork.id, artwork])
          );
          expect(
            getShelfRiders(shelf, state.project!.wallObjects, artworksById).map((r) => r.id)
          ).toEqual([workId]);
        });

        it("does nothing for an id that is not a wall artwork", async () => {
          await store.getState().addOpening("wall-north", "shelf");
          const shelfId = shelfOf().id;

          await store.getState().addShelfUnderWallArtwork(shelfId);

          expect(
            store.getState().project!.wallObjects.filter((o) => o.kind === "shelf")
          ).toHaveLength(1);
        });
      });

      describe("updateShelf", () => {
        it("carries the riders by the same Δx and Δtop, in one undo entry", async () => {
          const workId = await placeWork({ xMm: 2000, yMm: 1500, widthMm: 600, heightMm: 400 });
          await store.getState().addShelfUnderWallArtwork(workId);
          const shelfId = shelfOf().id;
          const undoDepth = store.getState().undoStack.length;

          // Slide 300 along the wall and lift the whole slab 200 (the centre
          // moves with the top while the thickness is untouched).
          await store.getState().updateShelf(shelfId, { xMm: 2300, yMm: shelfOf().yMm + 200 });

          const shelf = shelfOf();
          expect(shelf.xMm).toBe(2300);
          expect(shelfTopYMm(shelf)).toBe(1500);
          const work = objectById(workId);
          expect(work.xMm).toBe(2300);
          expect(work.yMm).toBe(1700);
          // ONE entry: undo puts the slab and its work back together.
          expect(store.getState().undoStack.length).toBe(undoDepth + 1);
          expect(store.getState().undoStack.at(-1)?.label).toBe("Edit shelf");
          await store.getState().undo();
          expect(objectById(workId).xMm).toBe(2000);
          expect(objectById(workId).yMm).toBe(1500);
          expect(shelfOf().xMm).toBe(2000);
        });

        it("keeps the TOP fixed and leaves the riders alone for width/depth/thickness", async () => {
          const workId = await placeWork({ xMm: 2000, yMm: 1500, widthMm: 600, heightMm: 400 });
          await store.getState().addShelfUnderWallArtwork(workId);
          const shelfId = shelfOf().id;
          const workBefore = objectById(workId);

          await store
            .getState()
            .updateShelf(shelfId, { widthMm: 1600, depthMm: 250, heightMm: 80 });

          const shelf = shelfOf();
          expect(shelf.widthMm).toBe(1600);
          expect(shelf.depthMm).toBe(250);
          expect(shelf.heightMm).toBe(80);
          // A thicker slab grows DOWNWARD: the top face — and so the work
          // standing on it — does not move.
          expect(shelfTopYMm(shelf)).toBe(1300);
          expect(shelf.yMm).toBe(1300 - 40);
          const work = objectById(workId);
          expect(work.xMm).toBe(workBefore.xMm);
          expect(work.yMm).toBe(workBefore.yMm);
          // And the work is still standing on it afterwards.
          expect(
            getShelfRiders(shelf, store.getState().project!.wallObjects).map((r) => r.id)
          ).toEqual([workId]);
        });

        it("ignores a no-op edit and a non-shelf id", async () => {
          await store.getState().addOpening("wall-north", "shelf");
          const shelf = shelfOf();
          const undoDepth = store.getState().undoStack.length;

          await store.getState().updateShelf(shelf.id, { xMm: shelf.xMm, yMm: shelf.yMm });
          await store.getState().updateShelf("no-such-object", { xMm: 10 });

          expect(store.getState().undoStack.length).toBe(undoDepth);
        });

        it("leaves a work that is merely hanging near the shelf where it is", async () => {
          const workId = await placeWork({ xMm: 2000, yMm: 1500, widthMm: 600, heightMm: 400 });
          await store.getState().addShelfUnderWallArtwork(workId);
          // A second work on the same wall, well above the slab: near it, but
          // not standing on it.
          const hangingId = await placeWork({ xMm: 2000, yMm: 2200, widthMm: 400, heightMm: 300 });
          const shelfId = shelfOf().id;

          await store.getState().updateShelf(shelfId, { xMm: 2400 });

          expect(objectById(workId).xMm).toBe(2400);
          expect(objectById(hangingId).xMm).toBe(2000);
        });
      });

      describe("deleting a shelf", () => {
        it("leaves its works in place and says how many, with no confirm", async () => {
          const firstId = await placeWork({ xMm: 1800, yMm: 1500, widthMm: 400, heightMm: 400 });
          await store.getState().addShelfUnderWallArtwork(firstId);
          const shelf = shelfOf();
          // A second work standing on the same slab, seated on its top face.
          const secondId = await placeWork({
            xMm: 2100,
            yMm: shelfTopYMm(shelf) + 150,
            widthMm: 200,
            heightMm: 300
          });

          await store.getState().removePlacement(shelf.id);

          const state = store.getState();
          expect(state.project!.wallObjects.some((o) => o.kind === "shelf")).toBe(false);
          expect(objectById(firstId).xMm).toBe(1800);
          expect(objectById(secondId).xMm).toBe(2100);
          expect(state.error).toBeNull();
          expect(toast.info).toHaveBeenCalledWith("Shelf removed; 2 works left in place.");
        });

        it("says nothing when the shelf was carrying nothing", async () => {
          await store.getState().addOpening("wall-north", "shelf");

          await store.getState().removePlacement(shelfOf().id);

          expect(store.getState().error).toBeNull();
          expect(toast.info).not.toHaveBeenCalled();
        });

        it("says the same thing on the keyboard delete path", async () => {
          const workId = await placeWork({ xMm: 2000, yMm: 1500, widthMm: 600, heightMm: 400 });
          await store.getState().addShelfUnderWallArtwork(workId);
          const shelfId = shelfOf().id;
          store.getState().setObjectSelection([shelfId]);

          await store.getState().removeSelectedPlacements();

          expect(toast.info).toHaveBeenCalledWith("Shelf removed; 1 work left in place.");
          expect(store.getState().error).toBeNull();
          expect(objectById(workId).yMm).toBe(1500);
        });
      });

      describe("insert-tool placement", () => {
        it("places a shelf at the plan-chosen x on a wall anchor", async () => {
          await store
            .getState()
            .placeOpeningFromPlan("shelf", { anchor: "wall", wallId: "wall-north", xMm: 1234 });

          const state = store.getState();
          expect(state.error).toBeNull();
          expect(state.undoStack.at(-1)?.label).toBe("Add shelf");
          const shelf = shelfOf();
          expect(shelf.xMm).toBe(1234);
          expect(shelf.widthMm).toBe(DEFAULT_SHELF_WIDTH_MM);
          expect(shelfTopYMm(shelf)).toBe(DEFAULT_SHELF_TOP_MM);
          expect(state.selection).toEqual({ kind: "objects", ids: [shelf.id] });
        });

        it("places nothing on a floor click and says why", async () => {
          await store
            .getState()
            .placeOpeningFromPlan("shelf", { anchor: "floor", xMm: 2000, yMm: 3000 });

          const state = store.getState();
          expect(state.project!.wallObjects).toHaveLength(0);
          expect(state.project!.floorObjects).toHaveLength(0);
          expect(state.error).toBe("A shelf hangs on a wall. Click a wall to place it.");
        });

        it("places a shelf from elevation, centred on the clicked height", async () => {
          await store.getState().placeOpeningOnElevation("shelf", "wall-north", 1500, 900);

          const shelf = shelfOf();
          expect(shelf.xMm).toBe(1500);
          expect(shelf.yMm).toBe(900);
          expect(shelfTopYMm(shelf)).toBe(900 + DEFAULT_SHELF_THICKNESS_MM / 2);
          expect(store.getState().selection).toEqual({ kind: "objects", ids: [shelf.id] });
        });

        it("adds a shelf at the wall's midpoint from the wall path", async () => {
          const wall = getSelectedWall(store.getState().project!, "wall-north")!;

          await store.getState().addOpening("wall-north", "shelf");

          const shelf = shelfOf();
          expect(shelf.xMm).toBe(wall.lengthMm / 2);
          expect(shelfTopYMm(shelf)).toBe(DEFAULT_SHELF_TOP_MM);
        });
      });
    });
});
