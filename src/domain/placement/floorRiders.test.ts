import { describe, expect, it } from "vitest";
import {
  clampRiderOntoSupport,
  expandWithSupportRiders,
  getSupportRiders,
  getSupportSeatCandidates,
  resolveFloorStandsOn,
  seatOnAnyOverlappingSupport,
  SUPPORT_SEAT_TOLERANCE_MM
} from "./floorRiders";
import type {
  Artwork,
  ArtworkFloorObject,
  BlockedZoneFloorObject,
  CaseFloorObject,
  FloorObject,
  SupportFloorObject
} from "../project";

// A 600×600 pedestal centred at (1000, 1000), top face at 1000mm.
const PEDESTAL: SupportFloorObject = {
  id: "support-1",
  kind: "support",
  supportKind: "pedestal",
  xMm: 1000,
  yMm: 1000,
  widthMm: 600,
  depthMm: 600,
  rotationDeg: 0,
  heightMm: 1000,
  wallYMm: 0
};

function work(
  id: string,
  {
    xMm = 1000,
    yMm = 1000,
    widthMm = 300,
    depthMm = 300,
    rotationDeg = 0,
    baseHeightMm = PEDESTAL.heightMm,
    artworkId = `art-${id}`
  }: {
    xMm?: number;
    yMm?: number;
    widthMm?: number;
    depthMm?: number;
    rotationDeg?: number;
    baseHeightMm?: number;
    artworkId?: string;
  } = {}
): ArtworkFloorObject {
  return {
    id,
    kind: "artwork",
    artworkId,
    xMm,
    yMm,
    widthMm,
    depthMm,
    rotationDeg,
    heightMm: 400,
    wallYMm: 0,
    ...(baseHeightMm > 0 ? { baseHeightMm } : {})
  };
}

const MONITOR_ARTWORK: Artwork = {
  id: "art-monitor",
  schemaVersion: 1,
  title: "Video",
  dimensions: { status: "known", widthMm: 500, heightMm: 375 },
  metadata: {},
  displayAs: "monitor"
};

describe("getSupportRiders", () => {
  it("collects works whose footprint overlaps at the top-face height", () => {
    const rider = work("rider");
    const objects: FloorObject[] = [PEDESTAL, rider];
    expect(getSupportRiders(PEDESTAL, objects).map((object) => object.id)).toEqual([
      "rider"
    ]);
  });

  it("ignores a work standing clear of the footprint", () => {
    const beside = work("beside", { xMm: 3000 });
    expect(getSupportRiders(PEDESTAL, [PEDESTAL, beside])).toEqual([]);
  });

  it("accepts a base height inside the tolerance and rejects one outside it", () => {
    const inside = work("inside", {
      baseHeightMm: PEDESTAL.heightMm + SUPPORT_SEAT_TOLERANCE_MM
    });
    const outside = work("outside", {
      baseHeightMm: PEDESTAL.heightMm + SUPPORT_SEAT_TOLERANCE_MM + 0.5
    });
    expect(
      getSupportRiders(PEDESTAL, [PEDESTAL, inside, outside]).map((object) => object.id)
    ).toEqual(["inside"]);
  });

  it("ignores a work resting on the floor over the same footprint", () => {
    const onFloor = work("floor-work", { baseHeightMm: 0 });
    expect(getSupportRiders(PEDESTAL, [PEDESTAL, onFloor])).toEqual([]);
  });

  it("counts a MONITOR as a rider", () => {
    const monitor = work("monitor", { artworkId: MONITOR_ARTWORK.id });
    const artworksById = new Map([[MONITOR_ARTWORK.id, MONITOR_ARTWORK]]);
    expect(
      getSupportRiders(PEDESTAL, [PEDESTAL, monitor], artworksById).map(
        (object) => object.id
      )
    ).toEqual(["monitor"]);
  });

  it("never counts a case, a blocked zone or another support", () => {
    const vitrine: CaseFloorObject = {
      id: "case-1",
      kind: "case",
      xMm: 1000,
      yMm: 1000,
      widthMm: 300,
      depthMm: 300,
      rotationDeg: 0,
      heightMm: 400,
      wallYMm: 0,
      baseHeightMm: PEDESTAL.heightMm
    };
    const zone: BlockedZoneFloorObject = { ...vitrine, id: "zone-1", kind: "blocked-zone" };
    const other: SupportFloorObject = { ...PEDESTAL, id: "support-2" };
    expect(getSupportRiders(PEDESTAL, [PEDESTAL, vitrine, zone, other])).toEqual([]);
  });

  it("finds a rider over a ROTATED support", () => {
    // A 45° pedestal's bounding box reaches ~424mm on each axis, so a work
    // 350mm off-centre along x is still over the rotated top face while one
    // 600mm away is clear of it.
    const turned: SupportFloorObject = { ...PEDESTAL, rotationDeg: 45 };
    const on = work("on", { xMm: 1000 + 200, widthMm: 200, depthMm: 200 });
    const off = work("off", { xMm: 1000 + 900, widthMm: 200, depthMm: 200 });
    expect(
      getSupportRiders(turned, [turned, on, off]).map((object) => object.id)
    ).toEqual(["on"]);
  });
});

