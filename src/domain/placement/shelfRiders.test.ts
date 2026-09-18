import { describe, expect, it } from "vitest";
import {
  expandWithShelfRiders,
  getShelfRiders,
  getShelfSnapCandidates
} from "./shelfRiders";
import { shelfTopYMm } from "../geometry/shelfGlyphs";
import {
  SHELF_TOP_SNAP_TOLERANCE_MM,
  type Artwork,
  type ArtworkWallObject,
  type CaseWallObject,
  type ShelfWallObject,
  type WallObject,
  type WallTextWallObject
} from "../project";

// A 1200-wide shelf centred at x=2000 on wall-north, top face at 1200.
const SHELF: ShelfWallObject = {
  id: "shelf-1",
  kind: "shelf",
  wallId: "wall-north",
  xMm: 2000,
  yMm: 1180,
  widthMm: 1200,
  heightMm: 40,
  depthMm: 300
};

const SHELF_TOP_MM = shelfTopYMm(SHELF); // 1200

// A work whose BOTTOM edge sits `bottomYMm` up the wall — the coordinate the
// rider test reads, converted here from the stored centre so each fixture
// says what it means.
function work(
  id: string,
  { xMm, widthMm = 400, heightMm = 600, bottomYMm = SHELF_TOP_MM, wallId = "wall-north" }: {
    xMm: number;
    widthMm?: number;
    heightMm?: number;
    bottomYMm?: number;
    wallId?: string;
  }
): ArtworkWallObject {
  return {
    id,
    kind: "artwork",
    artworkId: `art-${id}`,
    wallId,
    xMm,
    yMm: bottomYMm + heightMm / 2,
    widthMm,
    heightMm
  };
}

// A framed record for the work `work(id)` creates: a 50mm mat plus a 25mm
// frame face, so the outer footprint is 150mm wider and taller than the stored
// image box (75mm per side, both axes).
const MAT_MM = 50;
const FRAME_MM = 25;
const BAND_PER_SIDE_MM = MAT_MM + FRAME_MM;

function framedArtwork(placementId: string): Artwork {
  return {
    id: `art-${placementId}`,
    schemaVersion: 1,
    dimensions: { status: "known", widthMm: 400, heightMm: 600 },
    matWidthMm: MAT_MM,
    frame: { widthMm: FRAME_MM, finish: "black" },
    metadata: {}
  };
}

function artworkMap(...placementIds: string[]): ReadonlyMap<string, Artwork> {
  return new Map(
    placementIds.map((placementId) => {
      const artwork = framedArtwork(placementId);
      return [artwork.id, artwork];
    })
  );
}

