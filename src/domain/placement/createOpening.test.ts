import { describe, expect, it } from "vitest";
import type { WallObjectBase } from "../project";
import {
  BLOCKED_ZONE_HEIGHT_MM,
  BLOCKED_ZONE_WIDTH_MM,
  createOpeningPlacement,
  DOOR_HEIGHT_MM,
  DOOR_WIDTH_MM,
  findFreeOpeningCenterXMm,
  getDefaultOpeningCenterYMm,
  getDefaultOpeningSizeMm,
  getOpeningKindLabel,
  WINDOW_HEIGHT_MM,
  WINDOW_WIDTH_MM
} from "./createOpening";

describe("getDefaultOpeningSizeMm", () => {
  it("returns curatorial default door dimensions", () => {
    expect(getDefaultOpeningSizeMm("door")).toEqual({
      widthMm: DOOR_WIDTH_MM,
      heightMm: DOOR_HEIGHT_MM
    });
  });

  it("returns curatorial default window dimensions", () => {
    expect(getDefaultOpeningSizeMm("window")).toEqual({
      widthMm: WINDOW_WIDTH_MM,
      heightMm: WINDOW_HEIGHT_MM
    });
  });

  it("returns curatorial default blocked-zone dimensions", () => {
    expect(getDefaultOpeningSizeMm("blocked-zone")).toEqual({
      widthMm: BLOCKED_ZONE_WIDTH_MM,
      heightMm: BLOCKED_ZONE_HEIGHT_MM
    });
  });
});

describe("getDefaultOpeningCenterYMm", () => {
  it("centers a door so its bottom edge reaches the floor (y=0)", () => {
    const centerYMm = getDefaultOpeningCenterYMm("door", DOOR_HEIGHT_MM, 1450);

    expect(centerYMm).toBe(DOOR_HEIGHT_MM / 2);
    expect(centerYMm - DOOR_HEIGHT_MM / 2).toBe(0);
  });

  it("centers a window on the wall's centerline, like an artwork placement", () => {
    expect(getDefaultOpeningCenterYMm("window", WINDOW_HEIGHT_MM, 1450)).toBe(1450);
  });

  it("centers a blocked zone on the wall's centerline", () => {
    expect(getDefaultOpeningCenterYMm("blocked-zone", BLOCKED_ZONE_HEIGHT_MM, 1450)).toBe(1450);
  });
});

describe("getOpeningKindLabel", () => {
  it("returns a human-readable, title-case label for every kind", () => {
    expect(getOpeningKindLabel("door")).toBe("Door");
    expect(getOpeningKindLabel("window")).toBe("Window");
    expect(getOpeningKindLabel("blocked-zone")).toBe("Blocked zone");
  });
});

describe("createOpeningPlacement", () => {
  it("creates a center-anchored door reaching the floor with blocksPlacement set", () => {
    const door = createOpeningPlacement("door", "wall-1", 1200, 1450);

    expect(door.kind).toBe("door");
    expect(door.blocksPlacement).toBe(true);
    expect(door.wallId).toBe("wall-1");
    expect(door.xMm).toBe(1200);
    expect(door.widthMm).toBe(DOOR_WIDTH_MM);
    expect(door.heightMm).toBe(DOOR_HEIGHT_MM);
    expect(door.yMm - door.heightMm / 2).toBe(0);
    expect(door.id).toEqual(expect.any(String));
    expect(door.id.length).toBeGreaterThan(0);
  });

  it("creates a window centered at the given centerline height", () => {
    const window_ = createOpeningPlacement("window", "wall-1", 1200, 1450);

    expect(window_.kind).toBe("window");
    expect(window_.yMm).toBe(1450);
  });

  it("creates a blocked zone centered at the given centerline height", () => {
    const zone = createOpeningPlacement("blocked-zone", "wall-1", 1200, 1450);

    expect(zone.kind).toBe("blocked-zone");
    expect(zone.blocksPlacement).toBe(true);
    expect(zone.yMm).toBe(1450);
  });

  it("does not clamp an out-of-bounds x — invalid placement is flagged elsewhere, not fixed here", () => {
    const door = createOpeningPlacement("door", "wall-1", -5_000, 1450);

    expect(door.xMm).toBe(-5_000);
  });

  it("gives each created opening a distinct id", () => {
    const first = createOpeningPlacement("door", "wall-1", 1000, 1450);
    const second = createOpeningPlacement("door", "wall-1", 1000, 1450);

    expect(first.id).not.toBe(second.id);
  });
});

describe("findFreeOpeningCenterXMm", () => {
  // A 1000mm-wide, 1000mm-tall opening on a 10m wall, centered vertically at
  // 1450 (matches the window/blocked-zone centerline default) unless noted.
  const size = { widthMm: 1000, heightMm: 1000 };
  const base = {
    sizeMm: size,
    centerYMm: 1450,
    wallLengthMm: 10_000
  };

  function opening(id: string, xMm: number, extra?: Partial<WallObjectBase>): WallObjectBase {
    return { id, wallId: "wall-1", xMm, yMm: 1450, widthMm: 1000, heightMm: 1000, ...extra };
  }

  it("returns the preferred x unchanged when it is already free", () => {
    const result = findFreeOpeningCenterXMm({
      ...base,
      preferredXMm: 5000,
      sameWallOpenings: [opening("a", 1000)]
    });

    expect(result).toBe(5000);
  });

  it("returns the preferred x even when out of wall bounds — creation doesn't clamp a free default", () => {
    const result = findFreeOpeningCenterXMm({
      ...base,
      preferredXMm: -3000,
      sameWallOpenings: []
    });

    expect(result).toBe(-3000);
  });

  it("slides to the nearest collision-free flush slot when the preferred x is occupied", () => {
    // Neighbor centered at 5000 occupies (4000, 6000) for a 1000-wide newcomer.
    // Preferred 5200 is inside it, so the nearest free flush center is 6000
    // (flush right, edge-touch is legal) rather than 4000 (flush left).
    const result = findFreeOpeningCenterXMm({
      ...base,
      preferredXMm: 5200,
      sameWallOpenings: [opening("a", 5000)]
    });

    expect(result).toBe(6000);
  });

  it("ignores openings whose vertical extent does not overlap the newcomer's", () => {
    // A neighbor at the same x but a disjoint y-band (a high window over a
    // floor-level door) can't collide, so the preferred x stays free.
    const result = findFreeOpeningCenterXMm({
      ...base,
      preferredXMm: 5000,
      sameWallOpenings: [opening("high", 5000, { yMm: 4000 })]
    });

    expect(result).toBe(5000);
  });

  it("returns null when the wall is too full to fit the opening anywhere", () => {
    // A 900mm wall can't hold a 1000mm-wide opening at all (no in-bounds range).
    const result = findFreeOpeningCenterXMm({
      ...base,
      wallLengthMm: 900,
      preferredXMm: 450,
      sameWallOpenings: [opening("a", 450)]
    });

    expect(result).toBeNull();
  });

  it("returns null when every in-bounds slot is occupied by neighbors", () => {
    // Two flush neighbors (centers 1000mm apart, each 1000mm wide) blanket the
    // whole [500, 2500] in-bounds range for a 1000mm newcomer — no free slot
    // remains between or beside them.
    const result = findFreeOpeningCenterXMm({
      ...base,
      wallLengthMm: 3000,
      preferredXMm: 1500,
      sameWallOpenings: [opening("a", 1000), opening("b", 2000)]
    });

    expect(result).toBeNull();
  });
});
