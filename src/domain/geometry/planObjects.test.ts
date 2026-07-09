import { describe, expect, it } from "vitest";
import type { ArtworkFloorObject, Floor, Room } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import {
  WALL_OBJECT_PLAN_DEPTH_MM,
  findNearestWall,
  getFloorObjectPlanRect,
  getFloorWalls,
  getWallObjectPlanRect,
  planRectIntersectsRect,
  projectPointToWall
} from "./planObjects";

function angledRoom(): Room {
  return {
    id: "room-angled",
    name: "Angled Room",
    heightMm: feetToMm(12),
    freestandingWalls: [],
    vertices: [
      { id: "v-a", xMm: 0, yMm: 0 },
      { id: "v-b", xMm: 300, yMm: 400 } // 3-4-5 triangle: length 500
    ],
    walls: [
      {
        id: "wall-diag",
        roomId: "room-angled",
        name: "Diagonal wall",
        startVertexId: "v-a",
        endVertexId: "v-b",
        heightMm: feetToMm(12)
      }
    ]
  };
}

describe("getFloorWalls", () => {
  it("lifts room-local wall endpoints into floor coordinates using room offsets", () => {
    const room = angledRoom();
    const floor: Floor = {
      rooms: [
        { roomId: room.id, offsetXMm: 1000, offsetYMm: 2000, rotationDeg: 0, room }
      ]
    };

    const [wall] = getFloorWalls(floor);

    expect(wall.startFloorMm).toEqual({ xMm: 1000, yMm: 2000 });
    expect(wall.endFloorMm).toEqual({ xMm: 1300, yMm: 2400 });
    expect(wall.lengthMm).toBeCloseTo(500);
  });

  it("returns all walls across all rooms on the floor", () => {
    const project = createSampleProject();

    const walls = getFloorWalls(project.floor);

    expect(walls.map((w) => w.id).sort()).toEqual([
      "wall-east",
      "wall-north",
      "wall-south",
      "wall-west"
    ]);
  });

  it("applies zero offsets as a no-op (sample project rooms sit at origin)", () => {
    const project = createSampleProject();

    const walls = getFloorWalls(project.floor);
    const north = walls.find((w) => w.id === "wall-north")!;

    expect(north.startFloorMm).toEqual({ xMm: north.start.xMm, yMm: north.start.yMm });
    expect(north.endFloorMm).toEqual({ xMm: north.end.xMm, yMm: north.end.yMm });
  });
});

describe("projectPointToWall", () => {
  it("projects orthogonally onto a horizontal wall", () => {
    const project = createSampleProject();
    const [wall] = getFloorWalls(project.floor).filter((w) => w.id === "wall-north");

    const projection = projectPointToWall({ xMm: feetToMm(10), yMm: 500 }, wall);

    expect(projection.wallId).toBe("wall-north");
    expect(projection.xAlongMm).toBeCloseTo(feetToMm(10));
    expect(projection.distanceMm).toBeCloseTo(500);
    expect(projection.pointOnWallMm.xMm).toBeCloseTo(feetToMm(10));
    expect(projection.pointOnWallMm.yMm).toBeCloseTo(0);
  });

  it("projects orthogonally onto a vertical wall", () => {
    const project = createSampleProject();
    const [wall] = getFloorWalls(project.floor).filter((w) => w.id === "wall-east");

    // wall-east runs from (28ft,0) to (28ft,18ft)
    const point = { xMm: feetToMm(28) + 250, yMm: feetToMm(9) };
    const projection = projectPointToWall(point, wall);

    expect(projection.xAlongMm).toBeCloseTo(feetToMm(9));
    expect(projection.distanceMm).toBeCloseTo(250);
    expect(projection.pointOnWallMm.xMm).toBeCloseTo(feetToMm(28));
    expect(projection.pointOnWallMm.yMm).toBeCloseTo(feetToMm(9));
  });

  it("projects onto an angled (3-4-5) wall with room offset applied", () => {
    const room = angledRoom();
    const floor: Floor = {
      rooms: [{ roomId: room.id, offsetXMm: 100, offsetYMm: 100, rotationDeg: 0, room }]
    };
    const [wall] = getFloorWalls(floor);

    // Midpoint of the wall in floor space is (100+150, 100+200) = (250, 300).
    // Offset perpendicular to the wall direction (0.6,0.8) by 50mm along the
    // normal (-0.8, 0.6): point = (250 - 40, 300 + 30) = (210, 330).
    const projection = projectPointToWall({ xMm: 210, yMm: 330 }, wall);

    expect(projection.xAlongMm).toBeCloseTo(250, 0);
    expect(projection.distanceMm).toBeCloseTo(50, 0);
    expect(projection.pointOnWallMm.xMm).toBeCloseTo(250, 0);
    expect(projection.pointOnWallMm.yMm).toBeCloseTo(300, 0);
  });

  it("clamps xAlongMm and distance to the nearer wall end when the projection falls beyond it", () => {
    const project = createSampleProject();
    const [wall] = getFloorWalls(project.floor).filter((w) => w.id === "wall-north");

    // Beyond the start (west) end.
    const beforeStart = projectPointToWall({ xMm: -500, yMm: 300 }, wall);
    expect(beforeStart.xAlongMm).toBe(0);
    expect(beforeStart.pointOnWallMm.xMm).toBeCloseTo(0);
    expect(beforeStart.pointOnWallMm.yMm).toBeCloseTo(0);
    expect(beforeStart.distanceMm).toBeCloseTo(Math.hypot(500, 300));

    // Beyond the end (east) end.
    const afterEnd = projectPointToWall({ xMm: feetToMm(28) + 500, yMm: 300 }, wall);
    expect(afterEnd.xAlongMm).toBeCloseTo(wall.lengthMm);
    expect(afterEnd.pointOnWallMm.xMm).toBeCloseTo(feetToMm(28));
    expect(afterEnd.pointOnWallMm.yMm).toBeCloseTo(0);
    expect(afterEnd.distanceMm).toBeCloseTo(Math.hypot(500, 300));
  });
});

