// Floor object slice: editing a floor placement's own fields (position,
// size, rotation, image faces, monitor support) and the back-to-back pairing
// pose. Cross-slice flows — placing on the floor in the first place, the
// checklist-removal ripple, plan-move interactions — stay in
// ../store.test.ts, the integration suite.
import { beforeEach, describe, expect, it } from "vitest";
import { makeImageFile } from "../../test/inMemoryRepositories";
import { createTestAppStore } from "../../test/testAppStore";
import { createAppStore } from "../store";

describe("floor object slice", () => {
  let store: ReturnType<typeof createAppStore>;

  beforeEach(async () => {
    const testStore = createTestAppStore();
    store = testStore.store;
    await store.getState().boot();
  });

    describe("pairFloorArtworksBackToBack", () => {
      // Two different works on opposite sides of one panel (the suspended
      // projection-board rig): each stays an ordinary independent floor
      // placement; the action is a one-shot pose snap, not a persistent link.
      async function placeTwoFloorArtworks() {
        await store
          .getState()
          .addArtworksFromFiles([makeImageFile("side-a.jpg"), makeImageFile("side-b.jpg")]);
        const [anchorArtworkId, movingArtworkId] =
          store.getState().project!.checklistArtworkIds;
        await store.getState().updateArtwork(anchorArtworkId, {
          dimensions: { widthMm: 1000, heightMm: 800, depthMm: 100, status: "known" }
        });
        await store.getState().updateArtwork(movingArtworkId, {
          dimensions: { widthMm: 600, heightMm: 500, depthMm: 60, status: "known" }
        });
        await store.getState().placeArtworkOnFloor(anchorArtworkId, 1000, 1000);
        await store.getState().placeArtworkOnFloor(movingArtworkId, 5000, 5000);
        const [anchor, moving] = store.getState().project!.floorObjects;
        return { anchorId: anchor.id, movingId: moving.id };
      }

      function floorObjectById(id: string) {
        return store.getState().project!.floorObjects.find((object) => object.id === id)!;
      }

      it("snaps the moving board flat against the anchor's back, turned 180°, faces outward", async () => {
        const { anchorId, movingId } = await placeTwoFloorArtworks();

        await store.getState().pairFloorArtworksBackToBack(anchorId, movingId);

        expect(store.getState().undoStack.at(-1)?.label).toBe("Pair works back-to-back");
        const anchor = floorObjectById(anchorId);
        const moving = floorObjectById(movingId);
        // At rotation 0 the anchor's back is plan -y; centers separate by the
        // two half-depths (50 + 30) so the boards' faces touch.
        expect(anchor.xMm).toBe(1000);
        expect(anchor.yMm).toBe(1000);
        expect(moving.xMm).toBeCloseTo(1000);
        expect(moving.yMm).toBeCloseTo(920);
        expect(moving.rotationDeg).toBe(180);
        // Each keeps its faces minus "back", which now presses against the other
        // board: absent (front+back default) resolves to a stated ["front"].
        if (anchor.kind === "artwork" && moving.kind === "artwork") {
          expect(anchor.imageFaces).toEqual(["front"]);
          expect(moving.imageFaces).toEqual(["front"]);
        }
        // Both resting on the floor: the never-suspended mover must not gain a
        // spurious baseHeightMm key (absence encodes "never chosen").
        expect("baseHeightMm" in moving).toBe(false);
      });

      it("follows the anchor's rotation and aligns tops under a suspended anchor", async () => {
        const { anchorId, movingId } = await placeTwoFloorArtworks();
        await store
          .getState()
          .updateFloorObject(anchorId, { rotationDeg: 30, baseHeightMm: 1200 });

        await store.getState().pairFloorArtworksBackToBack(anchorId, movingId);

        const moving = floorObjectById(movingId);
        // Back normal at 30° is (sin 30°, -cos 30°); centers 80mm apart.
        expect(moving.xMm).toBeCloseTo(1000 + 80 * Math.sin(Math.PI / 6));
        expect(moving.yMm).toBeCloseTo(1000 - 80 * Math.cos(Math.PI / 6));
        expect(moving.rotationDeg).toBe(210);
        // Shared hanging rig: top edges align. 1200 + 800 (anchor) - 500 (mover).
        expect(moving.baseHeightMm).toBe(1500);
      });

      it("keeps stated extra faces and only strips the hidden back face", async () => {
        const { anchorId, movingId } = await placeTwoFloorArtworks();
        await store
          .getState()
          .setFloorArtworkImageFaces(anchorId, ["front", "back", "top"]);

        await store.getState().pairFloorArtworksBackToBack(anchorId, movingId);

        const anchor = floorObjectById(anchorId);
        if (anchor.kind === "artwork") {
          expect(anchor.imageFaces).toEqual(["front", "top"]);
        }
      });

      it("does nothing for a non-artwork member or an unknown id", async () => {
        const { anchorId } = await placeTwoFloorArtworks();
        const before = store.getState().project!.floorObjects;
        const undoDepth = store.getState().undoStack.length;

        await store.getState().pairFloorArtworksBackToBack(anchorId, "missing-id");
        await store.getState().pairFloorArtworksBackToBack(anchorId, anchorId);

        expect(store.getState().project!.floorObjects).toEqual(before);
        expect(store.getState().undoStack.length).toBe(undoDepth);
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
});
