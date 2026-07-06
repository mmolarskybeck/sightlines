import { describe, expect, it } from "vitest";
import type { WallObjectBase } from "../project";
import {
  arrangeOnWall,
  gapForInset,
  getArrangeReadout,
  getArrangeReadoutDetailed,
  getNeighborAwareSegments,
  getSpacingSegments,
  insetForGap,
  solveEqualArrangement
} from "./arrangeOnWall";

function makeMember(overrides: Partial<WallObjectBase> = {}): WallObjectBase {
  return {
    id: "member-1",
    wallId: "wall-1",
    xMm: 0,
    yMm: 0,
    widthMm: 500,
    heightMm: 400,
    ...overrides
  };
}

describe("arrangeOnWall", () => {
  it("returns empty array for fewer than 2 members", () => {
    const result = arrangeOnWall([], 2540, { insetMm: 254 });
    expect(result).toEqual([]);

    const single = arrangeOnWall([makeMember()], 2540, { insetMm: 254 });
    expect(single).toEqual([]);
  });

  it("canonical example: 3 works of 508mm on 2540mm wall with 254mm inset", () => {
    // Wall: 2540mm (100in), 3 works @ 508mm (20in) each
    // Σwidths = 1524, available = 2540 - 2*254 = 2032
    // gap = (2540 - 2*254 - 1524) / (3-1) = (2032 - 1524) / 2 = 508/2 = 254
    const members = [
      makeMember({ id: "a", widthMm: 508, xMm: 100 }),
      makeMember({ id: "b", widthMm: 508, xMm: 200 }),
      makeMember({ id: "c", widthMm: 508, xMm: 300 })
    ];

    const result = arrangeOnWall(members, 2540, { insetMm: 254 });

    expect(result).toHaveLength(3);
    // Leftmost: inset + width/2 = 254 + 254 = 508
    expect(result[0]).toEqual({ id: "a", xMm: 508 });
    // Leftmost right edge at 508 + 254 = 762, gap 254, next left at 762 + 254 = 1016
    // Next center: 1016 + 254 = 1270
    expect(result[1]).toEqual({ id: "b", xMm: 1270 });
    // Next right edge at 1270 + 254 = 1524, gap 254, rightmost left at 1524 + 254 = 1778
    // Rightmost center: 1778 + 254 = 2032
    expect(result[2]).toEqual({ id: "c", xMm: 2032 });

    // Verify leftmost left edge at inset
    expect(result[0].xMm - members[0].widthMm / 2).toBe(254);
    // Verify rightmost right edge at wall - inset
    expect(result[2].xMm + members[2].widthMm / 2).toBe(2540 - 254);
  });

  it("mixed widths: gaps are edge-to-edge, not center-to-center", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300 }),
      makeMember({ id: "b", widthMm: 500 }),
      makeMember({ id: "c", widthMm: 400 })
    ];

    // Σwidths = 1200
    // gap = (2000 - 2*100 - 1200) / 2 = 600 / 2 = 300
    const result = arrangeOnWall(members, 2000, { insetMm: 100 });

    expect(result).toHaveLength(3);
    // a: left edge = 100, center = 100 + 300/2 = 250
    expect(result[0]).toEqual({ id: "a", xMm: 250 });
    // a right edge: 250 + 150 = 400
    // gap: 300
    // b left edge: 400 + 300 = 700, center = 700 + 500/2 = 950
    expect(result[1]).toEqual({ id: "b", xMm: 950 });
    // b right edge: 950 + 250 = 1200
    // gap: 300
    // c left edge: 1200 + 300 = 1500, center = 1500 + 400/2 = 1700
    expect(result[2]).toEqual({ id: "c", xMm: 1700 });

    // Verify gap interpretation by checking edges
    const aRightEdge = result[0].xMm + members[0].widthMm / 2;
    const bLeftEdge = result[1].xMm - members[1].widthMm / 2;
    expect(bLeftEdge - aRightEdge).toBe(300);
  });

  it("unsorted input keeps left-to-right order (sorted by xMm)", () => {
    const members = [
      makeMember({ id: "c", widthMm: 300, xMm: 1000 }),
      makeMember({ id: "a", widthMm: 300, xMm: 100 }),
      makeMember({ id: "b", widthMm: 300, xMm: 500 })
    ];

    const result = arrangeOnWall(members, 2000, { insetMm: 100 });

    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("output contains only id and xMm (yMm not arranged)", () => {
    const members = [
      makeMember({ id: "a", yMm: 1000 }),
      makeMember({ id: "b", yMm: 2000 })
    ];

    const result = arrangeOnWall(members, 2000, { insetMm: 100 });

    result.forEach((item) => {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("xMm");
      expect(item).not.toHaveProperty("yMm");
      expect(item).not.toHaveProperty("widthMm");
      expect(item).not.toHaveProperty("heightMm");
    });
  });

  it("negative gap: works wider than wall minus insets computed, not clamped", () => {
    const members = [
      makeMember({ id: "a", widthMm: 2000 }),
      makeMember({ id: "b", widthMm: 2000 })
    ];

    // Σwidths = 4000, wall = 3000, inset = 200
    // gap = (3000 - 2*200 - 4000) / 1 = -1400 (negative)
    const result = arrangeOnWall(members, 3000, { insetMm: 200 });

    expect(result).toHaveLength(2);
    // a: left edge = 200, center = 200 + 1000 = 1200
    expect(result[0].xMm).toBe(1200);
    // a right edge: 1200 + 1000 = 2200
    // gap: -1400 (overlap!)
    // b left edge: 2200 - 1400 = 800, center = 800 + 1000 = 1800
    expect(result[1].xMm).toBe(1800);
  });
});