describe("expandWithSupportRiders", () => {
  it("adds the riders of every selected support, order-preserving", () => {
    const a = work("a", { xMm: 900 });
    const b = work("b", { xMm: 1100 });
    const objects: FloorObject[] = [PEDESTAL, a, b];
    expect(expandWithSupportRiders([PEDESTAL.id], objects)).toEqual([
      "support-1",
      "a",
      "b"
    ]);
  });

  it("is idempotent — a rider contributes no riders of its own", () => {
    const rider = work("rider");
    const objects: FloorObject[] = [PEDESTAL, rider];
    const once = expandWithSupportRiders([PEDESTAL.id], objects);
    expect(expandWithSupportRiders(once, objects)).toEqual(once);
  });

  it("passes through ids that match nothing and never narrows", () => {
    expect(expandWithSupportRiders(["ghost"], [PEDESTAL])).toEqual(["ghost"]);
  });
});

describe("getSupportSeatCandidates / seatOnAnyOverlappingSupport", () => {
  const moving = {
    id: "moving",
    centerMm: { xMm: 1000, yMm: 1000 },
    widthMm: 300,
    depthMm: 300,
    rotationDeg: 0
  };

  it("offers an overlapping support and never the mover itself", () => {
    const self: SupportFloorObject = { ...PEDESTAL, id: "moving" };
    expect(getSupportSeatCandidates(moving, [PEDESTAL, self]).map((s) => s.id)).toEqual([
      "support-1"
    ]);
  });

  it("seats on the support's top face", () => {
    expect(seatOnAnyOverlappingSupport(moving, [PEDESTAL])).toEqual({
      baseHeightMm: 1000,
      supportId: "support-1"
    });
  });

  it("returns null over open floor", () => {
    const away = { ...moving, centerMm: { xMm: 9000, yMm: 9000 } };
    expect(seatOnAnyOverlappingSupport(away, [PEDESTAL])).toBeNull();
  });

  it("widest overlap wins, not list order", () => {
    // A tiny plinth listed first clips one corner; the big pedestal under the
    // middle of the work is the one a curator means.
    const corner: SupportFloorObject = {
      ...PEDESTAL,
      id: "corner",
      supportKind: "plinth",
      xMm: 1180,
      yMm: 1180,
      widthMm: 120,
      depthMm: 120,
      heightMm: 150
    };
    expect(seatOnAnyOverlappingSupport(moving, [corner, PEDESTAL])).toEqual({
      baseHeightMm: 1000,
      supportId: "support-1"
    });
  });
});

