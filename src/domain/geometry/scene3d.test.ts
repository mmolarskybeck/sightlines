import { describe, expect, it } from "vitest";
import type {
  Artwork,
  FloorObject,
  Project,
  Room,
  RoomPlacement,
  Wall,
  WallObject
} from "../project";
import { CURRENT_ARTWORK_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION } from "../project";
import {
  deriveScene3d,
  wallInwardNormal,
  type Vec2,
  type WallPanel3d
} from "./scene3d";

// Build a closed wall loop from an ordered vertex ring.
function makeRoom(
  id: string,
  ring: Array<{ id: string; xMm: number; yMm: number }>,
  heightMm: number,
  wallHeights?: number[]
): Room {
  const walls: Wall[] = ring.map((vertex, index) => {
    const next = ring[(index + 1) % ring.length];
    return {
      id: `${id}-wall-${index}`,
      roomId: id,
      name: `Wall ${index}`,
      startVertexId: vertex.id,
      endVertexId: next.id,
      heightMm: wallHeights?.[index] ?? heightMm
    };
  });

  return { id, name: id, heightMm, freestandingWalls: [], vertices: ring, walls };
}

function makePlacement(
  room: Room,
  overrides: Partial<Omit<RoomPlacement, "room">> = {}
): RoomPlacement {
  return {
    roomId: room.id,
    offsetXMm: 0,
    offsetYMm: 0,
    rotationDeg: 0,
    room,
    ...overrides
  };
}

function makeProject(
  placements: RoomPlacement[],
  objects: { wallObjects?: WallObject[]; floorObjects?: FloorObject[] } = {}
): Project {
  const now = new Date("2026-07-07T00:00:00.000Z").toISOString();
  return {
    id: "test-project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Test",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: { rooms: placements },
    checklistArtworkIds: [],
    wallObjects: objects.wallObjects ?? [],
    floorObjects: objects.floorObjects ?? [],
    createdAt: now,
    updatedAt: now
  };
}

function makeArtwork(id: string, overrides: Partial<Artwork> = {}): Artwork {
  return {
    id,
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    dimensions: { status: "known", widthMm: 600, heightMm: 800 },
    assetId: `asset-${id}`,
    metadata: {},
    ...overrides
  };
}

const CCW_RECT = [
  { id: "v0", xMm: 0, yMm: 0 },
  { id: "v1", xMm: 4000, yMm: 0 },
  { id: "v2", xMm: 4000, yMm: 3000 },
  { id: "v3", xMm: 0, yMm: 3000 }
];

// Clockwise equivalent; derivation must still orient walls inward.
const CW_RECT = [
  { id: "v0", xMm: 0, yMm: 0 },
  { id: "v1", xMm: 0, yMm: 3000 },
  { id: "v2", xMm: 4000, yMm: 3000 },
  { id: "v3", xMm: 4000, yMm: 0 }
];

function midpoint(panel: WallPanel3d): Vec2 {
  return {
    xMm: (panel.start.xMm + panel.end.xMm) / 2,
    yMm: (panel.start.yMm + panel.end.yMm) / 2
  };
}

// Ray-cast independently verifies that normals point into the room.
function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.yMm > point.yMm !== b.yMm > point.yMm &&
      point.xMm <
        ((b.xMm - a.xMm) * (point.yMm - a.yMm)) / (b.yMm - a.yMm) + a.xMm;
    if (intersects) inside = !inside;
  }
  return inside;
}