describe("solveEqualArrangement", () => {
  it("computes equal inset and gap for canonical example", () => {
    const members = [
      makeMember({ widthMm: 508 }),
      makeMember({ widthMm: 508 }),
      makeMember({ widthMm: 508 })
    ];

    const result = solveEqualArrangement(members, 2540);

    // spacing = (2540 - 1524) / 4 = 1016 / 4 = 254
    expect(result.insetMm).toBe(254);
    expect(result.gapMm).toBe(254);
  });

  it("round-trips with gapForInset", () => {
    const members = [
      makeMember({ widthMm: 300 }),
      makeMember({ widthMm: 400 }),
      makeMember({ widthMm: 250 })
    ];
    const wallLengthMm = 2000;
    const insetMm = 150;

    const gap = gapForInset(members, wallLengthMm, insetMm);
    const recovered = insetForGap(members, wallLengthMm, gap);

    expect(recovered).toBe(insetMm);
  });

  it("round-trips with insetForGap", () => {
    const members = [
      makeMember({ widthMm: 300 }),
      makeMember({ widthMm: 400 }),
      makeMember({ widthMm: 250 })
    ];
    const wallLengthMm = 2000;
    const gapMm = 100;

    const inset = insetForGap(members, wallLengthMm, gapMm);
    const recovered = gapForInset(members, wallLengthMm, inset);

    expect(recovered).toBe(gapMm);
  });

  it("solveEqualArrangement round-trips: gap derived from equal spacing matches gapForInset", () => {
    const members = [
      makeMember({ widthMm: 300 }),
      makeMember({ widthMm: 500 }),
      makeMember({ widthMm: 400 })
    ];
    const wallLengthMm = 2500;

    const { insetMm, gapMm } = solveEqualArrangement(members, wallLengthMm);

    const derivedGap = gapForInset(members, wallLengthMm, insetMm);
    expect(derivedGap).toBe(gapMm);

    const derivedInset = insetForGap(members, wallLengthMm, gapMm);
    expect(derivedInset).toBe(insetMm);
  });
});

describe("gapForInset", () => {
  it("derives gap from inset using the arrangement equation", () => {
    const members = [
      makeMember({ widthMm: 200 }),
      makeMember({ widthMm: 300 }),
      makeMember({ widthMm: 250 })
    ];
    const wallLengthMm = 1500;
    const insetMm = 100;

    const gap = gapForInset(members, wallLengthMm, insetMm);

    // gap = (1500 - 2*100 - 750) / 2 = 550 / 2 = 275
    expect(gap).toBe(275);
  });

  it("can be negative when works are wider than available span", () => {
    const members = [
      makeMember({ widthMm: 1500 }),
      makeMember({ widthMm: 1500 })
    ];

    const gap = gapForInset(members, 2000, 100);

    // gap = (2000 - 200 - 3000) / 1 = -1200
    expect(gap).toBe(-1200);
  });
});

describe("insetForGap", () => {
  it("derives inset from gap using the arrangement equation", () => {
    const members = [
      makeMember({ widthMm: 200 }),
      makeMember({ widthMm: 300 }),
      makeMember({ widthMm: 250 })
    ];
    const wallLengthMm = 1500;
    const gapMm = 100;

    const inset = insetForGap(members, wallLengthMm, gapMm);

    // inset = (1500 - 750 - 2*100) / 2 = 550 / 2 = 275
    expect(inset).toBe(275);
  });
});