describe("getShelfRiders", () => {
  it("picks up works standing on the shelf and ignores works hung above it", () => {
    const onIt = work("on-it", { xMm: 1800 });
    const above = work("above", { xMm: 1800, bottomYMm: SHELF_TOP_MM + 500 });
    const riders = getShelfRiders(SHELF, [SHELF, onIt, above]);
    expect(riders.map((rider) => rider.id)).toEqual(["on-it"]);
  });

  it("holds the bottom-edge tolerance at exactly SHELF_TOP_SNAP_TOLERANCE_MM", () => {
    const flush = work("flush", { xMm: 2000 });
    const justUnder = work("just-under", {
      xMm: 2000,
      bottomYMm: SHELF_TOP_MM + SHELF_TOP_SNAP_TOLERANCE_MM
    });
    const justOver = work("just-over", {
      xMm: 2000,
      bottomYMm: SHELF_TOP_MM + SHELF_TOP_SNAP_TOLERANCE_MM + 0.01
    });
    // Symmetric: a work sunk very slightly INTO the slab still rides it.
    const slightlySunk = work("slightly-sunk", {
      xMm: 2000,
      bottomYMm: SHELF_TOP_MM - SHELF_TOP_SNAP_TOLERANCE_MM
    });

    const riders = getShelfRiders(SHELF, [SHELF, flush, justUnder, justOver, slightlySunk]);
    expect(riders.map((rider) => rider.id)).toEqual(["flush", "just-under", "slightly-sunk"]);
  });

  it("requires a real x-overlap — abutting the shelf's end is not standing on it", () => {
    // Shelf spans 1400..2600. A 400-wide work centred at 1200 spans 1000..1400:
    // its right edge exactly touches the shelf's left end.
    const abutting = work("abutting", { xMm: 1200 });
    const overlappingByAHair = work("overlapping", { xMm: 1201 });
    const clearOfIt = work("clear", { xMm: 900 });

    const riders = getShelfRiders(SHELF, [SHELF, abutting, overlappingByAHair, clearOfIt]);
    expect(riders.map((rider) => rider.id)).toEqual(["overlapping"]);
  });

  // The bug this replaced: the rider test read the STORED image bottom, while
  // the elevation snap, the drop ghost and the barriers all seat the FRAMED
  // outer bottom on the slab — so a matted or framed work that was visibly
  // standing on a shelf was never carried by it.
  it("stands a framed work on its FRAMED outer bottom, not its image bottom", () => {
    // Framed bottom on the top face ⇒ the stored image bottom sits one band
    // (75mm) ABOVE it. Riding.
    const seated = work("seated", {
      xMm: 2000,
      bottomYMm: SHELF_TOP_MM + BAND_PER_SIDE_MM
    });
    expect(
      getShelfRiders(SHELF, [SHELF, seated], artworkMap("seated")).map((rider) => rider.id)
    ).toEqual(["seated"]);

    // And the records handed back are the ORIGINAL stored objects — the
    // footprint is only the test.
    expect(getShelfRiders(SHELF, [SHELF, seated], artworkMap("seated"))[0]).toBe(seated);

    // Its IMAGE bottom flush on the top face means the frame is sunk 75mm into
    // the slab: not standing on it.
    const sunk = work("sunk", { xMm: 2000 });
    expect(getShelfRiders(SHELF, [SHELF, sunk], artworkMap("sunk"))).toEqual([]);
  });

  it("widens the x-overlap test by the frame band too", () => {
    // Stored span 1000..1400 abuts the shelf's left end (1400) and is not a
    // rider unframed; the framed outer span 925..1475 genuinely overlaps it.
    const abutting = work("abutting", {
      xMm: 1200,
      bottomYMm: SHELF_TOP_MM + BAND_PER_SIDE_MM
    });
    expect(
      getShelfRiders(SHELF, [SHELF, abutting], artworkMap("abutting")).map(
        (rider) => rider.id
      )
    ).toEqual(["abutting"]);
  });

  it("reads the stored box when the map is missing, empty, or has no record", () => {
    const flush = work("flush", { xMm: 2000 });
    expect(getShelfRiders(SHELF, [SHELF, flush]).map((rider) => rider.id)).toEqual(["flush"]);
    expect(getShelfRiders(SHELF, [SHELF, flush], new Map()).map((rider) => rider.id)).toEqual([
      "flush"
    ]);
    // A map that knows a DIFFERENT work leaves this one on its stored box.
    expect(
      getShelfRiders(SHELF, [SHELF, flush], artworkMap("someone-else")).map(
        (rider) => rider.id
      )
    ).toEqual(["flush"]);
  });

  it("never treats a non-artwork, another shelf, or a work on another wall as a rider", () => {
    const wallCase: CaseWallObject = {
      id: "case-1",
      kind: "case",
      wallId: "wall-north",
      xMm: 2000,
      yMm: SHELF_TOP_MM + 90,
      widthMm: 500,
      heightMm: 180,
      depthMm: 450
    };
    const wallText: WallTextWallObject = {
      id: "text-1",
      kind: "wall-text",
      wallId: "wall-north",
      xMm: 2000,
      yMm: SHELF_TOP_MM + 200,
      widthMm: 600,
      heightMm: 400
    };
    const secondShelf: ShelfWallObject = { ...SHELF, id: "shelf-2", yMm: SHELF_TOP_MM + 20 };
    const otherWall = work("other-wall", { xMm: 2000, wallId: "wall-east" });

    expect(
      getShelfRiders(SHELF, [SHELF, wallCase, wallText, secondShelf, otherWall])
    ).toEqual([]);
  });
});