describe("deriveScene3d", () => {
  it("derives one room with a floor polygon and one wall per edge", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))])
    );

    expect(scene.rooms).toHaveLength(1);
    const room = scene.rooms[0];
    expect(room.roomId).toBe("room-a");
    expect(room.floorPolygon).toHaveLength(4);
    expect(room.walls).toHaveLength(4);
  });

  it("carries per-wall heights, not just the room default", () => {
    const scene = deriveScene3d(
      makeProject([
        makePlacement(makeRoom("room-a", CCW_RECT, 2500, [2500, 3200, 2500, 2500]))
      ])
    );

    const heights = scene.rooms[0].walls.map((wall) => wall.heightMm);
    expect(heights).toEqual([2500, 3200, 2500, 2500]);
  });

  it("emits no holes in M1 but exposes the hole array", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))])
    );

    for (const wall of scene.rooms[0].walls) {
      expect(wall.holes).toEqual([]);
      expect(wall.artworks).toEqual([]);
      expect(wall.blockedZones).toEqual([]);
    }
  });

  it("iterates floor.rooms (plural) so multi-room works day one", () => {
    const scene = deriveScene3d(
      makeProject([
        makePlacement(makeRoom("room-a", CCW_RECT, 2500)),
        makePlacement(makeRoom("room-b", CCW_RECT, 2500), { offsetXMm: 8000 })
      ])
    );

    expect(scene.rooms.map((room) => room.roomId)).toEqual(["room-a", "room-b"]);
  });

  it("returns an empty scene when there are no rooms", () => {
    expect(deriveScene3d(makeProject([]))).toEqual({ rooms: [], floorObjects: [] });
  });
});

describe("deriveScene3d — floor-space placement", () => {
  it("applies the RoomPlacement offset to the floor polygon and walls", () => {
    const scene = deriveScene3d(
      makeProject([
        makePlacement(makeRoom("room-a", CCW_RECT, 2500), {
          offsetXMm: 1000,
          offsetYMm: 2000
        })
      ])
    );

    const room = scene.rooms[0];
    expect(room.floorPolygon).toContainEqual({ xMm: 1000, yMm: 2000 });
    expect(room.floorPolygon).toContainEqual({ xMm: 5000, yMm: 5000 });
    expect(room.walls[0].start).toEqual({ xMm: 1000, yMm: 2000 });
  });

  it("applies rotation about the room origin then the offset", () => {
    const scene = deriveScene3d(
      makeProject([
        makePlacement(makeRoom("room-a", CCW_RECT, 2500), {
          rotationDeg: 90,
          offsetXMm: 1000,
          offsetYMm: 2000
        })
      ])
    );

    const rotated = scene.rooms[0].floorPolygon.map((point) => ({
      xMm: Math.round(point.xMm),
      yMm: Math.round(point.yMm)
    }));
    expect(rotated).toContainEqual({ xMm: 1000, yMm: 6000 });
    expect(rotated).toContainEqual({ xMm: -2000, yMm: 2000 });
  });
});

describe("deriveScene3d — display cases", () => {
  it("emits a wall case onto its wall panel with wall-local center + size + protrusion", () => {
    const wallCase: WallObject = {
      id: "wo-case",
      kind: "case",
      wallId: "room-a-wall-0",
      xMm: 1000,
      yMm: 950,
      widthMm: 1500,
      heightMm: 180,
      depthMm: 450
    };
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))], {
        wallObjects: [wallCase]
      })
    );

    const panel = scene.rooms[0].walls.find((wall) => wall.wallId === "room-a-wall-0")!;
    expect(panel.cases).toHaveLength(1);
    expect(panel.cases[0]).toEqual({
      objectId: "wo-case",
      xMm: 1000,
      yMm: 950,
      widthMm: 1500,
      heightMm: 180,
      depthMm: 450
    });
    // Not misclassified as artwork/blocked-zone/hole.
    expect(panel.artworks).toHaveLength(0);
    expect(panel.blockedZones).toHaveLength(0);
    expect(panel.holes).toHaveLength(0);
  });

  it("emits a floor case as a floor object carrying kind 'case' and its dimensions", () => {
    const floorCase: FloorObject = {
      id: "fo-case",
      kind: "case",
      xMm: 2000,
      yMm: 1500,
      widthMm: 1800,
      depthMm: 600,
      heightMm: 950,
      rotationDeg: 0,
      wallYMm: 950
    };
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))], {
        floorObjects: [floorCase]
      })
    );

    expect(scene.floorObjects).toHaveLength(1);
    expect(scene.floorObjects[0]).toMatchObject({
      objectId: "fo-case",
      kind: "case",
      xMm: 2000,
      yMm: 1500,
      widthMm: 1800,
      depthMm: 600,
      heightMm: 950,
      rotationDeg: 0
    });
    // No artwork join for a case.
    expect(scene.floorObjects[0]!.artworkId).toBeUndefined();
  });
});