describe("findNearestWall", () => {
  it("picks the nearest wall among several candidates", () => {
    const project = createSampleProject();
    const walls = getFloorWalls(project.floor);

    // Point just south of the north wall, well inside the room otherwise.
    const point = { xMm: feetToMm(14), yMm: 50 };

    const nearest = findNearestWall(point, walls, feetToMm(20));

    expect(nearest?.wallId).toBe("wall-north");
  });

  it("returns null when nothing is within maxDistanceMm", () => {
    const project = createSampleProject();
    const walls = getFloorWalls(project.floor);

    const point = { xMm: feetToMm(14), yMm: feetToMm(9) }; // room center
    const nearest = findNearestWall(point, walls, 100);

    expect(nearest).toBeNull();
  });

  it("respects maxDistanceMm as an inclusive-vs-exclusive boundary consistently", () => {
    const project = createSampleProject();
    const walls = getFloorWalls(project.floor).filter((w) => w.id === "wall-north");

    const point = { xMm: feetToMm(10), yMm: 500 };
    const exact = findNearestWall(point, walls, 500);
    const short = findNearestWall(point, walls, 499);

    expect(exact?.wallId).toBe("wall-north");
    expect(short).toBeNull();
  });

  it("breaks ties deterministically by wallId when two walls are equidistant", () => {
    const project = createSampleProject();
    const walls = getFloorWalls(project.floor);

    // Room corner: equidistant (0) from wall-north and wall-west, both meeting at v-nw.
    const point = { xMm: 0, yMm: 0 };

    const nearest = findNearestWall(point, walls, 10);

    // Deterministic pick: lexicographically smallest wallId among ties.
    const tied = walls
      .map((wall) => ({ wallId: wall.id, distance: projectPointToWall(point, wall).distanceMm }))
      .filter((entry) => entry.distance <= 10)
      .sort((a, b) => a.wallId.localeCompare(b.wallId));

    expect(nearest?.wallId).toBe(tied[0].wallId);
  });

  it("returns null for an empty wall list", () => {
    expect(findNearestWall({ xMm: 0, yMm: 0 }, [], 1000)).toBeNull();
  });
});

describe("getWallObjectPlanRect", () => {
  it("centers the rect on the wall line at the given distance along a horizontal wall", () => {
    const project = createSampleProject();
    const [wall] = getFloorWalls(project.floor).filter((w) => w.id === "wall-north");

    const rect = getWallObjectPlanRect(wall, { xMm: feetToMm(10), widthMm: 900 });

    expect(rect.centerXMm).toBeCloseTo(feetToMm(10));
    expect(rect.centerYMm).toBeCloseTo(0);
    expect(rect.widthMm).toBe(900);
    expect(rect.depthMm).toBe(WALL_OBJECT_PLAN_DEPTH_MM);
    expect(rect.angleDeg).toBeCloseTo(0);
  });

  it("computes angleDeg from the wall's floor-space direction for a vertical wall", () => {
    const project = createSampleProject();
    const [wall] = getFloorWalls(project.floor).filter((w) => w.id === "wall-east");

    const rect = getWallObjectPlanRect(wall, { xMm: feetToMm(9), widthMm: 900 });

    expect(rect.centerXMm).toBeCloseTo(feetToMm(28));
    expect(rect.centerYMm).toBeCloseTo(feetToMm(9));
    expect(rect.angleDeg).toBeCloseTo(90);
  });

  it("places objects at different xMm proportionally along an angled wall", () => {
    const room = angledRoom();
    const floor: Floor = {
      rooms: [{ roomId: room.id, offsetXMm: 0, offsetYMm: 0, rotationDeg: 0, room }]
    };
    const [wall] = getFloorWalls(floor);

    const atStart = getWallObjectPlanRect(wall, { xMm: 0, widthMm: 100 });
    const atMid = getWallObjectPlanRect(wall, { xMm: 250, widthMm: 100 });
    const atEnd = getWallObjectPlanRect(wall, { xMm: 500, widthMm: 100 });

    expect(atStart.centerXMm).toBeCloseTo(0);
    expect(atStart.centerYMm).toBeCloseTo(0);
    expect(atMid.centerXMm).toBeCloseTo(150);
    expect(atMid.centerYMm).toBeCloseTo(200);
    expect(atEnd.centerXMm).toBeCloseTo(300);
    expect(atEnd.centerYMm).toBeCloseTo(400);

    const expectedAngleDeg = (Math.atan2(400, 300) * 180) / Math.PI;
    expect(atMid.angleDeg).toBeCloseTo(expectedAngleDeg);
  });

  it("defaults depth to WALL_OBJECT_PLAN_DEPTH_MM and accepts an override", () => {
    const project = createSampleProject();
    const [wall] = getFloorWalls(project.floor).filter((w) => w.id === "wall-north");

    const defaulted = getWallObjectPlanRect(wall, { xMm: 100, widthMm: 900 });
    const overridden = getWallObjectPlanRect(wall, { xMm: 100, widthMm: 900 }, 250);

    expect(defaulted.depthMm).toBe(WALL_OBJECT_PLAN_DEPTH_MM);
    expect(overridden.depthMm).toBe(250);
  });
});

