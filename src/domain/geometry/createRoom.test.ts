import { describe, expect, it } from "vitest";
import { parseProject } from "../schema/projectSchema";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import {
  COMPASS_WALL_NAMES,
  createNextDrawnRectangleRoom,
  createNextPolygonRoom,
  createNextRectangleRoom,
  createPolygonRoomPlacement,
  createRectangularRoomPlacement,
  hasDefaultWallNames,
  isDefaultWallName,
  relabelWallsFromNorth,
  wallNamesReplacedByNorth
} from "./createRoom";
import { getFloorBounds, getWallsWithGeometry } from "./walls";
import { signedAreaMm2 } from "./polygon";

// A clockwise (signed area < 0) L-shape in floor space — the constructor
// should reverse it to CCW at creation.
const L_SHAPE = [
  { xMm: 1000, yMm: 1000 },
  { xMm: 1000, yMm: 4000 },
  { xMm: 3000, yMm: 4000 },
  { xMm: 3000, yMm: 2000 },
  { xMm: 5000, yMm: 2000 },
  { xMm: 5000, yMm: 1000 }
];

describe("createRectangularRoomPlacement", () => {
  it("creates a rectangle with stable vertex and wall ids", () => {
    const placement = createRectangularRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      widthMm: feetToMm(20),
      depthMm: feetToMm(14),
      heightMm: feetToMm(12),
      offsetXMm: feetToMm(36),
      offsetYMm: 0
    });

    expect(placement.room.vertices.map((vertex) => vertex.id)).toEqual([
      "room-2-v-nw",
      "room-2-v-ne",
      "room-2-v-se",
      "room-2-v-sw"
    ]);
    expect(placement.room.walls.map((wall) => wall.id)).toEqual([
      "room-2-wall-north",
      "room-2-wall-east",
      "room-2-wall-south",
      "room-2-wall-west"
    ]);
    expect(getWallsWithGeometry(placement.room)[0].lengthMm).toBeCloseTo(
      feetToMm(20)
    );
  });

  it("rejects non-positive dimensions", () => {
    expect(() =>
      createRectangularRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        widthMm: 0,
        depthMm: feetToMm(14),
        heightMm: feetToMm(12),
        offsetXMm: 0,
        offsetYMm: 0
      })
    ).toThrow(/greater than zero/);
  });
});

