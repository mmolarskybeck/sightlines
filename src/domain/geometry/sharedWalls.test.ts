import { describe, expect, it } from "vitest";
import type { FreestandingWall, Project, RoomPlacement } from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import { createPolygonRoomPlacement, createRectangularRoomPlacement } from "./createRoom";
import { faceWallId } from "./freestandingWalls";
import {
  areSharedBoundaryWalls,
  findSharedBoundary,
  findSharedWallCounterpart,
  mirrorOpeningXMm,
  SHARED_BOUNDARY_MIN_OVERLAP_MM
} from "./sharedWalls";

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

// Wall-level topology: no opening dimensions anywhere in these cases. The
// point of the split is that whether two walls are one physical boundary can
// never change because a door moved or resized.
describe("findSharedBoundary", () => {
  it("confirms the coincident twin and reports the run the walls share", () => {
    const result = findSharedBoundary(project(room("room-a", 0), room("room-b", 4000)), A_EAST);

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.boundary.wallId).toBe(B_WEST);
    expect(result.boundary.gapMm).toBeCloseTo(0);
    // Equal-depth rooms back each other over the whole 3000 mm wall.
    expect(result.boundary.commonMinMm).toBeCloseTo(0);
    expect(result.boundary.commonMaxMm).toBeCloseTo(3000);
  });

  it("confirms within the gap tolerance and drops past it", () => {
    expect(
      findSharedBoundary(project(room("room-a", 0), room("room-b", 4200)), A_EAST).status
    ).toBe("confirmed");
    expect(
      findSharedBoundary(project(room("room-a", 0), room("room-b", 4300)), A_EAST).status
    ).toBe("none");
  });

  it("rejects same-direction, same-room, and partition-face candidates", () => {
    // Same direction: room-b's north wall runs the same way as room-a's.
    expect(
      findSharedBoundary(project(room("room-a", 0), room("room-b", 0, 200)), "room-a-wall-north")
        .status
    ).toBe("none");
    // Same room: a 200 mm-wide room's own east and west walls are anti-parallel
    // and coincident, but a boundary needs two rooms.
    expect(
      findSharedBoundary(project(room("room-a", 0, 0, { widthMm: 200 })), A_EAST).status
    ).toBe("none");
  });

  it("keeps a partial backer as a boundary, reporting only the overlapping run", () => {
    // room-b is shallower (depth 2000), so it backs only y ∈ [0, 2000] of
    // room-a's 3000 mm east wall. The WALLS still form one boundary — whether a
    // given door fits inside that run is a separate question, and this is
    // exactly where the old extent-based API returned "no counterpart" and
    // mislabelled a badly-placed door as an exterior one.
    const result = findSharedBoundary(
      project(room("room-a", 0), room("room-b", 4000, 0, { depthMm: 2000 })),
      A_EAST
    );

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    // A_EAST runs +y, so its local x equals floor y: the shallower neighbour
    // backs [0, 2000] and the last 1000 mm of the wall faces nothing.
    expect(result.boundary.commonMinMm).toBeCloseTo(0);
    expect(result.boundary.commonMaxMm).toBeCloseTo(2000);
  });

  it("keeps a narrow graze as a real boundary, bounded to the run it shares", () => {
    // A 200 mm overlap IS a shared boundary. The threshold is a bare geometry
    // epsilon, not a meaningful minimum: openings have any positive width, so no
    // opening-derived number belongs in wall topology. What keeps this harmless
    // is downstream — an opening on the wall's other 2800 mm intersects no
    // shared run and is simply exterior.
    expect(SHARED_BOUNDARY_MIN_OVERLAP_MM).toBe(1);

    const result = findSharedBoundary(
      project(room("room-a", 0), room("room-b", 4000, 2800)),
      A_EAST
    );
    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.boundary.commonMinMm).toBeCloseTo(2800);
    expect(result.boundary.commonMaxMm).toBeCloseTo(3000);
  });

  it("ignores neighbours that meet the wall at a mathematical point", () => {
    // Exactly corner-to-corner: zero shared run, so there is no boundary at all.
    expect(
      findSharedBoundary(project(room("room-a", 0), room("room-b", 4000, 3000)), A_EAST).status
    ).toBe("none");
  });

  // Regression for the splay defect: the walls are only NEAR-parallel, so
  // measuring separation at the shared run's midpoint alone let a wall whose far
  // end was well past the tolerance qualify — and an opening down at that end
  // would then have become a twin across a gap wider than the settled 250 mm.
  // The gap must bound the whole run, which means measuring both ends.
  describe("a near-parallel wall that splays", () => {
    // room-a's east wall runs +y at x = 4000, y ∈ [0, 3000]. This neighbour's
    // west wall runs −y from (4000 + farGapMm, 3000) to (4000 + nearGapMm, 0):
    // anti-parallel, tilted by atan(80 / 3000) ≈ 1.53° — inside the 2° angle
    // tolerance, so only the gap rule can reject it.
    function splayed(nearGapMm: number): { proj: Project; westWallId: string } {
      const placement = createPolygonRoomPlacement({
        roomId: "room-b",
        name: "room-b",
        heightMm: 2500,
        pointsFloorMm: [
          { xMm: 4000 + nearGapMm, yMm: 0 },
          { xMm: 8000, yMm: 0 },
          { xMm: 8000, yMm: 3000 },
          { xMm: 4000 + nearGapMm + 80, yMm: 3000 }
        ]
      });
      // The west edge is the only wall running −y.
      const vertexById = new Map(placement.room.vertices.map((vertex) => [vertex.id, vertex]));
      const westWall = placement.room.walls.find((wall) => {
        const start = vertexById.get(wall.startVertexId)!;
        const end = vertexById.get(wall.endVertexId)!;
        return end.yMm < start.yMm;
      })!;
      return { proj: project(room("room-a", 0), placement), westWallId: westWall.id };
    }

    it("rejects it when one end of the shared run exceeds the gap tolerance", () => {
      // 200 mm at y=0 rising to 280 mm at y=3000. The midpoint sits at 240 mm —
      // comfortably inside 250 — which is exactly what the old midpoint-only
      // test measured and accepted.
      const { proj, westWallId } = splayed(200);

      expect(findSharedBoundary(proj, A_EAST).status).toBe("none");
      expect(areSharedBoundaryWalls(proj, A_EAST, westWallId)).toBe(false);
      // Symmetric: neither wall may be the one that gets to decide.
      expect(areSharedBoundaryWalls(proj, westWallId, A_EAST)).toBe(false);
    });

    it("accepts it when the whole run stays inside the tolerance", () => {
      // 100 mm rising to 180 mm: splayed, but never out of tolerance anywhere.
      const { proj, westWallId } = splayed(100);

      const result = findSharedBoundary(proj, A_EAST);
      expect(result.status).toBe("confirmed");
      if (result.status !== "confirmed") return;
      expect(result.boundary.wallId).toBe(westWallId);
      // The reported gap is the worst end, not the average or the midpoint.
      expect(result.boundary.gapMm).toBeCloseTo(180, 0);
      expect(areSharedBoundaryWalls(proj, A_EAST, westWallId)).toBe(true);
      expect(areSharedBoundaryWalls(proj, westWallId, A_EAST)).toBe(true);
    });
  });

  it("reports ambiguity instead of picking the nearer wall", () => {
    // Two rooms both backing the same run — room-c overlaps room-b. The old
    // API tie-broke on smallest gap then wallId and silently chose one.
    const result = findSharedBoundary(
      project(room("room-a", 0), room("room-b", 4000), room("room-c", 4100)),
      A_EAST
    );

    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.boundaries.map((boundary) => boundary.wallId)).toEqual([
      B_WEST,
      "room-c-wall-west"
    ]);
  });

  it("reports ambiguity when two rooms back different halves of one wall", () => {
    // A legitimate plan: two 1500 mm-deep rooms stacked along room-a's east
    // wall. Wall-level discovery is genuinely ambiguous — the wall faces two
    // rooms. Narrowing to the one that backs a specific opening is the
    // analyzer's job, not this function's.
    const result = findSharedBoundary(
      project(
        room("room-a", 0),
        room("room-b", 4000, 0, { depthMm: 1500 }),
        room("room-c", 4000, 1500, { depthMm: 1500 })
      ),
      A_EAST
    );

    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    // Each backs its own half, and the halves are reported separately.
    const spans = result.boundaries.map((boundary) => [
      Math.round(boundary.commonMinMm),
      Math.round(boundary.commonMaxMm)
    ]);
    expect(spans).toContainEqual([0, 1500]);
    expect(spans).toContainEqual([1500, 3000]);
  });

  it("returns none for a wall with no neighbouring room", () => {
    expect(findSharedBoundary(project(room("room-a", 0)), A_EAST).status).toBe("none");
  });
});

