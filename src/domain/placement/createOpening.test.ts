import { describe, expect, it } from "vitest";
import {
  BLOCKED_ZONE_HEIGHT_MM,
  BLOCKED_ZONE_WIDTH_MM,
  createOpeningPlacement,
  DOOR_HEIGHT_MM,
  DOOR_WIDTH_MM,
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