describe("createPolygonRoomPlacement", () => {
  it("creates an L-shaped room that round-trips parseProject validation", () => {
    const placement = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: L_SHAPE
    });

    expect(placement.room.vertices).toHaveLength(6);
    expect(placement.room.walls).toHaveLength(6);
    expect(placement.room.walls.map((wall) => wall.name)).toEqual([
      "Wall 1",
      "Wall 2",
      "Wall 3",
      "Wall 4",
      "Wall 5",
      "Wall 6"
    ]);
    // Offset is the bbox min; vertices are room-local.
    expect(placement.offsetXMm).toBe(1000);
    expect(placement.offsetYMm).toBe(1000);

    const project = createSampleProject();
    const withRoom: typeof project = {
      ...project,
      floor: { rooms: [...project.floor.rooms, placement] }
    };
    // The closed-loop invariant (schema superRefine) holds.
    expect(() => parseProject(withRoom)).not.toThrow();
  });

  it("normalises clockwise input to counter-clockwise", () => {
    const placement = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: L_SHAPE
    });

    // Stored vertices wind CCW (signed area > 0) regardless of input winding.
    expect(signedAreaMm2(placement.room.vertices)).toBeGreaterThan(0);
    // CW input was reversed: the first stored vertex is the last input point
    // (offset-adjusted), not the first.
    expect(placement.room.vertices[0]).toMatchObject({
      xMm: L_SHAPE[L_SHAPE.length - 1].xMm - 1000,
      yMm: L_SHAPE[L_SHAPE.length - 1].yMm - 1000
    });
  });

  it("leaves counter-clockwise input in place", () => {
    const ccw = L_SHAPE.slice().reverse();
    const placement = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: ccw
    });

    expect(signedAreaMm2(placement.room.vertices)).toBeGreaterThan(0);
    // Already CCW: order preserved, first vertex is the first input point.
    expect(placement.room.vertices[0]).toMatchObject({
      xMm: ccw[0].xMm - 1000,
      yMm: ccw[0].yMm - 1000
    });
  });

  it("rejects fewer than three points", () => {
    expect(() =>
      createPolygonRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        heightMm: feetToMm(12),
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 1000, yMm: 0 }
        ]
      })
    ).toThrow(/at least three/);
  });

  it("rejects near-coincident consecutive points", () => {
    expect(() =>
      createPolygonRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        heightMm: feetToMm(12),
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 3, yMm: 0 }, // < 10 mm from the previous point
          { xMm: 1000, yMm: 1000 }
        ]
      })
    ).toThrow(/too close/);
  });

  it("rejects a self-intersecting outline", () => {
    expect(() =>
      createPolygonRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        heightMm: feetToMm(12),
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 1000, yMm: 1000 },
          { xMm: 1000, yMm: 0 },
          { xMm: 0, yMm: 1000 }
        ]
      })
    ).toThrow(/cross itself/);
  });

  it("collapses an extra point clicked mid-edge into a single wall", () => {
    const rectangle = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 4000, yMm: 0 },
        { xMm: 4000, yMm: 3000 },
        { xMm: 0, yMm: 3000 }
      ]
    });
    // Same rectangle, but with an extra point half way along the north edge
    // (and another a third of the way along it) — as if the user clicked
    // twice while drawing one straight wall.
    const withExtraPoints = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 1500, yMm: 0 },
        { xMm: 2000, yMm: 0 },
        { xMm: 4000, yMm: 0 },
        { xMm: 4000, yMm: 3000 },
        { xMm: 0, yMm: 3000 }
      ]
    });

    expect(withExtraPoints.room.vertices).toHaveLength(4);
    expect(withExtraPoints.room.walls).toHaveLength(4);
    expect(withExtraPoints.room.vertices).toEqual(rectangle.room.vertices);
  });

  it("collapses a collinear point at the wrap-around seam", () => {
    // The seam between the last point and the first is where the collinear
    // point lives — as if the user started drawing mid-way along the west
    // wall, closing the loop back onto that same wall.
    const placement = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: [
        { xMm: 0, yMm: 1500 }, // mid west edge — collinear with the last and next points
        { xMm: 0, yMm: 3000 },
        { xMm: 4000, yMm: 3000 },
        { xMm: 4000, yMm: 0 },
        { xMm: 0, yMm: 0 }
      ]
    });

    expect(placement.room.vertices).toHaveLength(4);
    expect(placement.room.walls).toHaveLength(4);
  });

  it("keeps a genuine corner", () => {
    const placement = createPolygonRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      heightMm: feetToMm(12),
      pointsFloorMm: L_SHAPE
    });

    // The L-shape's six vertices are all real corners — none should be
    // dropped by the collinear merge.
    expect(placement.room.vertices).toHaveLength(6);
  });

  it("still rejects a point that backtracks over the previous segment", () => {
    expect(() =>
      createPolygonRoomPlacement({
        roomId: "room-2",
        name: "Gallery 2",
        heightMm: feetToMm(12),
        pointsFloorMm: [
          { xMm: 0, yMm: 0 },
          { xMm: 4000, yMm: 0 },
          { xMm: 2000, yMm: 0 }, // doubles back over the wall just drawn
          { xMm: 4000, yMm: 3000 },
          { xMm: 0, yMm: 3000 }
        ]
      })
    ).toThrow(/cross itself/);
  });
});

describe("createNextPolygonRoom", () => {
  it("names and numbers the next room off the existing floor", () => {
    const project = createSampleProject();
    const placement = createNextPolygonRoom(
      project.floor,
      project.defaultWallHeightMm,
      L_SHAPE
    );

    expect(placement.roomId).toBe("room-2");
    expect(placement.room.name).toBe("Gallery 2");
    expect(placement.room.walls[0].id).toBe("room-2-wall-0");
  });
});

describe("createNextRectangleRoom", () => {
  it("places a new rectangle to the right of the existing floor", () => {
    const project = createSampleProject();
    const room = createNextRectangleRoom(
      project.floor,
      project.defaultWallHeightMm
    );
    const nextFloor = { rooms: [...project.floor.rooms, room] };

    expect(room.roomId).toBe("room-2");
    expect(room.room.name).toBe("Gallery 2");
    expect(room.offsetXMm).toBeCloseTo(feetToMm(36));
    expect(getFloorBounds(nextFloor).width).toBeCloseTo(feetToMm(56));
  });
});