describe("areSharedBoundaryWalls", () => {
  it("is symmetric for a coincident twin pair", () => {
    const proj = project(room("room-a", 0), room("room-b", 4000));
    expect(areSharedBoundaryWalls(proj, A_EAST, B_WEST)).toBe(true);
    expect(areSharedBoundaryWalls(proj, B_WEST, A_EAST)).toBe(true);
  });

  it("stays true for a resolved pair even when discovery is ambiguous", () => {
    // The regression this predicate exists to prevent: routing it through
    // findSharedBoundary would return "ambiguous" here, and an already-paired
    // door would flip to boundary-lost the moment an unrelated room moved in.
    const proj = project(room("room-a", 0), room("room-b", 4000), room("room-c", 4100));
    expect(findSharedBoundary(proj, A_EAST).status).toBe("ambiguous");
    expect(areSharedBoundaryWalls(proj, A_EAST, B_WEST)).toBe(true);
    expect(areSharedBoundaryWalls(proj, A_EAST, "room-c-wall-west")).toBe(true);
  });

  it("is false for unrelated, same-room, and missing walls", () => {
    const proj = project(room("room-a", 0), room("room-b", 4000));
    expect(areSharedBoundaryWalls(proj, "room-a-wall-north", "room-a-wall-south")).toBe(false);
    expect(areSharedBoundaryWalls(proj, A_EAST, "no-such-wall")).toBe(false);
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