describe("wallInwardNormal — winding / orientation", () => {
  it("points every wall of a CCW room inward toward the floor", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))])
    );
    const room = scene.rooms[0];

    for (const wall of room.walls) {
      const normal = wallInwardNormal(wall);
      const probe = {
        xMm: midpoint(wall).xMm + normal.xMm * 10,
        yMm: midpoint(wall).yMm + normal.yMm * 10
      };
      expect(pointInPolygon(probe, room.floorPolygon)).toBe(true);
    }
  });

  it("normalises a CW room so its walls still face inward", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CW_RECT, 2500))])
    );
    const room = scene.rooms[0];

    expect(signedArea(room.floorPolygon)).toBeGreaterThan(0);

    for (const wall of room.walls) {
      const normal = wallInwardNormal(wall);
      const probe = {
        xMm: midpoint(wall).xMm + normal.xMm * 10,
        yMm: midpoint(wall).yMm + normal.yMm * 10
      };
      expect(pointInPolygon(probe, room.floorPolygon)).toBe(true);
    }
  });

  it("gives the north wall of an axis-aligned CCW rect an inward +y normal", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))])
    );
    const normal = wallInwardNormal(scene.rooms[0].walls[0]);
    expect(normal.xMm).toBeCloseTo(0);
    expect(normal.yMm).toBeCloseTo(1);
  });

  it("faces every wall of a non-rectangular (triangular) room inward", () => {
    const triangle = [
      { id: "v0", xMm: 0, yMm: 0 },
      { id: "v1", xMm: 4000, yMm: 0 },
      { id: "v2", xMm: 0, yMm: 3000 }
    ];
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-tri", triangle, 2500))])
    );
    const room = scene.rooms[0];

    expect(room.walls).toHaveLength(3);
    for (const wall of room.walls) {
      const normal = wallInwardNormal(wall);
      const probe = {
        xMm: midpoint(wall).xMm + normal.xMm * 10,
        yMm: midpoint(wall).yMm + normal.yMm * 10
      };
      expect(pointInPolygon(probe, room.floorPolygon)).toBe(true);
    }
  });

  it("keeps walls facing inward after a rotated placement", () => {
    const scene = deriveScene3d(
      makeProject([
        makePlacement(makeRoom("room-a", CCW_RECT, 2500), {
          rotationDeg: 37,
          offsetXMm: 500,
          offsetYMm: -800
        })
      ])
    );
    const room = scene.rooms[0];

    for (const wall of room.walls) {
      const normal = wallInwardNormal(wall);
      const probe = {
        xMm: midpoint(wall).xMm + normal.xMm * 10,
        yMm: midpoint(wall).yMm + normal.yMm * 10
      };
      expect(pointInPolygon(probe, room.floorPolygon)).toBe(true);
    }
  });
});