describe("getFloorObjectPlanRect", () => {
  it("passes through the floor object's own center, footprint, and rotation", () => {
    const object: ArtworkFloorObject = {
      id: "floor-art-1",
      kind: "artwork",
      artworkId: "artwork-1",
      xMm: 1234,
      yMm: 5678,
      widthMm: 900,
      depthMm: 400,
      rotationDeg: 37,
      heightMm: 600,
      wallYMm: 1448
    };

    const rect = getFloorObjectPlanRect(object);

    expect(rect).toEqual({
      centerXMm: 1234,
      centerYMm: 5678,
      widthMm: 900,
      depthMm: 400,
      angleDeg: 37
    });
  });
});

describe("planRectIntersectsRect", () => {
  it("reports overlap for an unrotated rect that overlaps the marquee", () => {
    const planRect = {
      centerXMm: 100,
      centerYMm: 100,
      widthMm: 200,
      depthMm: 200,
      angleDeg: 0
    };
    // Marquee covering the rect's bottom-right quadrant and beyond.
    const rect = { minXMm: 150, maxXMm: 400, minYMm: 150, maxYMm: 400 };

    expect(planRectIntersectsRect(planRect, rect)).toBe(true);
  });

  it("reports no overlap for an unrotated rect clear of the marquee", () => {
    const planRect = {
      centerXMm: 100,
      centerYMm: 100,
      widthMm: 200,
      depthMm: 200,
      angleDeg: 0
    };
    // Rect spans x [0,200]; marquee starts at x=300 — a clean gap on world x.
    const rect = { minXMm: 300, maxXMm: 400, minYMm: 0, maxYMm: 200 };

    expect(planRectIntersectsRect(planRect, rect)).toBe(false);
  });

  it("counts edge-touch as intersecting (inclusive, matching getIdsIntersectingRect)", () => {
    const planRect = {
      centerXMm: 100,
      centerYMm: 100,
      widthMm: 200,
      depthMm: 200,
      angleDeg: 0
    };
    // Rect's right edge sits exactly at x=200; marquee's left edge starts there.
    const rect = { minXMm: 200, maxXMm: 400, minYMm: 0, maxYMm: 200 };

    expect(planRectIntersectsRect(planRect, rect)).toBe(true);
  });

  it("returns false for a 45°-rotated rect whose bounding box overlaps but whose shape does not", () => {
    // A 45°-rotated square of side 200 centered at the origin: its corners are
    // at (±~141, 0) and (0, ±~141), so its axis-aligned bounding box spans
    // roughly [-141,141]². A tiny marquee tucked into the bounding box's corner
    // overlaps that box but lies entirely OUTSIDE the diamond — the case a
    // plain AABB test would get wrong and SAT gets right.
    const planRect = {
      centerXMm: 0,
      centerYMm: 0,
      widthMm: 200,
      depthMm: 200,
      angleDeg: 45
    };
    const rect = { minXMm: 120, maxXMm: 140, minYMm: 120, maxYMm: 140 };

    expect(planRectIntersectsRect(planRect, rect)).toBe(false);
  });

  it("returns true for a rotated rect genuinely overlapping the marquee", () => {
    // Same diamond, but the marquee straddles its right vertex (~141, 0).
    const planRect = {
      centerXMm: 0,
      centerYMm: 0,
      widthMm: 200,
      depthMm: 200,
      angleDeg: 45
    };
    const rect = { minXMm: 100, maxXMm: 200, minYMm: -20, maxYMm: 20 };

    expect(planRectIntersectsRect(planRect, rect)).toBe(true);
  });

  it("returns true when the marquee sits fully inside the plan rect", () => {
    const planRect = {
      centerXMm: 0,
      centerYMm: 0,
      widthMm: 400,
      depthMm: 400,
      angleDeg: 30
    };
    const rect = { minXMm: -20, maxXMm: 20, minYMm: -20, maxYMm: 20 };

    expect(planRectIntersectsRect(planRect, rect)).toBe(true);
  });
});