describe("getArrangeReadout", () => {
  it("reads inset from leftmost member's left edge position", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 300, xMm: 650 })
    ];

    const readout = getArrangeReadout(members, 1500);

    // Leftmost left edge = 250 - 150 = 100
    expect(readout.insetMm).toBe(100);
  });

  it("is exact after arrangeOnWall: apply arrangement, build moved members, readout returns same insetMm/gapMm", () => {
    const originalMembers = [
      makeMember({ id: "a", widthMm: 300, xMm: 100 }),
      makeMember({ id: "b", widthMm: 400, xMm: 200 }),
      makeMember({ id: "c", widthMm: 250, xMm: 300 })
    ];
    const wallLengthMm = 2000;
    const insetMm = 150;

    // Arrange with given inset
    const arranged = arrangeOnWall(originalMembers, wallLengthMm, { insetMm });

    // Build moved members from arrangement
    const movedMembers = arranged.map((item, idx) => ({
      ...originalMembers[idx],
      id: item.id,
      xMm: item.xMm
    }));

    // Read back should return the same inset
    const readout = getArrangeReadout(movedMembers, wallLengthMm);
    expect(readout.insetMm).toBe(insetMm);

    // And gap should be derivable
    const expectedGap = gapForInset(originalMembers, wallLengthMm, insetMm);
    expect(readout.gapMm).toBe(expectedGap);
  });

  it("finds min left edge among all members", () => {
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 500 }),
      makeMember({ id: "b", widthMm: 300, xMm: 300 }),
      makeMember({ id: "c", widthMm: 400, xMm: 700 })
    ];

    const readout = getArrangeReadout(members, 2000);

    // Member b's left edge: 300 - 150 = 150 (min)
    // Member a's left edge: 500 - 100 = 400
    // Member c's left edge: 700 - 200 = 500
    expect(readout.insetMm).toBe(150);
  });
});

describe("getSpacingSegments", () => {
  it("returns [] for no members", () => {
    expect(getSpacingSegments([], 2000)).toEqual([]);
  });

  it("2 members: 3 segments (left margin, one interior gap, right margin)", () => {
    // Wall 2000mm. a: width 300, center 250 -> edges [100, 400]
    // b: width 400, center 800 -> edges [600, 1000]
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];

    const segments = getSpacingSegments(members, 2000);

    expect(segments).toEqual([
      { fromMm: 0, toMm: 100 }, // wall start -> a's left edge
      { fromMm: 400, toMm: 600 }, // a's right edge -> b's left edge
      { fromMm: 1000, toMm: 2000 } // b's right edge -> wall end
    ]);
  });

  it("4 members: 5 segments, unsorted input still resolves left-to-right", () => {
    // Wall 3000mm. Members given out of order; edges computed from xMm/widthMm.
    // a: width 200, center 300 -> edges [200, 400]
    // b: width 300, center 700 -> edges [550, 850]
    // c: width 250, center 1200 -> edges [1075, 1325]
    // d: width 400, center 2000 -> edges [1800, 2200]
    const members = [
      makeMember({ id: "c", widthMm: 250, xMm: 1200 }),
      makeMember({ id: "a", widthMm: 200, xMm: 300 }),
      makeMember({ id: "d", widthMm: 400, xMm: 2000 }),
      makeMember({ id: "b", widthMm: 300, xMm: 700 })
    ];

    const segments = getSpacingSegments(members, 3000);

    expect(segments).toEqual([
      { fromMm: 0, toMm: 200 }, // wall start -> a's left edge
      { fromMm: 400, toMm: 550 }, // a's right edge -> b's left edge
      { fromMm: 850, toMm: 1075 }, // b's right edge -> c's left edge
      { fromMm: 1325, toMm: 1800 }, // c's right edge -> d's left edge
      { fromMm: 2200, toMm: 3000 } // d's right edge -> wall end
    ]);
  });

  it("1 member: 2 segments (left and right margins)", () => {
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];

    const segments = getSpacingSegments(members, 2000);

    expect(segments).toEqual([
      { fromMm: 0, toMm: 350 },
      { fromMm: 650, toMm: 2000 }
    ]);
  });

  it("overlapping members: interior segment returned unclamped (toMm < fromMm)", () => {
    // a: width 400, center 500 -> edges [300, 700]
    // b: width 400, center 600 -> edges [400, 800] (overlaps a)
    const members = [
      makeMember({ id: "a", widthMm: 400, xMm: 500 }),
      makeMember({ id: "b", widthMm: 400, xMm: 600 })
    ];

    const segments = getSpacingSegments(members, 2000);

    // Interior segment: a's right edge (700) -> b's left edge (400)
    expect(segments[1]).toEqual({ fromMm: 700, toMm: 400 });
    expect(segments[1].toMm).toBeLessThan(segments[1].fromMm);
  });
});

