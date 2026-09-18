import { describe, expect, it } from "vitest";
import { getPlaceableFloorWalls, type FloorWall } from "../../../domain/geometry/planObjects";
import type { Floor, Project, Room, ShelfWallObject } from "../../../domain/project";
import { MM_TO_WORLD } from "./coordinates";
import type { DropDimsMm } from "./dropTarget";
import {
  dragMoveIsMeaningful,
  exceedsDragThreshold,
  grabOffsetMm,
  projectWithDragPreview,
  resolveDragMove,
  type DragSurfaceHit,
  type ThreeDragSource
} from "./objectDrag";

const ROOM_HEIGHT_MM = 3000;

// The same 4m x 3m box room dropTarget.test.ts uses: wall-0 runs (0,0)->(4000,0)
// and wall-1 runs (4000,0)->(4000,3000), so a hit's wall-local x is readable by
// hand in both.
function boxRoom(): Room {
  const vertices = [
    { id: "v-a", xMm: 0, yMm: 0 },
    { id: "v-b", xMm: 4000, yMm: 0 },
    { id: "v-c", xMm: 4000, yMm: 3000 },
    { id: "v-d", xMm: 0, yMm: 3000 }
  ];
  return {
    id: "room-1",
    name: "Room",
    heightMm: ROOM_HEIGHT_MM,
    freestandingWalls: [],
    vertices,
    walls: vertices.map((vertex, index) => ({
      id: `wall-${index}`,
      roomId: "room-1",
      name: `Wall ${index}`,
      startVertexId: vertex.id,
      endVertexId: vertices[(index + 1) % vertices.length].id,
      heightMm: ROOM_HEIGHT_MM
    }))
  };
}

const floor: Floor = {
  rooms: [{ roomId: "room-1", offsetXMm: 0, offsetYMm: 0, rotationDeg: 0, room: boxRoom() }]
};
const walls: FloorWall[] = getPlaceableFloorWalls(floor);

function worldHit(xMm: number, heightMm: number, yMm: number) {
  return { x: xMm * MM_TO_WORLD, y: heightMm * MM_TO_WORLD, z: yMm * MM_TO_WORLD };
}

function wallSurface(wallId: string, xMm: number, heightMm: number, yMm: number): DragSurfaceHit {
  return { tag: { kind: "wall", wallId }, point: worldHit(xMm, heightMm, yMm) };
}

function floorSurface(xMm: number, yMm: number): DragSurfaceHit {
  return { tag: { kind: "floor", roomId: "room-1" }, point: worldHit(xMm, 0, yMm) };
}

const dims: DropDimsMm = {
  wallWidthMm: 600,
  wallHeightMm: 800,
  floorWidthMm: 600,
  floorDepthMm: 400
};

// A work hung on wall-0, centred 1000mm along it at 1500mm up.
const wallSource: ThreeDragSource = {
  anchor: "wall",
  objectId: "obj-1",
  wallId: "wall-0",
  xMm: 1000,
  yMm: 1500,
  dims
};

const floorSource: ThreeDragSource = {
  anchor: "floor",
  objectId: "obj-2",
  xMm: 1000,
  yMm: 800,
  dims
};

describe("exceedsDragThreshold", () => {
  it("is false at exactly the threshold and true past it", () => {
    expect(exceedsDragThreshold(6, 0, 6)).toBe(false);
    expect(exceedsDragThreshold(0, 6, 6)).toBe(false);
    expect(exceedsDragThreshold(7, 0, 6)).toBe(true);
    // Diagonal travel counts as travel: 5,5 is ~7.07px.
    expect(exceedsDragThreshold(5, 5, 6)).toBe(true);
  });
});

