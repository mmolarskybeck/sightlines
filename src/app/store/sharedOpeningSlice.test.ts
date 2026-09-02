// Shared opening slice: the five resolver actions (Stage 6 — "Resolver")
// that let the user pick how a one-sided or mismatched opening at a real
// shared boundary gets settled. Legacy pair carve-outs (a connectsToObjectId
// pair on walls that are NOT a shared boundary) and the addOpening/moveOpening
// mirroring these resolvers build on top of stay in ../store.test.ts (the
// legacy tests) and ./placementSlice.test.ts ("shared wall opening
// mirroring"), since several of those tests pose a placementSlice action
// alongside a resolver action in one case.
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateOpeningPair } from "../../domain/geometry/openingConnections";
import { createTestAppStore } from "../../test/testAppStore";
import {
  A_EAST,
  A_NORTH,
  abuttingRooms,
  B_WEST,
  partnerOfId,
  type RoomSpec,
  sharedPairOnBoundary,
  TWO_ROOMS
} from "../../test/storeFixtures";
import { createAppStore } from "../store";

describe("shared opening slice", () => {
  let store: ReturnType<typeof createAppStore>;

  beforeEach(async () => {
    const testStore = createTestAppStore();
    store = testStore.store;
    await store.getState().boot();
  });

  const C_WEST = "room-c-wall-west";
  // room-c overlaps room-b, so both back the whole of room-a's east wall —
  // which is what makes the boundary genuinely ambiguous, the only state that
  // offers a bare wall as a target.
  const AMBIGUOUS_ROOMS: RoomSpec[] = [...TWO_ROOMS, { roomId: "room-c", offsetXMm: 4100 }];

    describe("resolutions on a live shared boundary", () => {
      it("adopts the facing opening the user picked, in one undo step", async () => {
        abuttingRooms(store, [
          { id: "door-a", wallId: A_EAST, xMm: 1200 },
          { id: "door-b", wallId: B_WEST, xMm: 1800 }
        ]);
        const undoBefore = store.getState().undoStack.length;

        await store
          .getState()
          .resolveSharedOpening("door-a", { kind: "opening", openingId: "door-b" });

        expect(partnerOfId(store, "door-a")).toBe("door-b");
        expect(partnerOfId(store, "door-b")).toBe("door-a");
        expect(store.getState().project!.wallObjects).toHaveLength(2);
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
        expect(store.getState().undoStack.at(-1)?.label).toBe("Resolve shared door");
      });

      it("creates the twin on a bare wall the user picked, in one undo step", async () => {
        // The {kind:"wall"} branch, and the only thing that makes an ambiguous
        // boundary between two EMPTY walls resolvable at all.
        abuttingRooms(store, [{ id: "door-a", wallId: A_EAST, xMm: 1200 }], AMBIGUOUS_ROOMS);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().resolveSharedOpening("door-a", { kind: "wall", wallId: C_WEST });

        const objects = store.getState().project!.wallObjects;
        expect(objects).toHaveLength(2);
        const twin = objects.find((object) => object.wallId === C_WEST)!;
        expect(twin.kind).toBe("door");
        expect(twin.xMm).toBeCloseTo(1800);
        expect(partnerOfId(store, "door-a")).toBe(twin.id);
        expect(partnerOfId(store, twin.id)).toBe("door-a");
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
        expect(store.getState().undoStack.at(-1)?.label).toBe("Resolve shared door");

        await store.getState().undo();
        expect(store.getState().project!.wallObjects).toHaveLength(1);
      });

      it("refuses a target the current project does not offer, committing nothing", async () => {
        // door-n passes every one of the resolver's own guards — a door, same
        // kind, a different perimeter wall, unpaired. Only the candidate list
        // knows it is not a face of this opening.
        abuttingRooms(store, [
          { id: "door-a", wallId: A_EAST, xMm: 1200 },
          { id: "door-b", wallId: B_WEST, xMm: 1800 },
          { id: "door-n", wallId: A_NORTH, xMm: 1200 }
        ]);
        const before = store.getState().project!.wallObjects;
        const undoBefore = store.getState().undoStack.length;

        await store
          .getState()
          .resolveSharedOpening("door-a", { kind: "opening", openingId: "door-n" });

        expect(store.getState().error).toMatch(/no longer an option/i);
        expect(store.getState().undoStack).toHaveLength(undoBefore);
        expect(store.getState().project!.wallObjects).toEqual(before);
        expect(partnerOfId(store, "door-a")).toBeUndefined();
        expect(partnerOfId(store, "door-n")).toBeUndefined();
      });

      it("completes a missing twin, in one undo step", async () => {
        // A legacy one-sided door facing an empty shared wall: the load pass
        // deliberately declines to create geometry on open, so the repair stands
        // as an issue until the user asks for it.
        abuttingRooms(store, [{ id: "door-a", wallId: A_EAST, xMm: 1200 }]);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().completeSharedOpening("door-a");

        const objects = store.getState().project!.wallObjects;
        expect(objects).toHaveLength(2);
        const twin = objects.find((object) => object.wallId === B_WEST)!;
        expect(twin.kind).toBe("door");
        expect(twin.xMm).toBeCloseTo(1800);
        expect(twin.widthMm).toBe(915);
        expect(partnerOfId(store, "door-a")).toBe(twin.id);
        expect(partnerOfId(store, twin.id)).toBe("door-a");
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
        expect(store.getState().undoStack.at(-1)?.label).toBe("Complete shared door");

        await store.getState().undo();
        expect(store.getState().project!.wallObjects).toHaveLength(1);
      });

      it("completes nothing, and pushes no undo entry, when no twin is pending", async () => {
        // An exterior door on a wall no room backs. There is no repair to apply,
        // and an empty undo step would be worse than doing nothing.
        abuttingRooms(store, [{ id: "door-n", wallId: A_NORTH, xMm: 1200 }]);
        const before = store.getState().project!.wallObjects;
        const undoBefore = store.getState().undoStack.length;

        await store.getState().completeSharedOpening("door-n");

        expect(store.getState().undoStack).toHaveLength(undoBefore);
        expect(store.getState().project!.wallObjects).toEqual(before);
      });

      it("realigns the partner onto the selected half — position, size and height", async () => {
        // paired-geometry-mismatch has no geometric answer to which half is
        // right, so the analyzer picks none. The user's selection supplies it,
        // and that means width/height/y travel with x.
        abuttingRooms(store, [
          {
            id: "door-a",
            wallId: A_EAST,
            xMm: 1200,
            widthMm: 1000,
            heightMm: 2100,
            yMm: 1050,
            connectsToObjectId: "door-b"
          },
          {
            id: "door-b",
            wallId: B_WEST,
            xMm: 1000,
            widthMm: 800,
            heightMm: 2000,
            yMm: 1000,
            connectsToObjectId: "door-a"
          }
        ]);
        const undoBefore = store.getState().undoStack.length;

        await store.getState().realignSharedOpening("door-a");

        const objects = store.getState().project!.wallObjects;
        const primary = objects.find((object) => object.id === "door-a")!;
        const partner = objects.find((object) => object.id === "door-b")!;
        expect(partner.xMm).toBeCloseTo(1800);
        expect(partner.widthMm).toBe(1000);
        expect(partner.heightMm).toBe(2100);
        expect(partner.yMm).toBe(1050);
        // The authoritative half is untouched.
        expect(primary.xMm).toBe(1200);
        expect(primary.widthMm).toBe(1000);
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
        expect(store.getState().undoStack.at(-1)?.label).toBe("Realign shared door");
        expect(evaluateOpeningPair(store.getState().project!, "door-a", "door-b").status).toBe(
          "aligned"
        );
      });

      it("refuses a realign whose partner slot is blocked, and names the obstruction", async () => {
        abuttingRooms(store, [
          { id: "door-a", wallId: A_EAST, xMm: 1200, connectsToObjectId: "door-b" },
          { id: "door-b", wallId: B_WEST, xMm: 1000, connectsToObjectId: "door-a" },
          { id: "zone-b", wallId: B_WEST, xMm: 1800, kind: "blocked-zone", widthMm: 400 }
        ]);
        const before = store.getState().project!.wallObjects;
        const undoBefore = store.getState().undoStack.length;

        await store.getState().realignSharedOpening("door-a");

        expect(store.getState().error).toBe(
          "The other side of this opening has nowhere to go — a blocked zone on the facing wall is already there."
        );
        // Nothing moved, so there is nothing to undo.
        expect(store.getState().undoStack).toHaveLength(undoBefore);
        expect(store.getState().project!.wallObjects).toEqual(before);
      });

      it("refuses to split two faces of one opening", async () => {
        const { primaryId, twinId } = await sharedPairOnBoundary(store);
        const before = store.getState().project!.wallObjects;
        const undoBefore = store.getState().undoStack.length;

        await store.getState().splitSharedOpening(primaryId);

        expect(store.getState().error).toBe(
          "These are two faces of one opening. Move the rooms apart, or delete it."
        );
        expect(store.getState().undoStack).toHaveLength(undoBefore);
        expect(store.getState().project!.wallObjects).toEqual(before);
        expect(partnerOfId(store, primaryId)).toBe(twinId);
      });

      it("keeps this opening only, deleting the partner in one undo step", async () => {
        // boundary-lost: the pair survives the rooms moving apart (decision 3),
        // and the user says which half was theirs.
        abuttingRooms(store,
          [
            { id: "door-a", wallId: A_EAST, xMm: 1200, connectsToObjectId: "door-b" },
            { id: "door-b", wallId: B_WEST, xMm: 1800, connectsToObjectId: "door-a" }
          ],
          [
            { roomId: "room-a", offsetXMm: 0 },
            { roomId: "room-b", offsetXMm: 5000 }
          ]
        );
        const undoBefore = store.getState().undoStack.length;

        await store.getState().keepThisOpeningOnly("door-a");

        const objects = store.getState().project!.wallObjects;
        expect(objects.map((object) => object.id)).toEqual(["door-a"]);
        expect(partnerOfId(store, "door-a")).toBeUndefined();
        expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
        expect(store.getState().undoStack.at(-1)?.label).toBe("Keep this door only");

        await store.getState().undo();
        expect(store.getState().project!.wallObjects).toHaveLength(2);
        expect(partnerOfId(store, "door-a")).toBe("door-b");
        expect(partnerOfId(store, "door-b")).toBe("door-a");
      });

      it("refuses to keep one half while the walls still face each other", async () => {
        const { primaryId, twinId } = await sharedPairOnBoundary(store);
        const before = store.getState().project!.wallObjects;
        const undoBefore = store.getState().undoStack.length;

        await store.getState().keepThisOpeningOnly(primaryId);

        expect(store.getState().undoStack).toHaveLength(undoBefore);
        expect(store.getState().project!.wallObjects).toEqual(before);
        expect(partnerOfId(store, primaryId)).toBe(twinId);
      });
    });
});
