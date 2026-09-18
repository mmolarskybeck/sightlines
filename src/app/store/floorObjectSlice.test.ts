// Floor object slice: editing a floor placement's own fields (position,
// size, rotation, image faces, monitor support) and the back-to-back pairing
// pose. Cross-slice flows — placing on the floor in the first place, the
// checklist-removal ripple, plan-move interactions — stay in
// ../store.test.ts, the integration suite.
import { beforeEach, describe, expect, it } from "vitest";
import { makeImageFile } from "../../test/inMemoryRepositories";
import { createTestAppStore } from "../../test/testAppStore";
import { createAppStore } from "../store";
import { DEFAULT_SUSPENSION_HEIGHT_MM } from "./floorObjectSlice";

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

    // Floor supports: the four-state "Stands on" choice and the support box's
    // own numbers. The relational invariants themselves are the domain
    // normaliser's (geometry/supportGlyphs.test.ts) — what is tested here is
    // that every write runs them, in ONE undo entry, and clears the keys the
    // losing state owned.
    describe("setFloorArtworkStandsOn", () => {
      async function placeSculpture(): Promise<string> {
        await store.getState().addArtworksFromFiles([makeImageFile("bronze.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          displayAs: "sculpture",
          dimensions: { widthMm: 400, heightMm: 600, depthMm: 400, status: "known" }
        });
        await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
        return store.getState().project!.floorObjects[0].id;
      }

      async function placeMonitor(): Promise<string> {
        await store.getState().addArtworksFromFiles([makeImageFile("crt.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          displayAs: "monitor",
          dimensions: { widthMm: 400, heightMm: 300, status: "known" }
        });
        await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
        return store.getState().project!.floorObjects[0].id;
      }

      function artworkObject(id: string) {
        const object = store.getState().project!.floorObjects.find((o) => o.id === id)!;
        if (object.kind !== "artwork") throw new Error("not an artwork placement");
        return object;
      }

      it("puts a work on a pedestal that already contains it, in one undo entry", async () => {
        const objectId = await placeSculpture();
        const undoDepth = store.getState().undoStack.length;

        await store.getState().setFloorArtworkStandsOn(objectId, "pedestal");

        expect(store.getState().undoStack).toHaveLength(undoDepth + 1);
        expect(store.getState().undoStack.at(-1)?.label).toBe("Change support");
        const support = artworkObject(objectId).support!;
        expect(support.kind).toBe("pedestal");
        // 400mm work + 100mm reveal per side.
        expect(support.widthMm).toBe(600);
        expect(support.depthMm).toBe(600);
        // Nothing displaced, so no offset keys at all — absence is how this
        // codebase records "not displaced".
        expect("offsetXMm" in support).toBe(false);
        expect("offsetYMm" in support).toBe(false);
      });

      it("seeds a plinth low and wide instead", async () => {
        const objectId = await placeSculpture();

        await store.getState().setFloorArtworkStandsOn(objectId, "plinth");

        const support = artworkObject(objectId).support!;
        expect(support.kind).toBe("plinth");
        expect(support.widthMm).toBe(700);
        expect(support.heightMm).toBe(150);
      });

      // The four states exclude each other, so each transition has to DELETE
      // the losing state's keys — checked with `in`, not `=== undefined`: a key
      // present and undefined is not the same document as a key absent.
      it("clears the suspension height when a support goes in, and vice versa", async () => {
        const objectId = await placeSculpture();
        await store.getState().updateFloorObject(objectId, { baseHeightMm: 1200 });

        await store.getState().setFloorArtworkStandsOn(objectId, "pedestal");
        expect("baseHeightMm" in artworkObject(objectId)).toBe(false);

        await store.getState().setFloorArtworkStandsOn(objectId, "suspended");
        const suspended = artworkObject(objectId);
        expect("support" in suspended).toBe(false);
        // The height the work hung at before the pedestal is gone with it, so
        // the state's own default takes over.
        expect(suspended.baseHeightMm).toBe(DEFAULT_SUSPENSION_HEIGHT_MM);
      });

      it("takes a work back down to the bare floor with no leftover keys", async () => {
        const objectId = await placeSculpture();
        await store.getState().setFloorArtworkStandsOn(objectId, "pedestal");

        await store.getState().setFloorArtworkStandsOn(objectId, "floor");

        const object = artworkObject(objectId);
        expect("support" in object).toBe(false);
        expect("baseHeightMm" in object).toBe(false);
        // Not a monitor, so it gains no monitorSupport key it would never read.
        expect("monitorSupport" in object).toBe(false);
      });

      // A monitor's absent monitorSupport RESOLVES to a pedestal, so "Floor"
      // has to be stated explicitly or the choice would resolve straight back.
      it("states a monitor's bare floor explicitly", async () => {
        const objectId = await placeMonitor();

        await store.getState().setFloorArtworkStandsOn(objectId, "floor");

        const object = artworkObject(objectId);
        expect(object.monitorSupport).toBe("floor");
        expect("support" in object).toBe(false);
      });

      // An untouched monitor is ALREADY standing on its 800mm pedestal, so
      // re-choosing Pedestal must not push a dead undo entry — and choosing it
      // after "Floor" reproduces exactly the cabinet-width geometry the
      // 2026-08-28 decision settled.
      it("leaves an untouched monitor alone and reproduces its own pedestal", async () => {
        const objectId = await placeMonitor();
        const undoDepth = store.getState().undoStack.length;
        const cabinet = artworkObject(objectId);

        await store.getState().setFloorArtworkStandsOn(objectId, "pedestal");
        expect(store.getState().undoStack).toHaveLength(undoDepth);

        await store.getState().setFloorArtworkStandsOn(objectId, "floor");
        await store.getState().setFloorArtworkStandsOn(objectId, "pedestal");
        const support = artworkObject(objectId).support!;
        expect(support.widthMm).toBe(cabinet.widthMm);
        expect(support.depthMm).toBe(cabinet.depthMm);
        expect(support.heightMm).toBe(800);
        // The explicit "floor" is gone: it would contradict the pedestal now
        // under the cabinet.
        expect("monitorSupport" in artworkObject(objectId)).toBe(false);
      });

      it("never suspends a monitor", async () => {
        const objectId = await placeMonitor();
        const undoDepth = store.getState().undoStack.length;

        await store.getState().setFloorArtworkStandsOn(objectId, "suspended");

        expect(store.getState().undoStack).toHaveLength(undoDepth);
        expect("baseHeightMm" in artworkObject(objectId)).toBe(false);
      });

      it("is a no-op for a non-artwork placement or an unknown id", async () => {
        const objectId = await placeSculpture();
        const before = store.getState().project!.floorObjects;
        const undoDepth = store.getState().undoStack.length;

        await store.getState().setFloorArtworkStandsOn("missing-id", "pedestal");
        // Already on the floor.
        await store.getState().setFloorArtworkStandsOn(objectId, "floor");

        expect(store.getState().project!.floorObjects).toEqual(before);
        expect(store.getState().undoStack).toHaveLength(undoDepth);
      });
    });

    describe("updateFloorArtworkSupport", () => {
      async function placeOnPedestal(): Promise<string> {
        await store.getState().addArtworksFromFiles([makeImageFile("bronze.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          displayAs: "sculpture",
          dimensions: { widthMm: 400, heightMm: 600, depthMm: 400, status: "known" }
        });
        await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
        const objectId = store.getState().project!.floorObjects[0].id;
        await store.getState().setFloorArtworkStandsOn(objectId, "pedestal");
        return objectId;
      }

      function support(objectId: string) {
        const object = store.getState().project!.floorObjects.find((o) => o.id === objectId)!;
        if (object.kind !== "artwork") throw new Error("not an artwork placement");
        return object.support!;
      }

      it("clamps a support typed narrower than the work back up to it", async () => {
        const objectId = await placeOnPedestal();
        const undoDepth = store.getState().undoStack.length;

        await store.getState().updateFloorArtworkSupport(objectId, { widthMm: 200 });

        expect(store.getState().undoStack).toHaveLength(undoDepth + 1);
        expect(store.getState().undoStack.at(-1)?.label).toBe("Edit support");
        // Grow the support, never shrink the work.
        expect(support(objectId).widthMm).toBe(400);
      });

      it("clamps an offset that would push the work off the support, writing 0 as absent", async () => {
        const objectId = await placeOnPedestal();

        // Bound is (600 − 400) / 2 = 100.
        await store.getState().updateFloorArtworkSupport(objectId, { offsetXMm: 5000 });
        expect(support(objectId).offsetXMm).toBe(100);

        await store.getState().updateFloorArtworkSupport(objectId, { offsetXMm: 0 });
        expect("offsetXMm" in support(objectId)).toBe(false);
      });

      // Enabling the bonnet is one entry that also grows the support to the
      // glass-and-clearance box and clears overhang: half of it undone would
      // leave a work pressed into its own glass.
      it("enabling the bonnet normalises size, height and overhang in ONE entry", async () => {
        const objectId = await placeOnPedestal();
        await store.getState().updateFloorArtworkSupport(objectId, {
          overhangAllowed: true,
          widthMm: 300
        });
        const undoDepth = store.getState().undoStack.length;

        // A wild height on the ENABLE write, to prove the normaliser derives
        // rather than trusts: enabling does not lock, and an unlocked height is
        // always the work's height plus the headroom.
        await store.getState().updateFloorArtworkSupport(objectId, { bonnetHeightMm: 5000 });

        expect(store.getState().undoStack).toHaveLength(undoDepth + 1);
        const next = support(objectId);
        // Derived from the work (600 + 75), not from the number sent.
        expect(next.bonnetHeightMm).toBe(675);
        expect("bonnetHeightLocked" in next).toBe(false);
        // A bonnet CLEARS overhang — the key is deleted, not set false.
        expect("overhangAllowed" in next).toBe(false);
        // Work + glass + clearance per side.
        expect(next.widthMm).toBeGreaterThan(400);
      });

      it("re-derives an unlocked bonnet height and ignores the number sent", async () => {
        const objectId = await placeOnPedestal();
        await store.getState().updateFloorArtworkSupport(objectId, { bonnetHeightMm: 675 });

        // Same write shape the inspector's height field sends, but the bonnet
        // was already on, so this one LOCKS.
        await store.getState().updateFloorArtworkSupport(objectId, { bonnetHeightMm: 900 });
        expect(support(objectId).bonnetHeightMm).toBe(900);
        expect(support(objectId).bonnetHeightLocked).toBe(true);

        // Fit to work: hand the height back and it re-derives.
        await store.getState().updateFloorArtworkSupport(objectId, {
          bonnetHeightLocked: false
        });
        expect(support(objectId).bonnetHeightMm).toBe(675);
      });

      it("turning the bonnet off deletes both the height and its lock", async () => {
        const objectId = await placeOnPedestal();
        await store.getState().updateFloorArtworkSupport(objectId, { bonnetHeightMm: 675 });
        await store.getState().updateFloorArtworkSupport(objectId, { bonnetHeightMm: 900 });
        expect(support(objectId).bonnetHeightLocked).toBe(true);

        await store.getState().updateFloorArtworkSupport(objectId, {
          bonnetHeightMm: undefined
        });

        const next = support(objectId);
        expect("bonnetHeightMm" in next).toBe(false);
        expect("bonnetHeightLocked" in next).toBe(false);
      });

      // The support's invariants are stated against the WORK, so resizing the
      // work has to re-fit the support inside the SAME entry.
      it("re-normalises the support when the work is resized, in the size edit's own entry", async () => {
        const objectId = await placeOnPedestal();
        const undoDepth = store.getState().undoStack.length;

        await store.getState().updateFloorObject(objectId, { widthMm: 900 });

        expect(store.getState().undoStack).toHaveLength(undoDepth + 1);
        expect(support(objectId).widthMm).toBe(900);
      });

      it("re-derives an unlocked bonnet when the work gets taller, in the same entry", async () => {
        const objectId = await placeOnPedestal();
        await store.getState().updateFloorArtworkSupport(objectId, { bonnetHeightMm: 675 });
        const undoDepth = store.getState().undoStack.length;

        await store.getState().updateFloorObject(objectId, { heightMm: 1000 });

        expect(store.getState().undoStack).toHaveLength(undoDepth + 1);
        expect(support(objectId).bonnetHeightMm).toBe(1075);
      });

      // A LOCKED bonnet is the curator's number and is never grown (USER
      // DECISION 2026-09-17) — the inspector warns instead.
      it("leaves a locked bonnet alone when the work outgrows it", async () => {
        const objectId = await placeOnPedestal();
        await store.getState().updateFloorArtworkSupport(objectId, { bonnetHeightMm: 675 });
        await store.getState().updateFloorArtworkSupport(objectId, { bonnetHeightMm: 700 });

        await store.getState().updateFloorObject(objectId, { heightMm: 1000 });

        expect(support(objectId).bonnetHeightMm).toBe(700);
      });

      it("pushes no undo entry when a write changes nothing", async () => {
        const objectId = await placeOnPedestal();
        const undoDepth = store.getState().undoStack.length;

        await store.getState().updateFloorArtworkSupport(objectId, {
          widthMm: support(objectId).widthMm
        });

        expect(store.getState().undoStack).toHaveLength(undoDepth);
      });

      it("does nothing for a placement with no support to edit", async () => {
        await store.getState().addArtworksFromFiles([makeImageFile("flat.jpg")]);
        const artworkId = store.getState().project!.checklistArtworkIds[0];
        await store.getState().updateArtwork(artworkId, {
          displayAs: "sculpture",
          dimensions: { widthMm: 400, heightMm: 600, depthMm: 400, status: "known" }
        });
        await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
        const objectId = store.getState().project!.floorObjects[0].id;
        const undoDepth = store.getState().undoStack.length;

        await store.getState().updateFloorArtworkSupport(objectId, { widthMm: 900 });

        expect(store.getState().undoStack).toHaveLength(undoDepth);
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