describe("grabOffsetMm", () => {
  it("measures the grip from the raw wall projection, not the clamped one", () => {
    // Pressed at 700mm along wall-0, 1200mm up, on a work centred at 1000/1500.
    const offset = grabOffsetMm({
      surface: wallSurface("wall-0", 700, 1200, 0),
      source: wallSource,
      walls
    });
    expect(offset.xMm).toBeCloseTo(300, 6);
    expect(offset.yMm).toBeCloseTo(300, 6);
  });

  it("is zero when the press resolved onto a different wall", () => {
    expect(
      grabOffsetMm({ surface: wallSurface("wall-1", 4000, 1200, 500), source: wallSource, walls })
    ).toEqual({ xMm: 0, yMm: 0 });
  });

  it("is zero when the press resolved onto no surface at all", () => {
    expect(grabOffsetMm({ surface: null, source: wallSource, walls })).toEqual({
      xMm: 0,
      yMm: 0
    });
  });

  it("measures a floor grip in floor space", () => {
    const offset = grabOffsetMm({
      surface: floorSurface(900, 700),
      source: floorSource,
      walls
    });
    expect(offset.xMm).toBeCloseTo(100, 6);
    expect(offset.yMm).toBeCloseTo(100, 6);
  });
});

describe("resolveDragMove", () => {
  it("slides a wall work along its wall, keeping the grip", () => {
    const move = resolveDragMove({
      surface: wallSurface("wall-0", 1700, 1000, 0),
      source: wallSource,
      offsetMm: { xMm: 300, yMm: 300 },
      walls
    });
    expect(move).toEqual({ anchor: "wall", wallId: "wall-0", xMm: 2000, yMm: 1300 });
  });

  it("clamps the offset placement so the work stays whole on the wall", () => {
    const move = resolveDragMove({
      surface: wallSurface("wall-0", 3950, 2900, 0),
      source: wallSource,
      offsetMm: { xMm: 300, yMm: 300 },
      walls
    });
    // 3950 + 300 would put the 600-wide work's edge past the 4000mm wall end.
    expect(move).toEqual({
      anchor: "wall",
      wallId: "wall-0",
      xMm: 4000 - 300,
      yMm: ROOM_HEIGHT_MM - 400
    });
  });

  it("hops to another wall and drops the origin wall's grip", () => {
    const move = resolveDragMove({
      surface: wallSurface("wall-1", 4000, 1000, 1200),
      source: wallSource,
      offsetMm: { xMm: 300, yMm: 300 },
      walls
    });
    // Centred under the cursor on the new wall — the offset is not carried.
    expect(move).toEqual({ anchor: "wall", wallId: "wall-1", xMm: 1200, yMm: 1000 });
  });

  it("holds the last placement when a wall work crosses the floor", () => {
    expect(
      resolveDragMove({
        surface: floorSurface(1200, 900),
        source: wallSource,
        offsetMm: { xMm: 0, yMm: 0 },
        walls
      })
    ).toBeNull();
  });

  it("holds the last placement when the hit wall is not placeable", () => {
    expect(
      resolveDragMove({
        surface: wallSurface("wall-from-another-floor", 1000, 1000, 0),
        source: wallSource,
        offsetMm: { xMm: 0, yMm: 0 },
        walls
      })
    ).toBeNull();
  });

  it("moves a floor object across the floor plane, keeping the grip", () => {
    const move = resolveDragMove({
      surface: floorSurface(2000, 1500),
      source: floorSource,
      offsetMm: { xMm: 100, yMm: 100 },
      walls
    });
    expect(move).toEqual({ anchor: "floor", xMm: 2100, yMm: 1600 });
  });

  it("holds the last placement when a floor object crosses a wall", () => {
    expect(
      resolveDragMove({
        surface: wallSurface("wall-0", 1000, 1500, 0),
        source: floorSource,
        offsetMm: { xMm: 0, yMm: 0 },
        walls
      })
    ).toBeNull();
  });

  it("holds the last placement with nothing under the cursor", () => {
    expect(
      resolveDragMove({ surface: null, source: floorSource, offsetMm: { xMm: 0, yMm: 0 }, walls })
    ).toBeNull();
  });
});