describe("deriveScene3d — wall artworks (M2)", () => {
  it("populates wall artworks with wall-local coords, size, and artwork joins", () => {
    const artwork = makeArtwork("art-1", {
      dimensions: { status: "approximate", widthMm: 600, heightMm: 800 }
    });
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))], {
        wallObjects: [
          {
            id: "obj-1",
            kind: "artwork",
            artworkId: "art-1",
            wallId: "room-a-wall-0",
            xMm: 1500,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          }
        ]
      }),
      new Map([[artwork.id, artwork]])
    );

    const wall = scene.rooms[0].walls.find((w) => w.wallId === "room-a-wall-0");
    expect(wall?.artworks).toEqual([
      {
        objectId: "obj-1",
        artworkId: "art-1",
        assetId: "asset-art-1",
        status: "approximate",
        xMm: 1500,
        yMm: 1450,
        widthMm: 600,
        heightMm: 800
      }
    ]);
    for (const other of scene.rooms[0].walls) {
      if (other.wallId !== "room-a-wall-0") expect(other.artworks).toEqual([]);
    }
  });

  it("remaps wall-local x on walls whose endpoints were swapped by CW normalisation", () => {
    // Swapping a clockwise wall's endpoints must mirror its wall-local x.
    const artwork = makeArtwork("art-1");
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CW_RECT, 2500))], {
        wallObjects: [
          {
            id: "obj-1",
            kind: "artwork",
            artworkId: "art-1",
            wallId: "room-a-wall-0",
            xMm: 1000,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          }
        ]
      }),
      new Map([[artwork.id, artwork]])
    );

    const wall = scene.rooms[0].walls.find((w) => w.wallId === "room-a-wall-0");
    expect(wall?.artworks[0]?.xMm).toBe(2000);
    expect(wall?.start).toEqual({ xMm: 0, yMm: 3000 });
  });

  it("leaves the artwork join empty when the artwork record is missing", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))], {
        wallObjects: [
          {
            id: "obj-1",
            kind: "artwork",
            artworkId: "art-gone",
            wallId: "room-a-wall-0",
            xMm: 1500,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          }
        ]
      })
    );

    const placed = scene.rooms[0].walls[0].artworks[0];
    expect(placed.objectId).toBe("obj-1");
    expect(placed.assetId).toBeUndefined();
    expect(placed.status).toBeUndefined();
  });

  it("derives wall blocked zones as wall-local extents", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))], {
        wallObjects: [
          {
            id: "zone-1",
            kind: "blocked-zone",
            blocksPlacement: true,
            wallId: "room-a-wall-0",
            xMm: 1000,
            yMm: 1250,
            widthMm: 800,
            heightMm: 2500
          }
        ]
      })
    );

    expect(scene.rooms[0].walls[0].blockedZones).toEqual([
      { xMinMm: 600, xMaxMm: 1400, yMinMm: 0, yMaxMm: 2500 }
    ]);
  });
});

describe("deriveScene3d — door/window holes (M3)", () => {
  function makeOpening(
    kind: "door" | "window",
    overrides: Partial<WallObject> = {}
  ): WallObject {
    return {
      id: `${kind}-1`,
      kind,
      blocksPlacement: true,
      wallId: "room-a-wall-0",
      xMm: 1000,
      yMm: 1000,
      widthMm: 900,
      heightMm: 2000,
      ...overrides
    } as WallObject;
  }

  function deriveWall0(opening: WallObject, ring = CCW_RECT) {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", ring, 2500))], {
        wallObjects: [opening]
      })
    );
    return scene.rooms[0].walls.find((w) => w.wallId === "room-a-wall-0")!;
  }

  it("derives a door as a floor-to-top cutout regardless of its stored center", () => {
    const wall = deriveWall0(makeOpening("door"));
    expect(wall.holes).toEqual([
      {
        kind: "door",
        xMinMm: 550,
        xMaxMm: 1450,
        yMinMm: 0,
        yMaxMm: 2000,
        clamped: false,
        treatment: "capped"
      }
    ]);
  });

  it("derives a window as a floating cutout", () => {
    const wall = deriveWall0(
      makeOpening("window", { yMm: 1500, widthMm: 1200, heightMm: 1000 })
    );
    expect(wall.holes).toEqual([
      {
        kind: "window",
        xMinMm: 400,
        xMaxMm: 1600,
        yMinMm: 1000,
        yMaxMm: 2000,
        clamped: false,
        treatment: "capped"
      }
    ]);
  });

  it("clamps holes to the wall bounds and flags them", () => {
    const wall = deriveWall0(
      makeOpening("window", { xMm: 200, yMm: 2300, widthMm: 800, heightMm: 800 })
    );
    expect(wall.holes).toEqual([
      {
        kind: "window",
        xMinMm: 0,
        xMaxMm: 600,
        yMinMm: 1900,
        yMaxMm: 2500,
        clamped: true,
        treatment: "capped"
      }
    ]);
  });

  it("drops holes that fall entirely outside the wall", () => {
    const wall = deriveWall0(
      makeOpening("window", { xMm: -2000, widthMm: 800 })
    );
    expect(wall.holes).toEqual([]);
  });

  it("remaps hole x extents on walls swapped by CW normalisation", () => {
    const wall = deriveWall0(
      makeOpening("door", { xMm: 1000, widthMm: 800, heightMm: 2000 }),
      CW_RECT
    );
    expect(wall.holes).toEqual([
      {
        kind: "door",
        xMinMm: 1600,
        xMaxMm: 2400,
        yMinMm: 0,
        yMaxMm: 2000,
        clamped: false,
        treatment: "capped"
      }
    ]);
  });

  it("emits the mirrored clear intersection as open on both sides of an aligned pair", () => {
    const roomA = makePlacement(makeRoom("room-a", CCW_RECT, 2500));
    const roomB = makePlacement(makeRoom("room-b", CCW_RECT, 2500), {
      offsetXMm: 4000
    });
    const a = makeOpening("door", {
      id: "door-a",
      wallId: "room-a-wall-1",
      xMm: 1200,
      widthMm: 1000,
      yMm: 1050,
      heightMm: 2100,
      connectsToObjectId: "door-b"
    });
    const b = makeOpening("door", {
      id: "door-b",
      wallId: "room-b-wall-3",
      xMm: 1700,
      widthMm: 600,
      yMm: 900,
      heightMm: 1800,
      connectsToObjectId: "door-a"
    });

    const scene = deriveScene3d(
      makeProject([roomA, roomB], { wallObjects: [a, b] })
    );
    const holeA = scene.rooms[0].walls.find((wall) => wall.wallId === a.wallId)!.holes[0];
    const holeB = scene.rooms[1].walls.find((wall) => wall.wallId === b.wallId)!.holes[0];

    expect(holeA).toEqual({
      kind: "door",
      xMinMm: 1000,
      xMaxMm: 1600,
      yMinMm: 0,
      yMaxMm: 1800,
      clamped: false,
      treatment: "open",
      connectedRoomId: "room-b"
    });
    expect(holeB).toEqual({
      kind: "door",
      xMinMm: 1400,
      xMaxMm: 2000,
      yMinMm: 0,
      yMaxMm: 1800,
      clamped: false,
      treatment: "open",
      connectedRoomId: "room-a"
    });
  });

  it("keeps both sides capped when a stored pair is geometrically misaligned", () => {
    const roomA = makePlacement(makeRoom("room-a", CCW_RECT, 2500));
    const roomB = makePlacement(makeRoom("room-b", CCW_RECT, 2500), {
      offsetXMm: 4300
    });
    const a = makeOpening("window", {
      id: "window-a",
      wallId: "room-a-wall-1",
      connectsToObjectId: "window-b"
    });
    const b = makeOpening("window", {
      id: "window-b",
      wallId: "room-b-wall-3",
      connectsToObjectId: "window-a"
    });

    const scene = deriveScene3d(
      makeProject([roomA, roomB], { wallObjects: [a, b] })
    );
    const treatments = scene.rooms.flatMap((room) =>
      room.walls.flatMap((wall) => wall.holes.map((hole) => hole.treatment))
    );
    expect(treatments).toEqual(["capped", "capped"]);
  });
});