describe("expandWithShelfRiders", () => {
  const left = work("left", { xMm: 1600 });
  const right = work("right", { xMm: 2400 });
  const shelfTwo: ShelfWallObject = { ...SHELF, id: "shelf-2", xMm: 6000 };
  const onShelfTwo = work("on-shelf-2", { xMm: 6000 });
  const elsewhere = work("elsewhere", { xMm: 9000 });
  const objects: WallObject[] = [SHELF, left, right, shelfTwo, onShelfTwo, elsewhere];

  it("threads the artwork map through to the framed rider test", () => {
    const framed = work("framed", {
      xMm: 2000,
      bottomYMm: SHELF_TOP_MM + BAND_PER_SIDE_MM
    });
    const objects: WallObject[] = [SHELF, framed];
    // Without the map the framed work's stored bottom is 75mm proud of the
    // slab, so it is not carried.
    expect(expandWithShelfRiders(["shelf-1"], objects)).toEqual(["shelf-1"]);
    expect(expandWithShelfRiders(["shelf-1"], objects, artworkMap("framed"))).toEqual([
      "shelf-1",
      "framed"
    ]);
  });

  it("adds a shelf's riders and leaves the input ids in front, in order", () => {
    expect(expandWithShelfRiders(["shelf-1"], objects)).toEqual(["shelf-1", "left", "right"]);
  });

  it("is idempotent", () => {
    const once = expandWithShelfRiders(["shelf-1"], objects);
    expect(expandWithShelfRiders(once, objects)).toEqual(once);
  });

  it("unions across several shelves without duplicating a shared rider", () => {
    expect(expandWithShelfRiders(["shelf-1", "shelf-2"], objects)).toEqual([
      "shelf-1",
      "shelf-2",
      "left",
      "right",
      "on-shelf-2"
    ]);
    // A rider already named in the selection is not added a second time.
    expect(expandWithShelfRiders(["left", "shelf-1"], objects)).toEqual([
      "left",
      "shelf-1",
      "right"
    ]);
  });

  it("adds nothing for a selection with no shelf in it, and passes unknown ids through", () => {
    expect(expandWithShelfRiders(["left", "elsewhere"], objects)).toEqual(["left", "elsewhere"]);
    expect(expandWithShelfRiders(["ghost-id"], objects)).toEqual(["ghost-id"]);
    expect(expandWithShelfRiders([], objects)).toEqual([]);
  });
});

describe("getShelfSnapCandidates", () => {
  const objects: WallObject[] = [SHELF, { ...SHELF, id: "shelf-far", xMm: 6000 }];

  it("offers only same-wall shelves the moving work currently overlaps", () => {
    expect(
      getShelfSnapCandidates({ id: "w", wallId: "wall-north", xMm: 2000, widthMm: 400 }, objects)
        .map((shelf) => shelf.id)
    ).toEqual(["shelf-1"]);

    expect(
      getShelfSnapCandidates({ id: "w", wallId: "wall-east", xMm: 2000, widthMm: 400 }, objects)
    ).toEqual([]);

    // Abutting the end is not overlapping — the same predicate the rider test
    // uses, so a work cannot be offered a snap it would not then ride.
    expect(
      getShelfSnapCandidates({ id: "w", wallId: "wall-north", xMm: 1200, widthMm: 400 }, objects)
    ).toEqual([]);
  });

  it("never offers the moving object itself", () => {
    expect(
      getShelfSnapCandidates(
        { id: "shelf-1", wallId: "wall-north", xMm: 2000, widthMm: 1200 },
        objects
      )
    ).toEqual([]);
  });
});
