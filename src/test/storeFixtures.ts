import type { createAppStore } from "../app/store";
import { createRectangularRoomPlacement } from "../domain/geometry/createRoom";
import type { WallObject } from "../domain/project";

type AppStore = ReturnType<typeof createAppStore>;

// Two abutting rooms: room-a's east wall and room-b's west wall are one
// coincident twin pair, mirroring opening x to (3000 − x). Shared by
// store.test.ts's "opening connections" tests, placementSlice.test.ts's
// "hinged handing" and sharedOpeningSlice.test.ts's resolver tests — all of
// which pose the same shared-boundary geometry against different actions.
export const A_EAST = "room-a-wall-east";
export const A_NORTH = "room-a-wall-north";
export const B_WEST = "room-b-wall-west";
const DOOR_Y_MM = 1015; // door center = height/2 (2030/2), the placement default.

type SharedDoorSpec = {
  id: string;
  wallId: string;
  xMm: number;
  kind?: "door" | "window" | "blocked-zone";
  widthMm?: number;
  heightMm?: number;
  yMm?: number;
  connectsToObjectId?: string;
};
export type RoomSpec = { roomId: string; offsetXMm: number };

export const TWO_ROOMS: RoomSpec[] = [
  { roomId: "room-a", offsetXMm: 0 },
  { roomId: "room-b", offsetXMm: 4000 }
];

// Written straight into state rather than through a document-entry path: the
// load repair would otherwise link (or realign) the very geometry a test is
// posing before the test gets to run its action against it.
export function abuttingRooms(
  store: AppStore,
  doors: SharedDoorSpec[],
  rooms: RoomSpec[] = TWO_ROOMS
): void {
  const base = store.getState().project!;
  store.setState({
    project: {
      ...base,
      wallObjects: doors.map(
        (spec): WallObject => ({
          kind: spec.kind ?? "door",
          blocksPlacement: true,
          id: spec.id,
          wallId: spec.wallId,
          xMm: spec.xMm,
          yMm: spec.yMm ?? DOOR_Y_MM,
          widthMm: spec.widthMm ?? 915,
          heightMm: spec.heightMm ?? 2030,
          ...(spec.connectsToObjectId === undefined
            ? {}
            : { connectsToObjectId: spec.connectsToObjectId })
        })
      ),
      floorObjects: [],
      floor: {
        rooms: rooms.map((room) =>
          createRectangularRoomPlacement({
            roomId: room.roomId,
            name: room.roomId,
            widthMm: 4000,
            depthMm: 3000,
            heightMm: 2500,
            offsetXMm: room.offsetXMm,
            offsetYMm: 0
          })
        )
      }
    }
  });
}

// A healthy live pair, built the way the app builds one: addOpening on a
// shared wall reconciles a twin onto the facing wall in the same commit.
export async function sharedPairOnBoundary(
  store: AppStore
): Promise<{ primaryId: string; twinId: string }> {
  abuttingRooms(store, []);
  await store.getState().addOpening(A_EAST, "door");
  const objects = store.getState().project!.wallObjects;
  return {
    primaryId: objects.find((object) => object.wallId === A_EAST)!.id,
    twinId: objects.find((object) => object.wallId === B_WEST)!.id
  };
}

export function partnerOfId(store: AppStore, openingId: string): string | undefined {
  const object = store
    .getState()
    .project!.wallObjects.find((candidate) => candidate.id === openingId);
  return object && (object.kind === "door" || object.kind === "window")
    ? object.connectsToObjectId
    : undefined;
}

// A LEGACY pair, written straight into state — symmetric connectsToObjectId
// pointers between two openings whose walls are not a shared boundary. That
// is exactly what an old document holds, and since Stage 6 no store action
// will build one (resolveSharedOpening refuses any target the analyzer does
// not sanction, and a non-boundary wall is never a candidate), fabricating it
// is the only way to exercise the legacy carve-out.
export function linkLegacyPair(store: AppStore, aId: string, bId: string): void {
  const base = store.getState().project!;
  store.setState({
    project: {
      ...base,
      wallObjects: base.wallObjects.map((object) => {
        if (object.id === aId) return { ...object, connectsToObjectId: bId };
        if (object.id === bId) return { ...object, connectsToObjectId: aId };
        return object;
      })
    }
  });
}