describe("deriveScene3d — floor objects (M2)", () => {
  it("derives floor artworks with size, rotation, and artwork joins", () => {
    const artwork = makeArtwork("art-1", {
      dimensions: { status: "unknown" }
    });
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))], {
        floorObjects: [
          {
            id: "fobj-1",
            kind: "artwork",
            artworkId: "art-1",
            xMm: 2000,
            yMm: 1500,
            widthMm: 900,
            depthMm: 400,
            heightMm: 1200,
            rotationDeg: 30,
            wallYMm: 1450
          }
        ]
      }),
      new Map([[artwork.id, artwork]])
    );

    expect(scene.floorObjects).toEqual([
      {
        objectId: "fobj-1",
        kind: "artwork",
        artworkId: "art-1",
        assetId: "asset-art-1",
        status: "unknown",
        xMm: 2000,
        yMm: 1500,
        widthMm: 900,
        depthMm: 400,
        heightMm: 1200,
        rotationDeg: 30
      }
    ]);
  });

  it("derives floor blocked zones without artwork fields", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))], {
        floorObjects: [
          {
            id: "fzone-1",
            kind: "blocked-zone",
            xMm: 500,
            yMm: 500,
            widthMm: 1000,
            depthMm: 1000,
            heightMm: 0,
            rotationDeg: 0,
            wallYMm: 0
          }
        ]
      })
    );

    expect(scene.floorObjects).toEqual([
      {
        objectId: "fzone-1",
        kind: "blocked-zone",
        xMm: 500,
        yMm: 500,
        widthMm: 1000,
        depthMm: 1000,
        heightMm: 0,
        rotationDeg: 0
      }
    ]);
  });

  it("emits an empty floorObjects array when there are none", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))])
    );
    expect(scene.floorObjects).toEqual([]);
  });
});

