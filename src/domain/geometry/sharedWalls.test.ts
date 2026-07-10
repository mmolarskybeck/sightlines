import { describe, expect, it } from "vitest";
import type { FreestandingWall, Project, RoomPlacement } from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import { createRectangularRoomPlacement } from "./createRoom";
import { faceWallId } from "./freestandingWalls";
import { findSharedWallCounterpart, mirrorOpeningXMm } from "./sharedWalls";

// Two abutting rooms whose shared edge is a coincident twin wall pair:
// room-a's east wall (floor x = widthA, running +y) and room-b's west wall
// (running −y) are anti-parallel and coincident when room-b sits flush to the
// right of room-a (offsetXMm = widthA). depthMm sets each wall's length.
function room(
  roomId: string,
  offsetXMm: number,
  offsetYMm = 0,
  overrides: { widthMm?: number; depthMm?: number } = {}
): RoomPlacement {
  return createRectangularRoomPlacement({
    roomId,
    name: roomId,
    widthMm: overrides.widthMm ?? 4000,
    depthMm: overrides.depthMm ?? 3000,
    heightMm: 2500,
    offsetXMm,
    offsetYMm
  });
}

function project(...rooms: RoomPlacement[]): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Shared walls",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: { rooms },
    checklistArtworkIds: [],
    wallObjects: [],
    floorObjects: [],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  };
}

const A_EAST = "room-a-wall-east";
const B_WEST = "room-b-wall-west";

describe("findSharedWallCounterpart", () => {
  it("finds the coincident twin of a shared wall and mirrors the opening's local x", () => {
    // room-b flush to the right: its west wall coincides with room-a's east.
    const result = findSharedWallCounterpart(
      project(room("room-a", 0), room("room-b", 4000)),
      A_EAST,
      1200,
      915
    );

    expect(result).not.toBeNull();
    expect(result!.wallId).toBe(B_WEST);
    // Anti-parallel walls run in opposite directions, so an opening 1200 mm
    // along the 3000 mm source wall mirrors to 1800 mm on the twin.
    expect(result!.xMm).toBeCloseTo(1800);
  });

  it("finds the twin when the walls are separated within the gap tolerance", () => {
    // A 200 mm perpendicular gap (offset past flush) is under OPENING_PAIR_MAX_
    // GAP_MM (250) — still one shared wall.
    const withinGap = findSharedWallCounterpart(
      project(room("room-a", 0), room("room-b", 4200)),
      A_EAST,
      1500,
      915
    );
    expect(withinGap?.wallId).toBe(B_WEST);

    // A 300 mm gap exceeds the tolerance — no counterpart.
    const beyondGap = findSharedWallCounterpart(
      project(room("room-a", 0), room("room-b", 4300)),
      A_EAST,
      1500,
      915
    );
    expect(beyondGap).toBeNull();
  });

  it("does not treat same-direction walls as counterparts", () => {
    // room-b overlaps room-a's north edge by 200 mm: its north wall is close
    // but runs the SAME direction, so it is not a shared wall (its south wall
    // is anti-parallel but far away).
    const result = findSharedWallCounterpart(
      project(room("room-a", 0), room("room-b", 0, 200)),
      "room-a-wall-north",
      2000,
      915
    );
    expect(result).toBeNull();
  });

  it("never returns a same-room wall even when one is geometrically coincident", () => {
    // A 200 mm-wide room: its own east and west walls are anti-parallel and
    // only 200 mm apart, so geometry alone would pair them — but a wall's twin
    // must live on a different room, so there is no counterpart.
    const result = findSharedWallCounterpart(
      project(room("room-a", 0, 0, { widthMm: 200 })),
      A_EAST,
      1500,
      915
    );
    expect(result).toBeNull();
  });

  it("never returns a partition face even when a face is coincident and anti-parallel", () => {
    // room-b's perimeter sits far from room-a's east wall, but room-b carries a
    // partition whose face lands right on it, anti-parallel. Faces never twin
    // (openings can't live on a partition in v1), so the result is null.
    const partition: FreestandingWall = {
      id: "room-b-partition-1",
      roomId: "room-b",
      name: "Partition 1",
      // room-b offset is (0,0), width 500; its centerline sits at floor x=4000.
      startXMm: 4000,
      startYMm: 0,
      endXMm: 4000,
      endYMm: 3000,
      heightMm: 2500,
      thicknessMm: 100
    };
    const roomB = room("room-b", 0, 0, { widthMm: 500 });
    roomB.room.freestandingWalls = [partition];

    const proj = project(room("room-a", 0), roomB);
    // Sanity: a face id would be the only geometric match, and it is excluded.
    const faceId = faceWallId("room-b-partition-1", "b");
    expect(faceId).toContain("#");
    expect(findSharedWallCounterpart(proj, A_EAST, 1500, 915)).toBeNull();
  });

  it("rejects an opening whose extent overhangs the counterpart's span", () => {
    // room-b is shallower (depth 2000): its west wall only backs y ∈ [0, 2000]
    // of room-a's 3000 mm east wall.
    const proj = project(room("room-a", 0), room("room-b", 4000, 0, { depthMm: 2000 }));

    // Centered where the twin still fully backs the opening → found.
    expect(findSharedWallCounterpart(proj, A_EAST, 1000, 915)?.wallId).toBe(B_WEST);

    // Centered near the far end, the extent runs off the shorter twin → null.
    expect(findSharedWallCounterpart(proj, A_EAST, 2600, 915)).toBeNull();
  });

  it("returns null for a wall with no neighboring room", () => {
    expect(
      findSharedWallCounterpart(project(room("room-a", 0)), A_EAST, 1500, 915)
    ).toBeNull();
  });
});

describe("mirrorOpeningXMm", () => {
  it("mirrors a position across an anti-parallel coincident twin", () => {
    const proj = project(room("room-a", 0), room("room-b", 4000));
    // 3000 mm walls running opposite ways: x → length − x.
    expect(mirrorOpeningXMm(proj, A_EAST, B_WEST, 1200)).toBeCloseTo(1800);
    expect(mirrorOpeningXMm(proj, B_WEST, A_EAST, 1800)).toBeCloseTo(1200);
  });

  it("returns null when a wall is missing", () => {
    const proj = project(room("room-a", 0), room("room-b", 4000));
    expect(mirrorOpeningXMm(proj, A_EAST, "no-such-wall", 1200)).toBeNull();
  });
});