describe("getNeighborAwareSegments", () => {
  it("with no others, reproduces getSpacingSegments exactly (single member)", () => {
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];
    expect(getNeighborAwareSegments(members, [], 2000)).toEqual(
      getSpacingSegments(members, 2000)
    );
  });

  it("with no others, reproduces getSpacingSegments exactly (multi member)", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 }),
      makeMember({ id: "c", widthMm: 250, xMm: 1400 })
    ];
    expect(getNeighborAwareSegments(members, [], 2000)).toEqual(
      getSpacingSegments(members, 2000)
    );
  });

  it("a window to the right ends the right segment at the window's left edge; left runs to the wall start", () => {
    // artwork center 500, width 300 -> edges [350, 650]
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];
    // window center 1000, width 200 -> edges [900, 1100]; same y-band
    const others = [makeMember({ id: "w", widthMm: 200, xMm: 1000 })];

    const segments = getNeighborAwareSegments(members, others, 2000);

    expect(segments).toEqual([
      { fromMm: 0, toMm: 350 }, // wall start -> artwork left edge (no left neighbour)
      { fromMm: 650, toMm: 900 } // artwork right edge -> window left edge
    ]);
  });

  it("ignores an object outside the selection's vertical band", () => {
    // artwork center 500, width 300 -> edges [350, 650]; band ~[-200, 200]
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];
    // an object to the right but well below the works' band (a low pedestal):
    // yMm -1000, height 400 -> band [-1200, -800], no overlap -> ignored.
    const others = [
      makeMember({ id: "low", widthMm: 200, xMm: 1000, yMm: -1000, heightMm: 400 })
    ];

    const segments = getNeighborAwareSegments(members, others, 2000);

    // Right boundary falls back to the wall end because the low object is not
    // "beside" the works.
    expect(segments).toEqual([
      { fromMm: 0, toMm: 350 },
      { fromMm: 650, toMm: 2000 }
    ]);
  });

  it("bounds only the side that has a neighbour", () => {
    // artwork center 1500, width 300 -> edges [1350, 1650]
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 1500 })];
    // left neighbour center 500, width 200 -> edges [400, 600]
    const others = [makeMember({ id: "n", widthMm: 200, xMm: 500 })];

    const segments = getNeighborAwareSegments(members, others, 2000);

    expect(segments).toEqual([
      { fromMm: 600, toMm: 1350 }, // left neighbour right edge -> artwork left edge
      { fromMm: 1650, toMm: 2000 } // artwork right edge -> wall end (no right neighbour)
    ]);
  });

  it("an overlapping neighbour yields a negative outer segment (unclamped)", () => {
    // artwork center 500, width 400 -> edges [300, 700]
    const members = [makeMember({ id: "a", widthMm: 400, xMm: 500 })];
    // object center 800, width 400 -> edges [600, 1000], overlaps from the right
    const others = [makeMember({ id: "o", widthMm: 400, xMm: 800 })];

    const segments = getNeighborAwareSegments(members, others, 2000);

    // Right boundary lands at the object's left edge (600), inside the
    // artwork's own span -> the right segment reads backwards.
    expect(segments[1]).toEqual({ fromMm: 700, toMm: 600 });
    expect(segments[1].toMm).toBeLessThan(segments[1].fromMm);
  });

  it("keeps interior member gaps unchanged while bounding the outer segments", () => {
    // two works with a real interior gap, a window to the right of both
    // a: center 300, width 200 -> edges [200, 400]
    // b: center 900, width 200 -> edges [800, 1000]
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 300 }),
      makeMember({ id: "b", widthMm: 200, xMm: 900 })
    ];
    // window center 1400, width 200 -> edges [1300, 1500]
    const others = [makeMember({ id: "w", widthMm: 200, xMm: 1400 })];

    const segments = getNeighborAwareSegments(members, others, 2000);

    expect(segments).toEqual([
      { fromMm: 0, toMm: 200 }, // wall start -> a left edge
      { fromMm: 400, toMm: 800 }, // a right edge -> b left edge (interior, unchanged)
      { fromMm: 1000, toMm: 1300 } // b right edge -> window left edge
    ]);
  });
});

