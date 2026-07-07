import { describe, expect, it } from "vitest";
import type { Project, Room, RoomPlacement, Wall } from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import {
  deriveScene3d,
  wallInwardNormal,
  type Vec2,
  type WallPanel3d
} from "./scene3d";

// --- Fixture helpers -------------------------------------------------------

// A closed wall loop over an ordered vertex ring: wall_i connects vertex_i to
// vertex_{i+1}, last wall closes back to vertex_0. Mirrors how createRoom.ts
// lays out its rooms, but lets a test pick any winding / polygon shape.
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

  return { id, name: id, heightMm, vertices: ring, walls };
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

function makeProject(placements: RoomPlacement[]): Project {
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
    wallObjects: [],
    floorObjects: [],
    createdAt: now,
    updatedAt: now
  };
}

// Counter-clockwise (positive signed area in math y-up) rectangle.
const CCW_RECT = [
  { id: "v0", xMm: 0, yMm: 0 },
  { id: "v1", xMm: 4000, yMm: 0 },
  { id: "v2", xMm: 4000, yMm: 3000 },
  { id: "v3", xMm: 0, yMm: 3000 }
];

// Same rectangle wound the other way (clockwise) — the derivation must
// normalise this so walls still face inward.
const CW_RECT = [
  { id: "v0", xMm: 0, yMm: 0 },
  { id: "v1", xMm: 0, yMm: 3000 },
  { id: "v2", xMm: 4000, yMm: 3000 },
  { id: "v3", xMm: 4000, yMm: 0 }
];

// --- Geometry assertions ---------------------------------------------------

function midpoint(panel: WallPanel3d): Vec2 {
  return {
    xMm: (panel.start.xMm + panel.end.xMm) / 2,
    yMm: (panel.start.yMm + panel.end.yMm) / 2
  };
}

// Ray-cast point-in-polygon (mm space). Used to prove an inward normal really
// points into the room rather than trusting a hand-computed vector.
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
    expect(deriveScene3d(makeProject([]))).toEqual({ rooms: [] });
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
    // Original corners shifted by (1000, 2000); order preserved (already CCW).
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

    // Vertex (4000, 0) rotated +90° about origin -> (0, 4000), then +offset.
    const rotated = scene.rooms[0].floorPolygon.map((point) => ({
      xMm: Math.round(point.xMm),
      yMm: Math.round(point.yMm)
    }));
    expect(rotated).toContainEqual({ xMm: 1000, yMm: 6000 });
    // Vertex (0, 3000) rotated +90° -> (-3000, 0), then +offset.
    expect(rotated).toContainEqual({ xMm: -2000, yMm: 2000 });
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

    // Floor polygon is re-wound to CCW (positive signed area).
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
    // Wall 0 runs (0,0)->(4000,0); inward normal is straight +y into the room.
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

// Local mirror of the derivation's signed-area convention, for the CW test.
function signedArea(polygon: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.xMm * b.yMm - b.xMm * a.yMm;
  }
  return sum / 2;
}
