// Floor object slice: editing a floor placement's own fields (position,
// size, rotation, image faces) and the back-to-back pairing pose. What a work
// STANDS ON is no longer written here at all — it is derived from geometry
// (floor-supports spec §2/§3, placement/floorRiders.ts). Cross-slice flows — placing on the floor in the first place, the
// checklist-removal ripple, plan-move interactions — stay in
// ../store.test.ts, the integration suite.
import { beforeEach, describe, expect, it } from "vitest";
import { makeImageFile } from "../../test/inMemoryRepositories";
import { createTestAppStore } from "../../test/testAppStore";
import { createAppStore } from "../store";
import { DEFAULT_SUSPENSION_HEIGHT_MM } from "./floorObjectSlice";
import {
  BONNET_CLEARANCE_MM,
  BONNET_HEADROOM_MM,
  PEDESTAL_FALLBACK_HEIGHT_MM,
  PEDESTAL_MARGIN_MM,
  PEDESTAL_MAX_HEIGHT_MM,
  PLINTH_DEFAULT_HEIGHT_MM
} from "../../domain/geometry/supportGlyphs";
import { CASE_GLASS_THICKNESS_MM } from "../../domain/geometry/caseGlyphs";
import { MONITOR_PEDESTAL_HEIGHT_MM } from "../../domain/geometry/monitorGlyphs";
import type { SupportFloorObject } from "../../domain/project";

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
  // ─── Floor supports (floor-supports spec §4/§5/§7) ────────────────────────
  //
  // A pedestal is its own floor object and what stands on it is DERIVED from
  // geometry, so every one of these actions is tested by what it does to the
  // GEOMETRY — never by a stored relationship, because there is none.
  describe("floor supports", () => {
    async function placeWork(
      dimensions: { widthMm: number; heightMm: number; depthMm?: number },
      { xMm = 1000, yMm = 1000, displayAs }: { xMm?: number; yMm?: number; displayAs?: "monitor" } = {}
    ) {
      await store.getState().addArtworksFromFiles([makeImageFile(`w-${xMm}-${yMm}.jpg`)]);
      const artworkId = store.getState().project!.checklistArtworkIds.at(-1)!;
      await store.getState().updateArtwork(artworkId, {
        dimensions: { ...dimensions, status: "known" },
        ...(displayAs ? { displayAs } : {})
      });
      await store.getState().placeArtworkOnFloor(artworkId, xMm, yMm);
      // LAST: a monitor arrives with its pedestal inserted immediately before it.
      return { artworkId, objectId: store.getState().project!.floorObjects.at(-1)!.id };
    }

    const floorObjects = () => store.getState().project!.floorObjects;
    const byId = (id: string) => floorObjects().find((object) => object.id === id)!;
    const supports = () =>
      floorObjects().filter((object) => object.kind === "support") as SupportFloorObject[];

    describe("putFloorArtworkOnSupport", () => {
      it("inserts the pedestal BEFORE the work, centred on it, and stands the work on it", async () => {
        const { objectId } = await placeWork({ widthMm: 400, heightMm: 300, depthMm: 200 });

        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");

        expect(store.getState().undoStack.at(-1)?.label).toBe("Put on pedestal");
        const objects = floorObjects();
        expect(objects).toHaveLength(2);
        const [support, work] = objects;
        expect(support.kind).toBe("support");
        expect(work.id).toBe(objectId);
        // Centred on the work, at its angle, with the margin reveal.
        expect(support).toMatchObject({
          supportKind: "pedestal",
          xMm: 1000,
          yMm: 1000,
          rotationDeg: 0,
          widthMm: 400 + PEDESTAL_MARGIN_MM * 2,
          depthMm: 200 + PEDESTAL_MARGIN_MM * 2
        });
        // The work's bottom edge IS the top face — the whole relationship.
        expect(work.baseHeightMm).toBe(support.heightMm);
      });

      it("keeps a suspended work's height, clamped to what a pedestal can be", async () => {
        const { objectId } = await placeWork({ widthMm: 400, heightMm: 300 });
        await store.getState().updateFloorObject(objectId, { baseHeightMm: 2500 });

        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");

        expect(supports()[0].heightMm).toBe(PEDESTAL_MAX_HEIGHT_MM);
        expect(byId(objectId).baseHeightMm).toBe(PEDESTAL_MAX_HEIGHT_MM);
      });

      it("a plinth keeps the plinth default even under a suspended work", async () => {
        const { objectId } = await placeWork({ widthMm: 400, heightMm: 300 });
        await store.getState().updateFloorObject(objectId, { baseHeightMm: 900 });

        await store.getState().putFloorArtworkOnSupport(objectId, "plinth");

        expect(supports()[0]).toMatchObject({
          supportKind: "plinth",
          heightMm: PLINTH_DEFAULT_HEIGHT_MM
        });
        expect(byId(objectId).baseHeightMm).toBe(PLINTH_DEFAULT_HEIGHT_MM);
      });

      it("gives a box monitor the cabinet footprint at the 800mm monitor height", async () => {
        const { objectId } = await placeWork(
          { widthMm: 500, heightMm: 400 },
          { displayAs: "monitor" }
        );
        // The checklist drop already gave it one; take it off first so this
        // tests the inspector action rather than the placement path.
        await store.getState().setFloorArtworkOnFloor(objectId);
        const cabinet = byId(objectId);

        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");

        const pedestal = supports().at(-1)!;
        expect(pedestal).toMatchObject({
          heightMm: MONITOR_PEDESTAL_HEIGHT_MM,
          widthMm: cabinet.widthMm,
          depthMm: cabinet.depthMm
        });
      });
    });

    describe("setFloorArtworkOnFloor / suspendFloorArtwork", () => {
      it("DELETES baseHeightMm rather than writing 0, and leaves the pedestal standing", async () => {
        const { objectId } = await placeWork({ widthMm: 400, heightMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");

        await store.getState().setFloorArtworkOnFloor(objectId);

        expect(store.getState().undoStack.at(-1)?.label).toBe("Set on floor");
        expect("baseHeightMm" in byId(objectId)).toBe(false);
        expect(supports()).toHaveLength(1);
      });

      it("suspends at the default height", async () => {
        const { objectId } = await placeWork({ widthMm: 400, heightMm: 300 });

        await store.getState().suspendFloorArtwork(objectId);

        expect(byId(objectId).baseHeightMm).toBe(DEFAULT_SUSPENSION_HEIGHT_MM);
      });

      it("refuses to suspend a box monitor", async () => {
        const { objectId } = await placeWork(
          { widthMm: 500, heightMm: 400 },
          { displayAs: "monitor" }
        );
        const before = byId(objectId).baseHeightMm;
        const undoBefore = store.getState().undoStack.length;

        await store.getState().suspendFloorArtwork(objectId);

        expect(byId(objectId).baseHeightMm).toBe(before);
        expect(store.getState().undoStack).toHaveLength(undoBefore);
      });
    });

    describe("centerFloorArtworkOnSupport", () => {
      it("moves the work to its support's centre", async () => {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");
        // Nudge the work off-centre WITHOUT moving the pedestal.
        await store.getState().updateFloorObject(objectId, { xMm: 1120 });

        await store.getState().centerFloorArtworkOnSupport(objectId);

        expect(byId(objectId).xMm).toBe(1000);
      });

      it("does nothing for a work that stands on nothing", async () => {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300 });
        const undoBefore = store.getState().undoStack.length;

        await store.getState().centerFloorArtworkOnSupport(objectId);

        expect(store.getState().undoStack).toHaveLength(undoBefore);
      });
    });

    describe("updateFloorObject on a support carries its riders", () => {
      async function pedestalWithRider() {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300, depthMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");
        return { workId: objectId, supportId: supports()[0].id };
      }

      it("translates the works with the box", async () => {
        const { workId, supportId } = await pedestalWithRider();
        const undoBefore = store.getState().undoStack.length;

        await store.getState().updateFloorObject(supportId, { xMm: 3000, yMm: 2000 });

        expect(byId(workId)).toMatchObject({ xMm: 3000, yMm: 2000 });
        // ONE undo entry for the whole assembly.
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
      });

      it("rotates rider centres about the support centre AND turns each rider", async () => {
        const { workId, supportId } = await pedestalWithRider();
        await store.getState().updateFloorObject(workId, { xMm: 1100 });

        await store.getState().updateFloorObject(supportId, { rotationDeg: 90 });

        const rider = byId(workId);
        expect(rider.xMm).toBeCloseTo(1000, 6);
        expect(rider.yMm).toBeCloseTo(1100, 6);
        expect(rider.rotationDeg).toBe(90);
      });

      it("re-seats the riders when the top face moves", async () => {
        const { workId, supportId } = await pedestalWithRider();

        await store.getState().updateFloorObject(supportId, { heightMm: 700 });

        expect(byId(workId).baseHeightMm).toBe(700);
      });

      it("resizing the box moves nothing", async () => {
        const { workId, supportId } = await pedestalWithRider();
        const before = byId(workId);

        await store.getState().updateFloorObject(supportId, { widthMm: 1200, depthMm: 900 });

        expect(byId(workId)).toMatchObject({
          xMm: before.xMm,
          yMm: before.yMm,
          baseHeightMm: before.baseHeightMm
        });
      });
    });

    describe("setSupportKind", () => {
      it("re-applies the new kind's default while the height is still the old default", async () => {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "plinth");
        const supportId = supports()[0].id;
        expect(supports()[0].heightMm).toBe(PLINTH_DEFAULT_HEIGHT_MM);

        await store.getState().setSupportKind(supportId, "pedestal");

        expect(supports()[0]).toMatchObject({
          supportKind: "pedestal",
          heightMm: PEDESTAL_FALLBACK_HEIGHT_MM
        });
        // The rider follows the top face.
        expect(byId(objectId).baseHeightMm).toBe(PEDESTAL_FALLBACK_HEIGHT_MM);
      });

      it("keeps a typed height through the relabel", async () => {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "plinth");
        const supportId = supports()[0].id;
        await store.getState().updateFloorObject(supportId, { heightMm: 420 });

        await store.getState().setSupportKind(supportId, "pedestal");

        expect(supports()[0]).toMatchObject({ supportKind: "pedestal", heightMm: 420 });
        expect(byId(objectId).baseHeightMm).toBe(420);
      });
    });

    describe("setSupportBonnet", () => {
      async function pedestalWithRider() {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300, depthMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");
        return { workId: objectId, supportId: supports()[0].id };
      }

      it("enabling grows the footprint to clear the glass and clears overhang", async () => {
        const { supportId } = await pedestalWithRider();
        await store.getState().setSupportOverhangAllowed(supportId, true);
        // Shrink the box so the rider needs the glass clearance to be added.
        await store.getState().updateFloorObject(supportId, { widthMm: 320, depthMm: 320 });

        await store.getState().setSupportBonnet(supportId, { enabled: true });

        const support = supports()[0];
        const insetMm = CASE_GLASS_THICKNESS_MM + BONNET_CLEARANCE_MM;
        expect(support.widthMm).toBe(300 + insetMm * 2);
        expect(support.depthMm).toBe(300 + insetMm * 2);
        // The key is DELETED, not set false, so removing the bonnet later
        // restores "never chosen".
        expect("overhangAllowed" in support).toBe(false);
        // Derived (unlocked) height tracks the tallest rider.
        expect(support.bonnetHeightMm).toBe(300 + BONNET_HEADROOM_MM);
        expect(support.bonnetHeightLocked).toBeUndefined();
      });

      it("never shrinks a footprint that is already big enough", async () => {
        const { supportId } = await pedestalWithRider();
        const before = supports()[0];

        await store.getState().setSupportBonnet(supportId, { enabled: true });

        expect(supports()[0].widthMm).toBe(before.widthMm);
      });

      it("typing a height locks it — but only once a bonnet exists", async () => {
        const { supportId } = await pedestalWithRider();

        // Enabling carries the derived height: that write must NOT lock.
        await store.getState().setSupportBonnet(supportId, { enabled: true });
        expect(supports()[0].bonnetHeightLocked).toBeUndefined();

        await store.getState().setSupportBonnet(supportId, { heightMm: 900 });
        expect(supports()[0]).toMatchObject({ bonnetHeightMm: 900, bonnetHeightLocked: true });
      });

      it("disabling deletes both bonnet keys", async () => {
        const { supportId } = await pedestalWithRider();
        await store.getState().setSupportBonnet(supportId, { enabled: true });
        await store.getState().setSupportBonnet(supportId, { heightMm: 900 });

        await store.getState().setSupportBonnet(supportId, { enabled: false });

        const support = supports()[0];
        expect("bonnetHeightMm" in support).toBe(false);
        expect("bonnetHeightLocked" in support).toBe(false);
      });
    });

    describe("setSupportOverhangAllowed", () => {
      it("turning it off grows the box until the works are on the top face", async () => {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300, depthMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");
        const supportId = supports()[0].id;
        await store.getState().setSupportOverhangAllowed(supportId, true);
        // Slide the work 200mm off-centre, which overhang allows.
        await store.getState().updateFloorObject(objectId, { xMm: 1200 });

        await store.getState().setSupportOverhangAllowed(supportId, false);

        const support = supports()[0];
        expect(support.overhangAllowed).toBe(false);
        // 200 off-centre + 150 half-width = 350 of reach, doubled.
        expect(support.widthMm).toBe(700);
      });
    });

    describe("fitSupportToWorks", () => {
      it("grows to the works' union plus the kind's reveal", async () => {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300, depthMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");
        const supportId = supports()[0].id;
        await store.getState().updateFloorObject(supportId, { widthMm: 320, depthMm: 320 });

        await store.getState().fitSupportToWorks(supportId);

        expect(supports()[0]).toMatchObject({
          widthMm: 300 + PEDESTAL_MARGIN_MM * 2,
          depthMm: 300 + PEDESTAL_MARGIN_MM * 2
        });
      });

      it("never shrinks", async () => {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300, depthMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");
        const supportId = supports()[0].id;
        await store.getState().updateFloorObject(supportId, { widthMm: 2000, depthMm: 2000 });

        await store.getState().fitSupportToWorks(supportId);

        expect(supports()[0]).toMatchObject({ widthMm: 2000, depthMm: 2000 });
      });

      it("is a no-op with no works on it", async () => {
        const { objectId } = await placeWork({ widthMm: 300, heightMm: 300 });
        await store.getState().putFloorArtworkOnSupport(objectId, "pedestal");
        const supportId = supports()[0].id;
        await store.getState().setFloorArtworkOnFloor(objectId);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().fitSupportToWorks(supportId);

        expect(store.getState().undoStack).toHaveLength(undoBefore);
      });
    });
  });
});