describe("createNextDrawnRectangleRoom", () => {
  it("names and numbers the next room, placed at the drawn offset", () => {
    const project = createSampleProject();
    const room = createNextDrawnRectangleRoom(
      project.floor,
      project.defaultWallHeightMm,
      { offsetXMm: 2000, offsetYMm: 3000, widthMm: 4000, depthMm: 2500 }
    );

    expect(room.roomId).toBe("room-2");
    expect(room.room.name).toBe("Gallery 2");
    expect(room.offsetXMm).toBe(2000);
    expect(room.offsetYMm).toBe(3000);
    expect(getWallsWithGeometry(room.room)[0].lengthMm).toBeCloseTo(4000);
  });

  it("skips existing room numbers when naming", () => {
    const project = createSampleProject();
    const first = createNextDrawnRectangleRoom(
      project.floor,
      project.defaultWallHeightMm,
      { offsetXMm: 0, offsetYMm: 0, widthMm: 4000, depthMm: 2500 }
    );
    const floorWithFirst = { rooms: [...project.floor.rooms, first] };
    const second = createNextDrawnRectangleRoom(
      floorWithFirst,
      project.defaultWallHeightMm,
      { offsetXMm: 0, offsetYMm: 0, widthMm: 4000, depthMm: 2500 }
    );

    expect(first.roomId).toBe("room-2");
    expect(second.roomId).toBe("room-3");
  });

  it("rejects non-positive dimensions", () => {
    const project = createSampleProject();
    expect(() =>
      createNextDrawnRectangleRoom(project.floor, project.defaultWallHeightMm, {
        offsetXMm: 0,
        offsetYMm: 0,
        widthMm: 0,
        depthMm: 2500
      })
    ).toThrow(/greater than zero/);
  });
});

describe("relabelWallsFromNorth", () => {
  const rectangle = () =>
    createRectangularRoomPlacement({
      roomId: "room-2",
      name: "Gallery 2",
      widthMm: 6000,
      depthMm: 4000,
      heightMm: 3000,
      offsetXMm: 0,
      offsetYMm: 0
    }).room;

  // A quadrilateral drawn clockwise, so the constructor normalises the winding
  // — the case that would break if the loop were walked backwards.
  const quadrilateral = () =>
    createPolygonRoomPlacement({
      roomId: "room-3",
      name: "Gallery 3",
      heightMm: 3000,
      pointsFloorMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 0, yMm: 4000 },
        { xMm: 6000, yMm: 4000 },
        { xMm: 6000, yMm: 0 }
      ]
    }).room;

  it("reproduces the rectangle's own convention when its north wall is chosen", () => {
    const room = rectangle();
    const walls = relabelWallsFromNorth(room, "room-2-wall-north");

    expect(walls?.map((wall) => wall.name)).toEqual([
      "North wall",
      "East wall",
      "South wall",
      "West wall"
    ]);
    // Idempotent: nothing moved, so the ids still line up with their names.
    expect(walls?.map((wall) => wall.id)).toEqual(room.walls.map((wall) => wall.id));
  });

  it("rotates the compass from each starting wall, keeping stored loop order", () => {
    const room = rectangle();
    const expected = [
      ["North wall", "East wall", "South wall", "West wall"],
      ["West wall", "North wall", "East wall", "South wall"],
      ["South wall", "West wall", "North wall", "East wall"],
      ["East wall", "South wall", "West wall", "North wall"]
    ];

    room.walls.forEach((wall, index) => {
      const walls = relabelWallsFromNorth(room, wall.id);
      expect(walls?.map((candidate) => candidate.name)).toEqual(expected[index]);
      expect(walls?.map((candidate) => candidate.id)).toEqual(
        room.walls.map((candidate) => candidate.id)
      );
      // The chosen wall is the one that reads North, whichever index it sits at.
      expect(walls?.[index]?.name).toBe("North wall");
    });
  });

  it("works the same on a normalised 4-vertex polygon room", () => {
    const room = quadrilateral();
    expect(room.walls.map((wall) => wall.name)).toEqual([
      "Wall 1",
      "Wall 2",
      "Wall 3",
      "Wall 4"
    ]);

    const walls = relabelWallsFromNorth(room, room.walls[1]!.id);
    expect(walls?.map((wall) => wall.name)).toEqual([
      "West wall",
      "North wall",
      "East wall",
      "South wall"
    ]);
  });

  it("returns null for rooms that are not quadrilaterals", () => {
    const triangle = createPolygonRoomPlacement({
      roomId: "room-4",
      name: "Gallery 4",
      heightMm: 3000,
      pointsFloorMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 4000, yMm: 0 },
        { xMm: 0, yMm: 4000 }
      ]
    }).room;
    expect(relabelWallsFromNorth(triangle, triangle.walls[0]!.id)).toBeNull();

    const lShape = createPolygonRoomPlacement({
      roomId: "room-5",
      name: "Gallery 5",
      heightMm: 3000,
      pointsFloorMm: L_SHAPE
    }).room;
    expect(lShape.walls).toHaveLength(6);
    expect(relabelWallsFromNorth(lShape, lShape.walls[0]!.id)).toBeNull();
  });

  it("returns null for a wall that is not this room's", () => {
    expect(relabelWallsFromNorth(rectangle(), "room-9-wall-north")).toBeNull();
  });
});