describe("dragMoveIsMeaningful", () => {
  it("rejects a sub-millimetre wobble on the same wall", () => {
    expect(
      dragMoveIsMeaningful(wallSource, {
        anchor: "wall",
        wallId: "wall-0",
        xMm: 1000.2,
        yMm: 1500
      })
    ).toBe(false);
  });

  it("accepts a real slide, and any wall change however small", () => {
    expect(
      dragMoveIsMeaningful(wallSource, { anchor: "wall", wallId: "wall-0", xMm: 1010, yMm: 1500 })
    ).toBe(true);
    expect(
      dragMoveIsMeaningful(wallSource, { anchor: "wall", wallId: "wall-1", xMm: 1000, yMm: 1500 })
    ).toBe(true);
  });

  it("applies the same floor of movement on the floor", () => {
    expect(dragMoveIsMeaningful(floorSource, { anchor: "floor", xMm: 1000.1, yMm: 800 })).toBe(
      false
    );
    expect(dragMoveIsMeaningful(floorSource, { anchor: "floor", xMm: 1005, yMm: 800 })).toBe(true);
  });
});

describe("projectWithDragPreview", () => {
  const project = {
    id: "p1",
    floor,
    wallObjects: [
      {
        id: "obj-1",
        kind: "artwork",
        artworkId: "a1",
        wallId: "wall-0",
        xMm: 1000,
        yMm: 1500,
        widthMm: 600,
        heightMm: 800
      }
    ],
    floorObjects: [
      {
        id: "obj-2",
        kind: "artwork",
        artworkId: "a2",
        xMm: 1000,
        yMm: 800,
        widthMm: 600,
        depthMm: 400,
        heightMm: 900,
        rotationDeg: 0
      }
    ]
  } as unknown as Project;

  it("returns the project by reference when there is no live move", () => {
    expect(projectWithDragPreview(project, "obj-1", null)).toBe(project);
  });

  it("returns the project by reference when the move changes nothing", () => {
    expect(
      projectWithDragPreview(project, "obj-1", {
        anchor: "wall",
        wallId: "wall-0",
        xMm: 1000,
        yMm: 1500
      })
    ).toBe(project);
  });

  it("re-anchors and repositions the wall object without touching the rest", () => {
    const next = projectWithDragPreview(project, "obj-1", {
      anchor: "wall",
      wallId: "wall-1",
      xMm: 500,
      yMm: 1200
    });
    expect(next).not.toBe(project);
    expect(next.wallObjects[0]).toMatchObject({ wallId: "wall-1", xMm: 500, yMm: 1200 });
    expect(next.floorObjects).toBe(project.floorObjects);
  });

  it("repositions a floor object without touching the wall objects", () => {
    const next = projectWithDragPreview(project, "obj-2", {
      anchor: "floor",
      xMm: 2500,
      yMm: 1750
    });
    expect(next.floorObjects[0]).toMatchObject({ xMm: 2500, yMm: 1750 });
    expect(next.wallObjects).toBe(project.wallObjects);
  });
});

// A 1200-wide slab on wall-0 whose top face is at 1000mm.
const SHELF: ShelfWallObject = {
  id: "shelf-1",
  kind: "shelf",
  wallId: "wall-0",
  xMm: 3000,
  yMm: 980,
  widthMm: 1200,
  heightMm: 40,
  depthMm: 300
};