describe("deriveScene3d — partitions", () => {
  function roomWithPartition(): Room {
    const base = makeRoom("room-a", CCW_RECT, 2500);
    return {
      ...base,
      freestandingWalls: [
        {
          id: "room-a-partition-1",
          roomId: "room-a",
          name: "Partition 1",
          startXMm: 1000,
          startYMm: 1500,
          endXMm: 3000,
          endYMm: 1500,
          heightMm: 2800, // taller than the 2500 room walls
          thicknessMm: 100
        }
      ]
    };
  }

  it("emits one FreestandingWall3d with two face panels and a cap outline", () => {
    const scene = deriveScene3d(makeProject([makePlacement(roomWithPartition())]));
    const partition = scene.rooms[0].freestandingWalls[0];

    expect(partition.freestandingWallId).toBe("room-a-partition-1");
    expect(partition.faces).toHaveLength(2);
    expect(partition.faces[0].wallId).toBe("room-a-partition-1#a");
    expect(partition.faces[1].wallId).toBe("room-a-partition-1#b");
    expect(partition.capOutline).toEqual({
      start: { xMm: 1000, yMm: 1500 },
      end: { xMm: 3000, yMm: 1500 },
      thicknessMm: 100,
      heightMm: 2800
    });
    expect(partition.faces[0].holes).toEqual([]);
    expect(partition.faces[1].holes).toEqual([]);
  });

  it("faces the two panels in opposite outward directions (point-probe)", () => {
    const scene = deriveScene3d(makeProject([makePlacement(roomWithPartition())]));
    const [faceA, faceB] = scene.rooms[0].freestandingWalls[0].faces;
    const normalA = wallInwardNormal(faceA);
    const normalB = wallInwardNormal(faceB);

    expect(normalA.yMm).toBeCloseTo(1);
    expect(normalB.yMm).toBeCloseTo(-1);
    expect(normalA.xMm * normalB.xMm + normalA.yMm * normalB.yMm).toBeCloseTo(-1);
  });

  it("places mirrored panel-local x on both faces at the same floor point", () => {
    const scene = deriveScene3d(
      makeProject([makePlacement(roomWithPartition())], {
        wallObjects: [
          {
            id: "art-a",
            kind: "artwork",
            artworkId: "art-a",
            wallId: "room-a-partition-1#a",
            xMm: 500,
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          },
          {
            id: "art-b",
            kind: "artwork",
            artworkId: "art-b",
            wallId: "room-a-partition-1#b",
            xMm: 1500, // length 2000; mirror of 500
            yMm: 1450,
            widthMm: 600,
            heightMm: 800
          }
        ]
      })
    );
    const [faceA, faceB] = scene.rooms[0].freestandingWalls[0].faces;
    const artA = faceA.artworks[0];
    const artB = faceB.artworks[0];
    expect(artA.xMm).toBe(500);
    expect(artB.xMm).toBe(1500);

    const floorOf = (panel: WallPanel3d, xMm: number): Vec2 => {
      const length = Math.hypot(panel.end.xMm - panel.start.xMm, panel.end.yMm - panel.start.yMm);
      const t = xMm / length;
      return {
        xMm: panel.start.xMm + (panel.end.xMm - panel.start.xMm) * t,
        yMm: panel.start.yMm + (panel.end.yMm - panel.start.yMm) * t
      };
    };
    const posA = floorOf(faceA, artA.xMm);
    const posB = floorOf(faceB, artB.xMm);
    expect(posA.xMm).toBeCloseTo(1500);
    expect(posB.xMm).toBeCloseTo(1500);
  });

  it("keeps blocked zones but drops nothing when there are no partitions", () => {
    const scene = deriveScene3d(makeProject([makePlacement(makeRoom("room-a", CCW_RECT, 2500))]));
    expect(scene.rooms[0].freestandingWalls).toEqual([]);
  });
});

// Independent mirror of the derivation's signed-area convention.
function signedArea(polygon: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return sum / 2;
}