describe("resolveFloorStandsOn", () => {
  it("reads a rider as standing on its support", () => {
    const rider = work("rider");
    const reading = resolveFloorStandsOn(rider, [PEDESTAL, rider]);
    expect(reading).toEqual({ kind: "support", support: PEDESTAL });
  });

  it("reads a lifted work over nothing as suspended", () => {
    const board = work("board", { xMm: 5000, baseHeightMm: 1800 });
    expect(resolveFloorStandsOn(board, [PEDESTAL, board])).toEqual({
      kind: "suspended",
      heightMm: 1800
    });
  });

  it("reads a work on the floor as floor", () => {
    const flat = work("flat", { xMm: 5000, baseHeightMm: 0 });
    expect(resolveFloorStandsOn(flat, [PEDESTAL, flat])).toEqual({ kind: "floor" });
  });

  it("never reports a MONITOR as suspended", () => {
    const monitor = work("monitor", {
      xMm: 5000,
      baseHeightMm: 800,
      artworkId: MONITOR_ARTWORK.id
    });
    const artworksById = new Map([[MONITOR_ARTWORK.id, MONITOR_ARTWORK]]);
    expect(resolveFloorStandsOn(monitor, [monitor], artworksById)).toEqual({
      kind: "floor"
    });
  });

  it("widest overlap wins when two supports sit at the same height", () => {
    const small: SupportFloorObject = {
      ...PEDESTAL,
      id: "small",
      xMm: 1200,
      widthMm: 150,
      depthMm: 150
    };
    const rider = work("rider");
    const reading = resolveFloorStandsOn(rider, [small, PEDESTAL, rider]);
    expect(reading).toEqual({ kind: "support", support: PEDESTAL });
  });
});

// ─── clampRiderOntoSupport ─────────────────────────────────────────────────

describe("clampRiderOntoSupport", () => {
  // The clamp is what a plan drag of a rider runs each frame, so these pin the
  // two policies the `overhangAllowed` flag switches between — and the rotated
  // case, which is the whole reason this is a hard clamp rather than a
  // dragBarriers obstacle (see the function's note).

  function mover(
    xMm: number,
    yMm: number,
    { widthMm = 300, depthMm = 300, rotationDeg = 0 } = {}
  ) {
    return { id: "rider", centerMm: { xMm, yMm }, widthMm, depthMm, rotationDeg };
  }

  it("keeps the whole footprint on the top face while overhang is off", () => {
    // 600 pedestal, 300 work: the centre may travel ±150 before an edge hangs.
    expect(clampRiderOntoSupport(mover(5000, 1000), PEDESTAL)).toEqual({
      xMm: 1150,
      yMm: 1000
    });
    expect(clampRiderOntoSupport(mover(1100, 900), PEDESTAL)).toEqual({
      xMm: 1100,
      yMm: 900
    });
  });

  it("allows an overhang down to one millimetre of overlap when the flag is on", () => {
    const overhanging: SupportFloorObject = { ...PEDESTAL, overhangAllowed: true };
    // 300 + 300 half-extents, minus the 1mm the footprints must still share.
    expect(clampRiderOntoSupport(mover(9000, 1000), overhanging)).toEqual({
      xMm: 1000 + 449,
      yMm: 1000
    });
  });

  it("measures a turned work's reach along the SUPPORT's axes", () => {
    // A 400×200 work at 90° is 200 wide and 400 deep as the pedestal sees it,
    // so it may travel further on x than its own half-width suggests.
    const clamped = clampRiderOntoSupport(
      mover(5000, 5000, { widthMm: 400, depthMm: 200, rotationDeg: 90 }),
      PEDESTAL
    );
    expect(clamped.xMm).toBeCloseTo(1000 + (600 - 200) / 2, 6);
    expect(clamped.yMm).toBeCloseTo(1000 + (600 - 400) / 2, 6);
  });

  it("centres a work larger than its support rather than clamping it off the box", () => {
    const clamped = clampRiderOntoSupport(
      mover(5000, 5000, { widthMm: 900, depthMm: 900 }),
      PEDESTAL
    );
    expect(clamped).toEqual({ xMm: 1000, yMm: 1000 });
  });

  it("clamps in the support's ROTATED frame, not the world's", () => {
    const turned: SupportFloorObject = { ...PEDESTAL, rotationDeg: 90 };
    // A 90° pedestal's local +x is world +y, so a pull along world +x is
    // clamped on the pedestal's local y axis and comes back on world +x.
    const clamped = clampRiderOntoSupport(mover(9000, 1000), turned);
    expect(clamped.xMm).toBeCloseTo(1150, 6);
    expect(clamped.yMm).toBeCloseTo(1000, 6);
  });
});
