import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../domain/geometry/createRoom";
import { openWallInProject } from "../domain/geometry/wallCascade";
import {
  CURRENT_SCHEMA_VERSION,
  type Project,
  type RoomPlacement,
  type WallObject
} from "../domain/project";
import { NO_SELECTION, type Selection } from "./store/selectionSlice";
import { buildOpenWallRequest, shouldOpenWallOnKey } from "./wallOpening";

const A_EAST = "room-a-wall-east";
const A_NORTH = "room-a-wall-north";
const B_WEST = "room-b-wall-west";

function room(roomId: string, offsetXMm: number, depthMm = 3000): RoomPlacement {
  return createRectangularRoomPlacement({
    roomId,
    name: roomId === "room-a" ? "East Gallery" : "West Gallery",
    widthMm: 4000,
    depthMm,
    heightMm: 2500,
    offsetXMm,
    offsetYMm: 0
  });
}

function project(rooms: RoomPlacement[], wallObjects: WallObject[] = []): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Open walls",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: { rooms },
    checklistArtworkIds: [],
    wallObjects,
    floorObjects: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z"
  };
}

function door(id: string, wallId: string, connectsToObjectId?: string): WallObject {
  return {
    id,
    kind: "door",
    blocksPlacement: true,
    wallId,
    xMm: 1500,
    yMm: 1015,
    widthMm: 900,
    heightMm: 2030,
    ...(connectsToObjectId ? { connectsToObjectId } : {})
  } as WallObject;
}

function artwork(id: string, wallId: string): WallObject {
  return {
    id,
    kind: "artwork",
    artworkId: `${id}-work`,
    wallId,
    xMm: 1000,
    yMm: 1450,
    widthMm: 600,
    heightMm: 800
  } as WallObject;
}

function readyRequest(p: Project, wallId: string) {
  const request = buildOpenWallRequest(p, wallId);
  if (!request) throw new Error("expected a request");
  return request;
}

describe("shouldOpenWallOnKey", () => {
  const pick: Selection = { kind: "wall", wallId: A_NORTH };

  it("returns the picked wall id", () => {
    expect(
      shouldOpenWallOnKey({ eventTarget: document.body, reshapeRoomId: null, selection: pick })
    ).toBe(A_NORTH);
  });

  // The safety property in its purest form: wall CONTEXT is a default the
  // inspector always shows, and nothing destructive may key off it.
  it("returns null for an empty selection, whatever the inspector displays", () => {
    expect(
      shouldOpenWallOnKey({
        eventTarget: document.body,
        reshapeRoomId: null,
        selection: NO_SELECTION
      })
    ).toBeNull();
  });

  it("returns null for every other selection kind", () => {
    const others: Selection[] = [
      { kind: "objects", ids: ["a"] },
      { kind: "room", roomId: "room-a" },
      { kind: "freestandingWall", wallId: "p1" },
      { kind: "libraryArtwork", artworkId: "w1" },
      { kind: "measurement", measurementId: "m1" }
    ];
    for (const selection of others) {
      expect(
        shouldOpenWallOnKey({ eventTarget: document.body, reshapeRoomId: null, selection })
      ).toBeNull();
    }
  });

  it("stands down while edit-shape is armed and for editable targets", () => {
    expect(
      shouldOpenWallOnKey({
        eventTarget: document.body,
        reshapeRoomId: "room-a",
        selection: pick
      })
    ).toBeNull();

    const input = document.createElement("input");
    expect(
      shouldOpenWallOnKey({ eventTarget: input, reshapeRoomId: null, selection: pick })
    ).toBeNull();
  });
});

describe("buildOpenWallRequest", () => {
  it("returns null for an unknown id — the staleness absorber", () => {
    expect(buildOpenWallRequest(project([room("room-a", 0)]), "gone")).toBeNull();
  });

  it("returns null for an already-open wall (no dialog to show)", () => {
    const opened = openWallInProject(project([room("room-a", 0)]), A_NORTH);
    if (opened.status !== "ready") throw new Error("fixture should open");

    expect(buildOpenWallRequest(opened.project, A_NORTH)).toBeNull();
  });

  it("names the wall and room, and reports an empty wall as empty", () => {
    const request = readyRequest(project([room("room-a", 0)]), A_NORTH);

    expect(request.wallName).toBe("North wall");
    expect(request.roomName).toBe("East Gallery");
    expect(request.summary.isEmpty).toBe(true);
    expect(request.sharedRoomNames).toEqual([]);
  });

  it("splits artworks from fixtures", () => {
    const p = project(
      [room("room-a", 0)],
      [artwork("art-1", A_NORTH), artwork("art-2", A_NORTH), door("door-1", A_NORTH)]
    );
    const request = readyRequest(p, A_NORTH);

    expect(request.summary.artworks).toBe(2);
    expect(request.summary.doors).toBe(1);
    expect(request.summary.isEmpty).toBe(false);
  });

  // Two stored objects, one physical hole. Counting both would tell the user
  // two doors are going when only one opening is.
  it("counts a shared door once, not twice", () => {
    const p = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, "door-b"), door("door-b", B_WEST, "door-a")]
    );
    const request = readyRequest(p, A_EAST);

    expect(request.summary.doors).toBe(1);
  });

  it("names the other room for a shared wall", () => {
    const p = project([room("room-a", 0), room("room-b", 4000)]);
    const request = readyRequest(p, A_EAST);

    expect(request.sharedRoomNames).toEqual(["West Gallery"]);
  });

  // The alcove case: no longer a refusal. Selecting the short wall is ready,
  // and flags that its longer counterpart will be split.
  it("is ready and flags a split when the counterpart outruns the wall", () => {
    const p = project([room("room-a", 0), room("room-b", 4000, 1500)]);
    const request = readyRequest(p, B_WEST);

    expect(request.willSplit).toBe(true);
    expect(request.sharedRoomNames).toEqual(["East Gallery"]);
  });

  it("is ready with no split when the long wall is selected instead", () => {
    const p = project([room("room-a", 0), room("room-b", 4000, 1500)]);
    const request = readyRequest(p, A_EAST);

    expect(request.willSplit).toBe(false);
    expect(request.sharedRoomNames).toEqual(["West Gallery"]);
  });
});