describe("hasDefaultWallNames", () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));

  it("accepts birth names: compass in loop order from any start, or Wall 1..n", () => {
    expect(hasDefaultWallNames(named("North wall", "East wall", "South wall", "West wall"))).toBe(true);
    expect(hasDefaultWallNames(named("West wall", "North wall", "East wall", "South wall"))).toBe(true);
    expect(hasDefaultWallNames(named("Wall 1", "Wall 2", "Wall 3", "Wall 4"))).toBe(true);
    expect(hasDefaultWallNames(named("Wall 1", "Wall 2", "Wall 3", "Wall 4", "Wall 5"))).toBe(true);
  });

  it("treats names that pass isDefaultWallName one by one as custom when the pattern is off", () => {
    // A typed "Wall 12" in a four-wall room.
    expect(hasDefaultWallNames(named("Wall 12", "Wall 2", "Wall 3", "Wall 4"))).toBe(false);
    // A duplicated compass name.
    expect(hasDefaultWallNames(named("North wall", "East wall", "East wall", "West wall"))).toBe(false);
    // Compass names out of loop order.
    expect(hasDefaultWallNames(named("North wall", "South wall", "East wall", "West wall"))).toBe(false);
    // Numbered out of order.
    expect(hasDefaultWallNames(named("Wall 2", "Wall 1", "Wall 3", "Wall 4"))).toBe(false);
    expect(hasDefaultWallNames(named("Gallery entrance", "East wall", "South wall", "West wall"))).toBe(false);
  });
});

describe("wallNamesReplacedByNorth", () => {
  const rectangle = () =>
    createRectangularRoomPlacement({
      roomId: "room-3",
      name: "Gallery 3",
      widthMm: 6000,
      depthMm: 4000,
      heightMm: 3000,
      offsetXMm: 0,
      offsetYMm: 0
    }).room;

  it("lists only the names the relabel would change", () => {
    const room = { ...rectangle() };
    room.walls = room.walls.map((wall, index) =>
      index === 1 ? { ...wall, name: "Long wall" } : wall
    );
    // Choosing the current North wall keeps three names and replaces one.
    expect(wallNamesReplacedByNorth(room, room.walls[0]!.id)).toEqual(["Long wall"]);
    // Choosing the East wall rotates every name, but only the typed one is
    // worth naming — the dialog already says all four are renamed.
    expect(wallNamesReplacedByNorth(room, room.walls[1]!.id)).toEqual(["Long wall"]);
  });

  it("falls back to every changed name when the pattern is custom without a typed name", () => {
    const room = { ...rectangle() };
    room.walls = room.walls.map((wall, index) =>
      index === 2 ? { ...wall, name: "East wall" } : wall
    );
    // Position 2 already reads "East wall", which is what it becomes under
    // this rotation, so it is the one name NOT at stake.
    expect(wallNamesReplacedByNorth(room, room.walls[1]!.id)).toEqual([
      "North wall",
      "East wall",
      "West wall"
    ]);
    // Birth names: nothing at stake, nothing listed.
    expect(wallNamesReplacedByNorth(rectangle(), rectangle().walls[1]!.id)).toEqual([]);
  });

  it("is empty for an ineligible room", () => {
    const room = rectangle();
    expect(wallNamesReplacedByNorth(room, "nope")).toEqual([]);
  });
});

describe("isDefaultWallName", () => {
  it.each(COMPASS_WALL_NAMES)("treats %s as a default", (name) => {
    expect(isDefaultWallName(name)).toBe(true);
  });

  it("treats a numbered polygon wall name as a default", () => {
    expect(isDefaultWallName("Wall 1")).toBe(true);
    expect(isDefaultWallName("Wall 12")).toBe(true);
  });

  it("treats anything the user could have typed as custom", () => {
    expect(isDefaultWallName("Wall")).toBe(false);
    expect(isDefaultWallName("Wall 1a")).toBe(false);
    expect(isDefaultWallName("Gallery entrance")).toBe(false);
    expect(isDefaultWallName("north wall")).toBe(false);
    expect(isDefaultWallName("")).toBe(false);
  });
});