describe("resolveDragMove shelf seating", () => {
  const artworkSource: ThreeDragSource = {
    anchor: "wall",
    objectId: "obj-1",
    kind: "artwork",
    wallId: "wall-0",
    xMm: 3000,
    yMm: 1500,
    dims: { wallWidthMm: 600, wallHeightMm: 800, floorWidthMm: 600, floorDepthMm: 400 }
  };
  const noOffset = { xMm: 0, yMm: 0 };

  it("stands a dragged work on the slab and names the shelf", () => {
    expect(
      resolveDragMove({
        // Bottom edge at 1100, 100mm above the slab's 1000 top face.
        surface: wallSurface("wall-0", 3000, 1500, 0),
        source: artworkSource,
        offsetMm: noOffset,
        walls,
        wallObjects: [SHELF],
        seatOnShelves: true
      })
    ).toEqual({ anchor: "wall", wallId: "wall-0", xMm: 3000, yMm: 1400, shelfId: "shelf-1" });
  });

  it("hangs freely when the caller withholds seating (the ⌘/Ctrl bypass)", () => {
    const move = resolveDragMove({
      surface: wallSurface("wall-0", 3000, 1500, 0),
      source: artworkSource,
      offsetMm: noOffset,
      walls,
      wallObjects: [SHELF],
      seatOnShelves: false
    });
    expect(move).toMatchObject({ yMm: 1500 });
    expect(move!.anchor === "wall" && move!.shelfId).toBeUndefined();
  });

  it("never seats a NON-artwork wall object, even when asked to", () => {
    const move = resolveDragMove({
      surface: wallSurface("wall-0", 3000, 1500, 0),
      source: { ...artworkSource, kind: "case" },
      offsetMm: noOffset,
      walls,
      wallObjects: [SHELF],
      seatOnShelves: true
    });
    expect(move).toMatchObject({ yMm: 1500 });
    expect(move!.anchor === "wall" && move!.shelfId).toBeUndefined();
  });

  it("never seats an object on itself", () => {
    const move = resolveDragMove({
      surface: wallSurface("wall-0", 3000, 1500, 0),
      source: { ...artworkSource, objectId: "shelf-1" },
      offsetMm: noOffset,
      walls,
      wallObjects: [SHELF],
      seatOnShelves: true
    });
    expect(move!.anchor === "wall" && move!.shelfId).toBeUndefined();
  });
});