describe("getArrangeReadoutDetailed", () => {
  it("matches getArrangeReadout's insetMm/gapMm", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 }),
      makeMember({ id: "c", widthMm: 250, xMm: 1300 })
    ];
    const wallLengthMm = 2000;

    const basic = getArrangeReadout(members, wallLengthMm);
    const detailed = getArrangeReadoutDetailed(members, wallLengthMm);

    expect(detailed.insetMm).toBe(basic.insetMm);
    expect(detailed.gapMm).toBe(basic.gapMm);
  });

  it("gapIsMixed is false for exactly 2 members (only 1 interior gap, never mixed)", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 300, xMm: 1650 })
    ];

    const { gapIsMixed } = getArrangeReadoutDetailed(members, 2000);
    expect(gapIsMixed).toBe(false);
  });

  it("gapIsMixed is false when all interior gaps are uniform", () => {
    // 3 works of 500mm evenly arranged on a 2540mm wall with 254mm inset/gap
    const members = arrangeOnWall(
      [
        makeMember({ id: "a", widthMm: 508 }),
        makeMember({ id: "b", widthMm: 508 }),
        makeMember({ id: "c", widthMm: 508 })
      ],
      2540,
      { insetMm: 254 }
    ).map((item) => makeMember({ id: item.id, widthMm: 508, xMm: item.xMm }));

    const { gapIsMixed } = getArrangeReadoutDetailed(members, 2540);
    expect(gapIsMixed).toBe(false);
  });

  it("gapIsMixed is true just above the 0.5mm epsilon", () => {
    // 3 members, wall 2000mm, constructed so the two interior gaps differ
    // by exactly 0.51mm (just over the epsilon):
    // a: width 200, center 100 -> right edge 200; gap a->b = 400 - 200 = 200
    // b: width 200, center 500 -> edges [400, 600]; gap b->c = 800.51 - 600 = 200.51
    // c: width 200, center 900.51 -> left edge 800.51
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 100 }),
      makeMember({ id: "b", widthMm: 200, xMm: 500 }),
      makeMember({ id: "c", widthMm: 200, xMm: 900.51 })
    ];

    const segments = getSpacingSegments(members, 2000);
    const interiorGaps = segments.slice(1, -1).map((s) => s.toMm - s.fromMm);
    expect(interiorGaps[1] - interiorGaps[0]).toBeCloseTo(0.51, 5);

    const { gapIsMixed } = getArrangeReadoutDetailed(members, 2000);
    expect(gapIsMixed).toBe(true);
  });

  it("gapIsMixed is false just below the 0.5mm epsilon", () => {
    // Same setup as above but with a 0.49mm spread instead of 0.51mm.
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 100 }),
      makeMember({ id: "b", widthMm: 200, xMm: 500 }),
      makeMember({ id: "c", widthMm: 200, xMm: 900.49 })
    ];

    const segments = getSpacingSegments(members, 2000);
    const interiorGaps = segments.slice(1, -1).map((s) => s.toMm - s.fromMm);
    expect(interiorGaps[1] - interiorGaps[0]).toBeCloseTo(0.49, 5);

    const { gapIsMixed } = getArrangeReadoutDetailed(members, 2000);
    expect(gapIsMixed).toBe(false);
  });

  it("insetIsMixed is true for an asymmetric layout", () => {
    // a: width 300, center 250 -> left edge 100 (left inset)
    // b: width 300, center 1500 -> right edge 1650; wall 2000 -> right inset 350
    // spread = |100 - 350| = 250 (> 0.5mm)
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 300, xMm: 1500 })
    ];

    const { insetIsMixed } = getArrangeReadoutDetailed(members, 2000);
    expect(insetIsMixed).toBe(true);
  });

  it("insetIsMixed is false for a centered layout", () => {
    const members = arrangeOnWall(
      [
        makeMember({ id: "a", widthMm: 508 }),
        makeMember({ id: "b", widthMm: 508 }),
        makeMember({ id: "c", widthMm: 508 })
      ],
      2540,
      { insetMm: 254 }
    ).map((item) => makeMember({ id: item.id, widthMm: 508, xMm: item.xMm }));

    const { insetIsMixed } = getArrangeReadoutDetailed(members, 2540);
    expect(insetIsMixed).toBe(false);
  });
});
