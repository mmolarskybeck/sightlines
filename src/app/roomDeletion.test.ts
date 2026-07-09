import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../domain/geometry/createRoom";
import { faceWallIdsOf } from "../domain/geometry/freestandingWalls";
import type {
  FloorObject,
  FreestandingWall,
  Project,
  RoomPlacement,
  WallObject
} from "../domain/project";
import {
  describeRoomContents,
  shouldDeleteRoomOnKey,
  summarizeRoomContents
} from "./roomDeletion";
import { NO_SELECTION, type Selection } from "./store/selectionSlice";

function buildProject({
  wallObjects = [],
  floorObjects = [],
  partitions = []
}: {
  wallObjects?: WallObject[];
  floorObjects?: FloorObject[];
  partitions?: FreestandingWall[];
} = {}): { project: Project; placement: RoomPlacement } {
  const base = createRectangularRoomPlacement({
    roomId: "room-1",
    name: "East Gallery",
    widthMm: 6000,
    depthMm: 4000,
    heightMm: 3000,
    offsetXMm: 0,
    offsetYMm: 0
  });
  const placement: RoomPlacement = {
    ...base,
    room: { ...base.room, freestandingWalls: partitions }
  };
  const project: Project = {
    id: "p",
    schemaVersion: 3,
    title: "t",
    unit: "cm",
    defaultWallHeightMm: 3000,
    defaultCenterlineHeightMm: 1450,
    checklistArtworkIds: [],
    wallObjects,
    floorObjects,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    floor: { rooms: [placement] }
  };
  return { project, placement };
}

function wallArtwork(id: string, wallId: string): WallObject {
  return {
    id,
    kind: "artwork",
    artworkId: `art-${id}`,
    wallId,
    xMm: 1000,
    yMm: 1400,
    widthMm: 500,
    heightMm: 400
  };
}

const roomSelection: Selection = { kind: "room", roomId: "room-1" };

describe("shouldDeleteRoomOnKey", () => {
  it("returns the room id for a whole-room selection in default mode", () => {
    expect(
      shouldDeleteRoomOnKey({
        eventTarget: document.body,
        reshapeRoomId: null,
        selection: roomSelection
      })
    ).toBe("room-1");
  });

  it("stands down for a focused input (LengthFields use Backspace to edit)", () => {
    const input = document.createElement("input");
    expect(
      shouldDeleteRoomOnKey({
        eventTarget: input,
        reshapeRoomId: null,
        selection: roomSelection
      })
    ).toBeNull();
  });

  it("stands down while edit-shape is armed — vertex removal owns the key", () => {
    expect(
      shouldDeleteRoomOnKey({
        eventTarget: document.body,
        reshapeRoomId: "room-1",
        selection: roomSelection
      })
    ).toBeNull();
  });

  it("stands down for a wall selection (selectWall writes NO_SELECTION + wall context)", () => {
    expect(
      shouldDeleteRoomOnKey({
        eventTarget: document.body,
        reshapeRoomId: null,
        selection: NO_SELECTION
      })
    ).toBeNull();
  });

  it("stands down when objects are selected — the objects branch wins", () => {
    expect(
      shouldDeleteRoomOnKey({
        eventTarget: document.body,
        reshapeRoomId: null,
        selection: { kind: "objects", ids: ["obj-1"] }
      })
    ).toBeNull();
  });

  it("stands down for a selected partition — its own branch wins", () => {
    expect(
      shouldDeleteRoomOnKey({
        eventTarget: document.body,
        reshapeRoomId: null,
        selection: { kind: "freestandingWall", wallId: "partition-1" }
      })
    ).toBeNull();
  });
});

describe("summarizeRoomContents", () => {
  it("reports an empty room as empty", () => {
    const { project, placement } = buildProject();
    expect(summarizeRoomContents(project, placement).isEmpty).toBe(true);
  });

  it("counts wall artworks, openings, blocked zones, floor objects, and partitions", () => {
    const wallId = "room-1-wall-north";
    const { project, placement } = buildProject({
      wallObjects: [
        wallArtwork("a1", wallId),
        wallArtwork("a2", wallId),
        {
          id: "d1",
          kind: "door",
          blocksPlacement: true,
          wallId,
          xMm: 3000,
          yMm: 1000,
          widthMm: 900,
          heightMm: 2100
        },
        {
          id: "b1",
          kind: "blocked-zone",
          blocksPlacement: true,
          wallId,
          xMm: 5000,
          yMm: 1000,
          widthMm: 600,
          heightMm: 600
        }
      ],
      floorObjects: [
        {
          id: "f1",
          kind: "artwork",
          artworkId: "art-f1",
          xMm: 2000,
          yMm: 2000,
          widthMm: 500,
          depthMm: 400,
          rotationDeg: 0,
          heightMm: 400,
          wallYMm: 1400
        }
      ],
      partitions: [
        {
          id: "room-1-partition-1",
          roomId: "room-1",
          name: "Partition 1",
          startXMm: 1000,
          startYMm: 2000,
          endXMm: 3000,
          endYMm: 2000,
          heightMm: 3000,
          thicknessMm: 100
        }
      ]
    });

    const summary = summarizeRoomContents(project, placement);
    expect(summary).toMatchObject({
      artworks: 3,
      doors: 1,
      windows: 0,
      blockedZones: 1,
      partitions: 1,
      isEmpty: false
    });
  });

  it("counts objects hanging on partition faces — deleteRoom cascades them too", () => {
    const partition: FreestandingWall = {
      id: "room-1-partition-1",
      roomId: "room-1",
      name: "Partition 1",
      startXMm: 1000,
      startYMm: 2000,
      endXMm: 3000,
      endYMm: 2000,
      heightMm: 3000,
      thicknessMm: 100
    };
    const [faceAId] = faceWallIdsOf(partition.id);
    const { project, placement } = buildProject({
      wallObjects: [wallArtwork("a1", faceAId)],
      partitions: [partition]
    });

    const summary = summarizeRoomContents(project, placement);
    expect(summary.artworks).toBe(1);
    expect(summary.isEmpty).toBe(false);
  });

  it("ignores objects on another room's walls and floor objects outside the bounds", () => {
    const { project, placement } = buildProject({
      wallObjects: [wallArtwork("a1", "room-2-wall-north")],
      floorObjects: [
        {
          id: "f1",
          kind: "blocked-zone",
          xMm: 9000,
          yMm: 9000,
          widthMm: 500,
          depthMm: 400,
          rotationDeg: 0,
          heightMm: 400,
          wallYMm: 1400
        }
      ]
    });
    expect(summarizeRoomContents(project, placement).isEmpty).toBe(true);
  });
});

describe("describeRoomContents", () => {
  it("phrases one, two, and many categories naturally, omitting zeros", () => {
    const base = { artworks: 0, doors: 0, windows: 0, blockedZones: 0, partitions: 0, isEmpty: false };
    expect(describeRoomContents({ ...base, artworks: 4 })).toBe("4 artworks");
    expect(describeRoomContents({ ...base, artworks: 4, doors: 2 })).toBe(
      "4 artworks and 2 doors"
    );
    expect(
      describeRoomContents({ ...base, artworks: 1, windows: 1, partitions: 2 })
    ).toBe("1 artwork, 1 window, and 2 partitions");
  });
});