// A SHELF ASSEMBLY dragged in 3D: the slab plus the works standing on it, moved
// as one rigid body (the plan's rule of record, resolveShelfAssemblyMove), and
// STICKY to its own wall until the view arms a hop (SHELF_WALL_HOP_PX).
describe("resolveDragMove shelf assembly", () => {
  const noOffset = { xMm: 0, yMm: 0 };

  // A 1200-wide slab centred at 2000 along wall-0, carrying two works: one
  // overhanging the left end by 50mm, one reaching 50mm past the right end.
  // Union along the wall is therefore [-650, +650] about the slab centre, and
  // [-20, +820] vertically (the taller work's top).
  const assemblySource: ThreeDragSource = {
    anchor: "wall",
    objectId: "shelf-1",
    kind: "shelf",
    wallId: "wall-0",
    xMm: 2000,
    yMm: 980,
    dims: { wallWidthMm: 1200, wallHeightMm: 40, floorWidthMm: 1200, floorDepthMm: 300 },
    riders: [
      { id: "work-a", offsetMm: { xMm: -400, yMm: 420 }, widthMm: 500, heightMm: 800 },
      { id: "work-b", offsetMm: { xMm: 450, yMm: 320 }, widthMm: 400, heightMm: 600 }
    ]
  };

  it("stays on its own wall while stuck, sliding to that wall's end", () => {
    // Cursor is over wall-1, 1500 along it — but the slab is stuck to wall-0,
    // so the same world point projects onto wall-0 (past its end) and the
    // assembly parks with its widest member flush to the corner.
    const move = resolveDragMove({
      surface: wallSurface("wall-1", 4000, 1200, 1500),
      source: assemblySource,
      offsetMm: noOffset,
      walls,
      stickToWallId: "wall-0"
    });

    expect(move).toMatchObject({ anchor: "wall", wallId: "wall-0", xMm: 3350, yMm: 1200 });
    // The union's right edge sits exactly on the wall's end, not the slab's.
    expect(move!.anchor === "wall" && move!.riders).toEqual([
      { id: "work-a", xMm: 2950, yMm: 1620 },
      { id: "work-b", xMm: 3800, yMm: 1520 }
    ]);
  });

  it("hops when the view arms it, carrying the riders at their own offsets", () => {
    const move = resolveDragMove({
      surface: wallSurface("wall-1", 4000, 1200, 1500),
      source: assemblySource,
      offsetMm: noOffset,
      walls
    });

    expect(move).toMatchObject({ anchor: "wall", wallId: "wall-1", xMm: 1500 });
    const riders = move!.anchor === "wall" ? move!.riders! : [];
    expect(riders.map((rider) => rider.xMm - 1500)).toEqual([-400, 450]);
    expect(riders.map((rider) => rider.yMm - move!.yMm)).toEqual([420, 320]);
  });

  it("refuses a hop onto a wall the assembly cannot fit", () => {
    const tooWide: ThreeDragSource = {
      ...assemblySource,
      riders: [
        { id: "work-a", offsetMm: { xMm: -1600, yMm: 420 }, widthMm: 500, heightMm: 800 },
        { id: "work-b", offsetMm: { xMm: 1600, yMm: 420 }, widthMm: 500, heightMm: 800 }
      ]
    };

    // 3700 of union against wall-1's 3000: there is no placement that keeps it
    // whole, so the drag holds its last move rather than deforming the group.
    expect(
      resolveDragMove({
        surface: wallSurface("wall-1", 4000, 1200, 1500),
        source: tooWide,
        offsetMm: noOffset,
        walls
      })
    ).toBeNull();
    // Its OWN wall is never refused — the assembly is already standing there.
    expect(
      resolveDragMove({
        surface: wallSurface("wall-0", 2000, 1200, 0),
        source: tooWide,
        offsetMm: noOffset,
        walls
      })
    ).toMatchObject({ wallId: "wall-0" });
  });

  it("clamps vertically on the UNION, so the tallest rider stays on the wall", () => {
    const move = resolveDragMove({
      // Dragged near the top of a 3000-high wall.
      surface: wallSurface("wall-0", 2000, 2900, 0),
      source: assemblySource,
      offsetMm: noOffset,
      walls
    });

    expect(move).toMatchObject({ yMm: 2180 });
    const riders = move!.anchor === "wall" ? move!.riders! : [];
    // work-a is 800 tall, centred 420 above the slab: its top lands exactly on
    // the wall's ceiling rather than being clipped by it.
    expect(riders[0]!.yMm + 800 / 2).toBe(3000);
  });

  it("keeps the grip while stuck and drops it on a hop", () => {
    const grip = { xMm: 300, yMm: 100 };
    const stuck = resolveDragMove({
      surface: wallSurface("wall-0", 1000, 1200, 0),
      source: assemblySource,
      offsetMm: grip,
      walls,
      stickToWallId: "wall-0"
    });
    expect(stuck).toMatchObject({ xMm: 1300, yMm: 1300 });

    const hopped = resolveDragMove({
      surface: wallSurface("wall-1", 4000, 1200, 1000),
      source: assemblySource,
      offsetMm: grip,
      walls
    });
    expect(hopped).toMatchObject({ wallId: "wall-1", xMm: 1000, yMm: 1200 });
  });
});

describe("projectWithDragPreview shelf riders", () => {
  const assemblyProject = {
    id: "p2",
    floor,
    wallObjects: [
      {
        id: "shelf-1",
        kind: "shelf",
        wallId: "wall-0",
        xMm: 2000,
        yMm: 980,
        widthMm: 1200,
        heightMm: 40,
        depthMm: 300
      },
      {
        id: "work-a",
        kind: "artwork",
        artworkId: "a1",
        wallId: "wall-0",
        xMm: 1600,
        yMm: 1400,
        widthMm: 500,
        heightMm: 800
      }
    ],
    floorObjects: []
  } as unknown as Project;

  it("moves the riders with the slab, onto the slab's wall", () => {
    const next = projectWithDragPreview(assemblyProject, "shelf-1", {
      anchor: "wall",
      wallId: "wall-1",
      xMm: 900,
      yMm: 1180,
      riders: [{ id: "work-a", xMm: 500, yMm: 1600 }]
    });

    expect(next).not.toBe(assemblyProject);
    expect(next.wallObjects[0]).toMatchObject({ wallId: "wall-1", xMm: 900, yMm: 1180 });
    expect(next.wallObjects[1]).toMatchObject({ wallId: "wall-1", xMm: 500, yMm: 1600 });
  });
});
