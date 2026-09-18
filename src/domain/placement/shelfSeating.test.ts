import { describe, expect, it } from "vitest";
import {
  SHELF_SEAT_CAPTURE_3D_MM,
  seatOnAnyOverlappingShelf,
  seatOnShelfTop
} from "./shelfSeating";
import { shelfTopYMm } from "../geometry/shelfGlyphs";
import type { ArtworkWallObject, ShelfWallObject, WallObject } from "../project";

// A 1200-wide slab centred at x=2000 on wall-north, 40 thick, so its TOP face
// sits at 1200 (the same fixture shape shelfRiders.test.ts uses).
function shelf(
  id: string,
  {
    xMm = 2000,
    widthMm = 1200,
    topYMm = 1200,
    heightMm = 40,
    wallId = "wall-north"
  }: {
    xMm?: number;
    widthMm?: number;
    topYMm?: number;
    heightMm?: number;
    wallId?: string;
  } = {}
): ShelfWallObject {
  return {
    id,
    kind: "shelf",
    wallId,
    xMm,
    yMm: topYMm - heightMm / 2,
    widthMm,
    heightMm,
    depthMm: 300
  };
}

function work(
  id: string,
  {
    xMm = 2000,
    widthMm = 400,
    heightMm = 600,
    yMm = 1500,
    wallId = "wall-north"
  }: {
    xMm?: number;
    widthMm?: number;
    heightMm?: number;
    yMm?: number;
    wallId?: string;
  } = {}
): ArtworkWallObject {
  return { id, kind: "artwork", artworkId: `art-${id}`, wallId, xMm, yMm, widthMm, heightMm };
}

// The centre y that stands a `heightMm`-tall work on a slab whose top is at
// `topYMm` — restated by hand so the tests do not just re-run the source.
const seatedCenter = (topYMm: number, heightMm: number) => topYMm + heightMm / 2;

describe("seatOnShelfTop", () => {
  const SHELF = shelf("shelf-1");
  const objects: WallObject[] = [SHELF];

  it("seats a work whose bottom edge is inside the capture radius", () => {
    // Bottom edge at 1300 — 100mm above the 1200 top face.
    const moving = { wallId: "wall-north", xMm: 2000, widthMm: 400, heightMm: 600, yMm: 1600 };
    expect(seatOnShelfTop(moving, objects, SHELF_SEAT_CAPTURE_3D_MM)).toEqual({
      shelfId: "shelf-1",
      yMm: seatedCenter(1200, 600)
    });
  });

  it("returns null when the bottom edge is beyond the capture radius", () => {
    // Bottom edge at 1201 + capture: just out of reach.
    const moving = {
      wallId: "wall-north",
      xMm: 2000,
      widthMm: 400,
      heightMm: 600,
      yMm: 1200 + SHELF_SEAT_CAPTURE_3D_MM + 1 + 300
    };
    expect(seatOnShelfTop(moving, objects, SHELF_SEAT_CAPTURE_3D_MM)).toBeNull();
  });

  it("returns null when the x-spans do not overlap", () => {
    const moving = { wallId: "wall-north", xMm: 3000, widthMm: 400, heightMm: 600, yMm: 1500 };
    expect(seatOnShelfTop(moving, objects, SHELF_SEAT_CAPTURE_3D_MM)).toBeNull();
  });

  it("returns null on another wall", () => {
    const moving = { wallId: "wall-east", xMm: 2000, widthMm: 400, heightMm: 600, yMm: 1500 };
    expect(seatOnShelfTop(moving, objects, SHELF_SEAT_CAPTURE_3D_MM)).toBeNull();
  });

  it("never seats a work on itself", () => {
    const moving = {
      id: "shelf-1",
      wallId: "wall-north",
      xMm: 2000,
      widthMm: 400,
      heightMm: 600,
      yMm: 1500
    };
    expect(seatOnShelfTop(moving, objects, SHELF_SEAT_CAPTURE_3D_MM)).toBeNull();
  });

  it("picks the shelf whose top face is NEAREST the bottom edge, not the first", () => {
    const lower = shelf("shelf-low", { topYMm: 1000 });
    const upper = shelf("shelf-high", { topYMm: 1400 });
    // Bottom edge at 1350: 350 from the lower slab, 50 from the upper one.
    const moving = { wallId: "wall-north", xMm: 2000, widthMm: 400, heightMm: 600, yMm: 1650 };
    expect(seatOnShelfTop(moving, [lower, upper], 400)).toEqual({
      shelfId: "shelf-high",
      yMm: seatedCenter(1400, 600)
    });
  });

  it("ignores non-shelf wall objects at the same height", () => {
    const neighbour = work("other", { yMm: 1500 });
    expect(
      seatOnShelfTop(
        { wallId: "wall-north", xMm: 2000, widthMm: 400, heightMm: 600, yMm: 1500 },
        [neighbour],
        SHELF_SEAT_CAPTURE_3D_MM
      )
    ).toBeNull();
  });

  it("seats a work so that its bottom edge IS the top face", () => {
    const tall = { wallId: "wall-north", xMm: 2000, widthMm: 400, heightMm: 1234, yMm: 1900 };
    const seated = seatOnShelfTop(tall, objects, SHELF_SEAT_CAPTURE_3D_MM);
    expect(seated).not.toBeNull();
    expect(seated!.yMm - tall.heightMm / 2).toBeCloseTo(shelfTopYMm(SHELF), 6);
  });
});

describe("seatOnAnyOverlappingShelf", () => {
  it("seats over an overlapping shelf with no vertical test at all", () => {
    const objects: WallObject[] = [shelf("shelf-1")];
    expect(
      seatOnAnyOverlappingShelf(
        { wallId: "wall-north", xMm: 2000, widthMm: 400, heightMm: 600 },
        objects
      )
    ).toEqual({ shelfId: "shelf-1", yMm: seatedCenter(1200, 600) });
  });

  it("returns null when nothing overlaps", () => {
    const objects: WallObject[] = [shelf("shelf-1")];
    expect(
      seatOnAnyOverlappingShelf(
        { wallId: "wall-north", xMm: 3500, widthMm: 400, heightMm: 600 },
        objects
      )
    ).toBeNull();
  });

  it("picks the WIDEST x-overlap, not the first in the list", () => {
    // A slab clipping only the left 50mm of the work, and a slab the work sits
    // wholly inside. Listed clipper-first so list order would give the wrong one.
    const clipper = shelf("shelf-clip", { xMm: 1550, widthMm: 500 }); // spans 1300..1800
    const wide = shelf("shelf-wide", { xMm: 2000, widthMm: 1200, topYMm: 900 }); // 1400..2600
    const moving = { wallId: "wall-north", xMm: 1800, widthMm: 400, heightMm: 600 }; // 1600..2000
    expect(seatOnAnyOverlappingShelf(moving, [clipper, wide])).toEqual({
      shelfId: "shelf-wide",
      yMm: seatedCenter(900, 600)
    });
  });

  it("never seats an object on itself and ignores other walls", () => {
    const objects: WallObject[] = [shelf("shelf-1"), shelf("shelf-elsewhere", { wallId: "w2" })];
    expect(
      seatOnAnyOverlappingShelf(
        { id: "shelf-1", wallId: "wall-north", xMm: 2000, widthMm: 400, heightMm: 600 },
        objects
      )
    ).toBeNull();
  });
});
