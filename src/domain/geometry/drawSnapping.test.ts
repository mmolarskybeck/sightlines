import { describe, expect, it } from "vitest";
import { canCloseOnWall, snapDrawPointToRooms } from "./drawSnapping";
import type { FloorWall } from "./planObjects";
import type { Point } from "../snapping/resolveSnap";

// Minimal FloorWall: snapDrawPointToRooms / canCloseOnWall only read id,
// startFloorMm, endFloorMm, lengthMm. A horizontal wall start→end unless given
// explicit endpoints. Cast keeps the fixture from having to invent every
// WallWithGeometry field the real derivation fills in.
function wall(
  id: string,
  startFloorMm: Point,
  endFloorMm: Point
): FloorWall {
  return {
    id,
    startFloorMm,
    endFloorMm,
    lengthMm: Math.hypot(endFloorMm.xMm - startFloorMm.xMm, endFloorMm.yMm - startFloorMm.yMm)
  } as unknown as FloorWall;
}

// A 2000mm horizontal wall from (0,0) to (2000,0).
const horizontal = wall("room-a-wall-1", { xMm: 0, yMm: 0 }, { xMm: 2000, yMm: 0 });

describe("snapDrawPointToRooms", () => {
  it("snaps to a wall endpoint (vertex) at its exact position", () => {
    const result = snapDrawPointToRooms({ xMm: 30, yMm: 20 }, [horizontal], 100);
    expect(result).toEqual({
      pointMm: { xMm: 0, yMm: 0 },
      kind: "vertex",
      wallId: "room-a-wall-1"
    });
  });

  it("snaps to the clamped orthogonal projection (edge) mid-segment", () => {
    const result = snapDrawPointToRooms({ xMm: 1000, yMm: 40 }, [horizontal], 100);
    expect(result).toEqual({
      pointMm: { xMm: 1000, yMm: 0 },
      kind: "edge",
      wallId: "room-a-wall-1"
    });
  });

  it("prefers a vertex over an edge when both are within threshold", () => {
    // Near the (0,0) endpoint: the endpoint (vertex) is ~50mm away, the edge
    // projection is directly below at 30mm — vertex must still win.
    const result = snapDrawPointToRooms({ xMm: 40, yMm: 30 }, [horizontal], 100);
    expect(result?.kind).toBe("vertex");
    expect(result?.pointMm).toEqual({ xMm: 0, yMm: 0 });
  });

  it("returns null when nothing is within threshold", () => {
    expect(snapDrawPointToRooms({ xMm: 1000, yMm: 500 }, [horizontal], 100)).toBeNull();
  });

  it("honors the threshold boundary (in vs out)", () => {
    // Edge projection distance is exactly the vertical gap to the segment.
    expect(snapDrawPointToRooms({ xMm: 1000, yMm: 100 }, [horizontal], 100)).not.toBeNull();
    expect(snapDrawPointToRooms({ xMm: 1000, yMm: 101 }, [horizontal], 100)).toBeNull();
  });

  it("never snaps to partition faces (perimeter walls only)", () => {
    const faceA = wall("room-a-partition-1#a", { xMm: 0, yMm: 0 }, { xMm: 2000, yMm: 0 });
    const result = snapDrawPointToRooms({ xMm: 1000, yMm: 10 }, [faceA], 100);
    expect(result).toBeNull();
  });

  it("still snaps to a perimeter wall even when a partition face is closer", () => {
    const face = wall("room-a-partition-1#b", { xMm: 1000, yMm: 5 }, { xMm: 1000, yMm: 5 });
    const result = snapDrawPointToRooms({ xMm: 1000, yMm: 8 }, [face, horizontal], 100);
    expect(result?.wallId).toBe("room-a-wall-1");
    expect(result?.kind).toBe("edge");
  });

  it("breaks vertex ties deterministically by wallId.localeCompare", () => {
    // Two walls share the corner (0,0); the cursor is equidistant from both.
    const wallB = wall("room-a-wall-9", { xMm: 0, yMm: 0 }, { xMm: 0, yMm: 2000 });
    // Present them in an order where iteration order would pick wall-9 first.
    const result = snapDrawPointToRooms({ xMm: 20, yMm: 20 }, [wallB, horizontal], 100);
    expect(result?.wallId).toBe("room-a-wall-1");
  });

  it("clamps an edge projection to the nearest endpoint region without going off-segment", () => {
    // Cursor beyond the wall's end: projection clamps to the (2000,0) endpoint,
    // which reads as a vertex snap (distance to the endpoint is small).
    const result = snapDrawPointToRooms({ xMm: 2010, yMm: 5 }, [horizontal], 100);
    expect(result?.kind).toBe("vertex");
    expect(result?.pointMm).toEqual({ xMm: 2000, yMm: 0 });
  });
});

describe("canCloseOnWall", () => {
  // Three points drawn off the horizontal wall: first vertex sits ON the wall
  // at (500,0); the candidate returns to the wall at (1500,0).
  const points: Point[] = [
    { xMm: 500, yMm: 0 },
    { xMm: 500, yMm: 800 },
    { xMm: 1500, yMm: 800 }
  ];

  it("closes when first vertex and candidate both lie on the wall span", () => {
    expect(canCloseOnWall(points, { xMm: 1500, yMm: 0 }, horizontal)).toBe(true);
  });

  it("closes onto a shared endpoint (vertex) of the wall", () => {
    const fromCorner: Point[] = [
      { xMm: 0, yMm: 0 },
      { xMm: 0, yMm: 800 },
      { xMm: 1500, yMm: 800 }
    ];
    expect(canCloseOnWall(fromCorner, { xMm: 2000, yMm: 0 }, horizontal)).toBe(true);
  });

  it("rejects when the first vertex is off the wall line", () => {
    const off: Point[] = [
      { xMm: 500, yMm: 50 },
      { xMm: 500, yMm: 800 },
      { xMm: 1500, yMm: 800 }
    ];
    expect(canCloseOnWall(off, { xMm: 1500, yMm: 0 }, horizontal)).toBe(false);
  });

  it("rejects when the candidate is off the wall line", () => {
    expect(canCloseOnWall(points, { xMm: 1500, yMm: 50 }, horizontal)).toBe(false);
  });

  it("rejects when the first vertex projects beyond the segment span", () => {
    const beyond: Point[] = [
      { xMm: 2500, yMm: 0 },
      { xMm: 2500, yMm: 800 },
      { xMm: 1500, yMm: 800 }
    ];
    expect(canCloseOnWall(beyond, { xMm: 1500, yMm: 0 }, horizontal)).toBe(false);
  });

  it("rejects fewer than three points", () => {
    expect(
      canCloseOnWall([{ xMm: 500, yMm: 0 }, { xMm: 500, yMm: 800 }], { xMm: 1500, yMm: 0 }, horizontal)
    ).toBe(false);
  });
});
