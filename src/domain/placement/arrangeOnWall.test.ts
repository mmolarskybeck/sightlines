import { describe, expect, it } from "vitest";
import type { WallObjectBase } from "../project";
import {
  arrangeOnWall,
  arrangeOnWallInZone,
  arrangeOnWallInZoneWithInset,
  centerMemberBetweenBoundaries,
  detectBoundary,
  gapForInset,
  getArrangeReadoutDetailed,
  getNeighborAwareSegments,
  getOpenSpaceBounds,
  getSpacingSegments,
  insetForGap,
  slideGroupToBoundaryInset,
  slideGroupToEdgeInset,
  solveEqualArrangement,
  solveEqualArrangementInZone,
  spaceGroupAboutCenter
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

describe("slideGroupToEdgeInset", () => {
  it("returns empty array for fewer than 2 members", () => {
    expect(slideGroupToEdgeInset([], 2000, "left", 100)).toEqual([]);
    expect(
      slideGroupToEdgeInset([makeMember()], 2000, "left", 100)
    ).toEqual([]);
  });

  it("left: slides the group so its leftmost edge lands at insetMm from the wall start", () => {
    // a: width 300, center 250 -> edges [100, 400]
    // b: width 400, center 800 -> edges [600, 1000]  (leftmost edge = 100)
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];

    // Target left edge = 500, current leftmost edge = 100 -> delta = +400
    const result = slideGroupToEdgeInset(members, 2000, "left", 500);

    expect(result).toEqual([
      { id: "a", xMm: 650 },
      { id: "b", xMm: 1200 }
    ]);
    // New leftmost left edge sits exactly at the requested inset.
    const newLeftEdge = Math.min(
      ...result.map((r, i) => r.xMm - members[i].widthMm / 2)
    );
    expect(newLeftEdge).toBe(500);
  });

  it("right: slides the group so its rightmost edge lands at insetMm from the wall end", () => {
    // a: width 300, center 250 -> edges [100, 400]
    // b: width 400, center 800 -> edges [600, 1000]  (rightmost edge = 1000)
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];

    // Target right edge = wall - inset = 2000 - 300 = 1700; current = 1000 -> delta = +700
    const result = slideGroupToEdgeInset(members, 2000, "right", 300);

    expect(result).toEqual([
      { id: "a", xMm: 950 },
      { id: "b", xMm: 1500 }
    ]);
    const newRightEdge = Math.max(
      ...result.map((r, i) => r.xMm + members[i].widthMm / 2)
    );
    expect(newRightEdge).toBe(2000 - 300);
  });

  it("preserves interior spacing (rigid translation, same delta for every member)", () => {
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 300 }),
      makeMember({ id: "b", widthMm: 500, xMm: 900 }),
      makeMember({ id: "c", widthMm: 300, xMm: 1600 })
    ];
    const before = getSpacingSegments(members, 2500)
      .slice(1, -1)
      .map((s) => s.toMm - s.fromMm);

    const result = slideGroupToEdgeInset(members, 2500, "left", 50);
    const moved = result.map((r, i) => ({ ...members[i], xMm: r.xMm }));
    const after = getSpacingSegments(moved, 2500)
      .slice(1, -1)
      .map((s) => s.toMm - s.fromMm);

    // The absolute positions shift, but the interior gap WIDTHS are preserved.
    expect(after).toEqual(before);
    // Every member moved by exactly the same delta.
    const deltas = result.map((r, i) => r.xMm - members[i].xMm);
    expect(new Set(deltas).size).toBe(1);
  });

  it("allows a negative inset (unclamped)", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];

    // Negative left inset pushes the group's left edge past the wall start.
    const result = slideGroupToEdgeInset(members, 2000, "left", -100);
    const newLeftEdge = Math.min(
      ...result.map((r, i) => r.xMm - members[i].widthMm / 2)
    );
    expect(newLeftEdge).toBe(-100);
  });

  it("is absolute, not cumulative: applying the same inset twice moves nothing further", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];

    const first = slideGroupToEdgeInset(members, 2000, "left", 500);
    const firstMembers = first.map((r, i) => ({ ...members[i], xMm: r.xMm }));
    const second = slideGroupToEdgeInset(firstMembers, 2000, "left", 500);

    // Second pass yields the same positions — no additional movement.
    expect(second).toEqual(first);
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

describe("spaceGroupAboutCenter", () => {
  const unionCenter = (members: { xMm: number; widthMm: number }[]) => {
    const left = Math.min(...members.map((m) => m.xMm - m.widthMm / 2));
    const right = Math.max(...members.map((m) => m.xMm + m.widthMm / 2));
    return (left + right) / 2;
  };

  it("returns [] for fewer than 2 members", () => {
    expect(spaceGroupAboutCenter([], 100)).toEqual([]);
    expect(spaceGroupAboutCenter([makeMember()], 100)).toEqual([]);
  });

  it("keeps the group's union-bounds center fixed while setting the gap", () => {
    // Two works well off-center on the wall; union center = (leftEdge+rightEdge)/2.
    // a: width 300, center 900 -> edges [750, 1050]
    // b: width 200, center 1300 -> edges [1200, 1400]
    // union center = (750 + 1400)/2 = 1075
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 900 }),
      makeMember({ id: "b", widthMm: 200, xMm: 1300 })
    ];
    const before = unionCenter(members);

    const moves = spaceGroupAboutCenter(members, 100);
    const moved = members.map((m) => ({
      ...m,
      xMm: moves.find((mv) => mv.id === m.id)!.xMm
    }));

    // Center preserved
    expect(unionCenter(moved)).toBeCloseTo(before, 6);
    // Interior gap is now exactly 100: a right edge -> b left edge
    const aRight = moved[0].xMm + moved[0].widthMm / 2;
    const bLeft = moved[1].xMm - moved[1].widthMm / 2;
    expect(bLeft - aRight).toBeCloseTo(100, 6);
  });

  it("sets every interior gap equal and preserves left-to-right order", () => {
    const members = [
      makeMember({ id: "c", widthMm: 250, xMm: 1400 }),
      makeMember({ id: "a", widthMm: 200, xMm: 300 }),
      makeMember({ id: "b", widthMm: 300, xMm: 800 })
    ];

    const moves = spaceGroupAboutCenter(members, 120);

    // Order preserved (sorted by xMm): a, b, c
    expect(moves.map((m) => m.id)).toEqual(["a", "b", "c"]);

    const byId = new Map(moves.map((m) => [m.id, m.xMm]));
    const width = new Map(members.map((m) => [m.id, m.widthMm]));
    const gap1 =
      byId.get("b")! - width.get("b")! / 2 - (byId.get("a")! + width.get("a")! / 2);
    const gap2 =
      byId.get("c")! - width.get("c")! / 2 - (byId.get("b")! + width.get("b")! / 2);
    expect(gap1).toBeCloseTo(120, 6);
    expect(gap2).toBeCloseTo(120, 6);
  });

  it("allows a negative gap (overlap) without clamping, center still fixed", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 900 }),
      makeMember({ id: "b", widthMm: 200, xMm: 1300 })
    ];
    const before = unionCenter(members);

    const moves = spaceGroupAboutCenter(members, -50);
    const moved = members.map((m) => ({
      ...m,
      xMm: moves.find((mv) => mv.id === m.id)!.xMm
    }));

    const aRight = moved[0].xMm + moved[0].widthMm / 2;
    const bLeft = moved[1].xMm - moved[1].widthMm / 2;
    expect(bLeft - aRight).toBeCloseTo(-50, 6);
    expect(unionCenter(moved)).toBeCloseTo(before, 6);
  });

  it("is absolute/idempotent: applying the same gap twice is a no-op", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 900 }),
      makeMember({ id: "b", widthMm: 200, xMm: 1300 }),
      makeMember({ id: "c", widthMm: 250, xMm: 1600 })
    ];

    const first = spaceGroupAboutCenter(members, 90);
    const afterFirst = members.map((m) => ({
      ...m,
      xMm: first.find((mv) => mv.id === m.id)!.xMm
    }));
    const second = spaceGroupAboutCenter(afterFirst, 90);

    for (const move of first) {
      const again = second.find((mv) => mv.id === move.id)!;
      expect(again.xMm).toBeCloseTo(move.xMm, 6);
    }
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

describe("getOpenSpaceBounds", () => {
  it("with no others, returns the whole wall", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];
    expect(getOpenSpaceBounds(members, [], 2000)).toEqual({
      startMm: 0,
      endMm: 2000
    });
  });

  it("with no members, returns the whole wall", () => {
    expect(getOpenSpaceBounds([], [], 2000)).toEqual({ startMm: 0, endMm: 2000 });
  });

  it("bounds the right at a window's left edge, the left at the wall start", () => {
    // artwork center 500, width 300 -> edges [350, 650]
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];
    // window center 1000, width 200 -> edges [900, 1100]; same y-band
    const others = [makeMember({ id: "w", widthMm: 200, xMm: 1000 })];

    expect(getOpenSpaceBounds(members, others, 2000)).toEqual({
      startMm: 0,
      endMm: 900
    });
  });

  it("bounds only the side that has a neighbour", () => {
    // artwork center 1500, width 300 -> edges [1350, 1650]
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 1500 })];
    // left neighbour center 500, width 200 -> right edge 600
    const others = [makeMember({ id: "n", widthMm: 200, xMm: 500 })];

    expect(getOpenSpaceBounds(members, others, 2000)).toEqual({
      startMm: 600,
      endMm: 2000
    });
  });

  it("ignores a neighbour outside the selection's vertical band", () => {
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];
    const others = [
      makeMember({ id: "low", widthMm: 200, xMm: 1000, yMm: -1000, heightMm: 400 })
    ];

    expect(getOpenSpaceBounds(members, others, 2000)).toEqual({
      startMm: 0,
      endMm: 2000
    });
  });

  it("an overlapping neighbour lands a boundary inside the span (unclamped)", () => {
    // artwork center 500, width 400 -> edges [300, 700]
    const members = [makeMember({ id: "a", widthMm: 400, xMm: 500 })];
    // object center 800, width 400 -> left edge 600, overlaps from the right
    const others = [makeMember({ id: "o", widthMm: 400, xMm: 800 })];

    const bounds = getOpenSpaceBounds(members, others, 2000);
    // Right boundary (600) sits left of the member's own right edge (700).
    expect(bounds).toEqual({ startMm: 0, endMm: 600 });
  });

  it("agrees with getNeighborAwareSegments' outer boundaries", () => {
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 300 }),
      makeMember({ id: "b", widthMm: 200, xMm: 900 })
    ];
    const others = [makeMember({ id: "w", widthMm: 200, xMm: 1400 })];

    const bounds = getOpenSpaceBounds(members, others, 2000);
    const segments = getNeighborAwareSegments(members, others, 2000);
    // segment[0].fromMm is the left boundary; the last segment's toMm the right.
    expect(bounds.startMm).toBe(segments[0].fromMm);
    expect(bounds.endMm).toBe(segments[segments.length - 1].toMm);
  });
});

describe("solveEqualArrangementInZone", () => {
  it("is solveEqualArrangement over the zone length", () => {
    const members = [
      makeMember({ widthMm: 300 }),
      makeMember({ widthMm: 500 }),
      makeMember({ widthMm: 400 })
    ];
    // zone [500, 2500] has length 2000
    expect(solveEqualArrangementInZone(members, 500, 2500)).toEqual(
      solveEqualArrangement(members, 2000)
    );
  });

  it("degenerates to the whole-wall solve for zone [0, wallLength]", () => {
    const members = [
      makeMember({ widthMm: 508 }),
      makeMember({ widthMm: 508 }),
      makeMember({ widthMm: 508 })
    ];
    expect(solveEqualArrangementInZone(members, 0, 2540)).toEqual(
      solveEqualArrangement(members, 2540)
    );
  });

  it("yields a negative spacing when the zone is too small for the works", () => {
    const members = [
      makeMember({ widthMm: 1500 }),
      makeMember({ widthMm: 1500 })
    ];
    // zone length 500, Σwidths 3000 -> spacing = (500 - 3000)/3 < 0
    const { insetMm, gapMm } = solveEqualArrangementInZone(members, 1000, 1500);
    expect(insetMm).toBeLessThan(0);
    expect(gapMm).toBe(insetMm);
  });
});

describe("arrangeOnWallInZone", () => {
  it("returns [] for fewer than 2 members", () => {
    expect(arrangeOnWallInZone([], 0, 2000)).toEqual([]);
    expect(arrangeOnWallInZone([makeMember()], 0, 2000)).toEqual([]);
  });

  it("reproduces the whole-wall equal arrangement for zone [0, wallLength]", () => {
    const members = [
      makeMember({ id: "a", widthMm: 508, xMm: 100 }),
      makeMember({ id: "b", widthMm: 508, xMm: 1000 }),
      makeMember({ id: "c", widthMm: 508, xMm: 2000 })
    ];
    const wallLengthMm = 2540;
    const { insetMm } = solveEqualArrangement(members, wallLengthMm);
    const wholeWall = arrangeOnWall(members, wallLengthMm, { insetMm });

    expect(arrangeOnWallInZone(members, 0, wallLengthMm)).toEqual(wholeWall);
  });

  it("distributes evenly within the zone, offset by the zone start", () => {
    // 3 works of 508 in the zone [500, 2532] (length 2032)
    // Σwidths = 1524, spacing = (2032 - 1524)/4 = 127
    const members = [
      makeMember({ id: "a", widthMm: 508, xMm: 600 }),
      makeMember({ id: "b", widthMm: 508, xMm: 1400 }),
      makeMember({ id: "c", widthMm: 508, xMm: 2200 })
    ];

    const result = arrangeOnWallInZone(members, 500, 2532);

    expect(result).toHaveLength(3);
    // Leftmost left edge sits at zoneStart + inset = 500 + 127 = 627
    expect(result[0].xMm - 508 / 2).toBeCloseTo(627, 6);
    // Rightmost right edge sits at zoneEnd - inset = 2532 - 127 = 2405
    expect(result[2].xMm + 508 / 2).toBeCloseTo(2405, 6);
    // Every gap equal to the spacing (127)
    const aRight = result[0].xMm + 508 / 2;
    const bLeft = result[1].xMm - 508 / 2;
    expect(bLeft - aRight).toBeCloseTo(127, 6);
  });

  it("equals the whole-wall solve translated by the zone start", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 400 }),
      makeMember({ id: "b", widthMm: 200, xMm: 900 })
    ];
    const zoneStartMm = 350;
    const zoneEndMm = 1650;
    const inZone = arrangeOnWallInZone(members, zoneStartMm, zoneEndMm);

    const { insetMm } = solveEqualArrangement(members, zoneEndMm - zoneStartMm);
    const localWhole = arrangeOnWall(members, zoneEndMm - zoneStartMm, { insetMm });

    for (const move of inZone) {
      const local = localWhole.find((m) => m.id === move.id)!;
      expect(move.xMm).toBeCloseTo(local.xMm + zoneStartMm, 6);
    }
  });

  it("keeps left-to-right order for unsorted input", () => {
    const members = [
      makeMember({ id: "c", widthMm: 200, xMm: 1500 }),
      makeMember({ id: "a", widthMm: 200, xMm: 300 }),
      makeMember({ id: "b", widthMm: 200, xMm: 800 })
    ];
    const result = arrangeOnWallInZone(members, 200, 1800);
    expect(result.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("returns negative gaps unclamped when the zone is too small for the works", () => {
    const members = [
      makeMember({ id: "a", widthMm: 2000, xMm: 500 }),
      makeMember({ id: "b", widthMm: 2000, xMm: 2500 })
    ];
    // zone length 3000, Σwidths 4000, spacing = (3000 - 4000)/3 = -333.33
    const result = arrangeOnWallInZone(members, 0, 3000);
    const aRight = result[0].xMm + 2000 / 2;
    const bLeft = result[1].xMm - 2000 / 2;
    // The interior gap is negative (overlap), returned as-is.
    expect(bLeft - aRight).toBeCloseTo(-1000 / 3, 5);
    expect(bLeft - aRight).toBeLessThan(0);
  });

  it("handles a zone whose end is inside the span (overlapping neighbour) unclamped", () => {
    // Two works whose combined right edge is bounded by an overlapping
    // neighbour, so the open zone reads backwards (start > end) — the solve
    // still runs and returns positions, no clamping.
    const members = [
      makeMember({ id: "a", widthMm: 400, xMm: 500 }),
      makeMember({ id: "b", widthMm: 400, xMm: 1000 })
    ];
    // A neighbour overlapping from the right places the boundary at 700, left
    // of the members' union right edge (1200) — a backwards zone.
    const others = [makeMember({ id: "o", widthMm: 400, xMm: 900 })];
    const bounds = getOpenSpaceBounds(members, others, 2000);
    expect(bounds.endMm).toBeLessThan(1200);

    const result = arrangeOnWallInZone(members, bounds.startMm, bounds.endMm);
    // Still two moves, order preserved, no throw/clamp.
    expect(result.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result).toHaveLength(2);
  });
});

describe("getArrangeReadoutDetailed", () => {
  it("insetMm reads the leftmost member's left-edge offset", () => {
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 500 }),
      makeMember({ id: "b", widthMm: 300, xMm: 300 }),
      makeMember({ id: "c", widthMm: 400, xMm: 700 })
    ];

    // Member b's left edge: 300 - 150 = 150 (min of all left edges)
    const { insetMm } = getArrangeReadoutDetailed(members, 2000);
    expect(insetMm).toBe(150);
  });

  it("gapMm is the ACTUAL gap for an off-center 2-member selection (regression)", () => {
    // The exact reported bug: a ~15'6" wall, an off-center pair 9" apart.
    // The old readout derived gap from the (huge) left inset via the symmetric
    // equation and returned a nonsense large-negative number. It must instead
    // report the single real edge-to-edge gap.
    // wall 4724.4mm (15'6"); 9" = 228.6mm.
    // a: width 400, center 3000 -> edges [2800, 3200]
    // b: width 400, center 3628.6 -> left edge 3428.6; gap = 3428.6 - 3200 = 228.6
    const wallLengthMm = 4724.4;
    const members = [
      makeMember({ id: "a", widthMm: 400, xMm: 3000 }),
      makeMember({ id: "b", widthMm: 400, xMm: 3628.6 })
    ];

    const { gapMm } = getArrangeReadoutDetailed(members, wallLengthMm);
    expect(gapMm).toBeCloseTo(228.6, 6);
    // Sanity: the old inset-derived formula would have gone hugely negative.
    expect(gapMm).toBeGreaterThan(0);
  });

  it("gapMm is the mean of the actual interior gaps for a 3+ mixed layout", () => {
    // a: width 200, center 100 -> right edge 200; gap a->b = 400 - 200 = 200
    // b: width 200, center 500 -> edges [400, 600]; gap b->c = 900 - 600 = 300
    // c: width 200, center 1000 -> left edge 900
    // mean of [200, 300] = 250
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 100 }),
      makeMember({ id: "b", widthMm: 200, xMm: 500 }),
      makeMember({ id: "c", widthMm: 200, xMm: 1000 })
    ];

    const { gapMm } = getArrangeReadoutDetailed(members, 2000);
    expect(gapMm).toBeCloseTo(250, 6);
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

describe("detectBoundary", () => {
  it("falls back to the wall edge on each side with no others", () => {
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];
    expect(detectBoundary("left", members, [], 2000)).toEqual({ type: "wall", edgeMm: 0 });
    expect(detectBoundary("right", members, [], 2000)).toEqual({ type: "wall", edgeMm: 2000 });
  });

  it("detects a same-band neighbour's edge as the boundary, naming its id", () => {
    // artwork center 500, width 300 -> edges [350, 650]
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];
    // window center 1000, width 200 -> edges [900, 1100]; same y-band
    const others = [makeMember({ id: "w", widthMm: 200, xMm: 1000 })];

    expect(detectBoundary("left", members, others, 2000)).toEqual({ type: "wall", edgeMm: 0 });
    expect(detectBoundary("right", members, others, 2000)).toEqual({
      type: "object",
      edgeMm: 900,
      objectId: "w"
    });
  });

  it("ignores a neighbour outside the selection's vertical band", () => {
    const members = [makeMember({ id: "a", widthMm: 300, xMm: 500 })];
    const others = [
      makeMember({ id: "low", widthMm: 200, xMm: 1000, yMm: -1000, heightMm: 400 })
    ];

    expect(detectBoundary("right", members, others, 2000)).toEqual({ type: "wall", edgeMm: 2000 });
  });

  it("agrees with getOpenSpaceBounds on both sides", () => {
    const members = [
      makeMember({ id: "a", widthMm: 200, xMm: 300 }),
      makeMember({ id: "b", widthMm: 200, xMm: 900 })
    ];
    const others = [
      makeMember({ id: "n", widthMm: 200, xMm: -400 }),
      makeMember({ id: "w", widthMm: 200, xMm: 1400 })
    ];

    const left = detectBoundary("left", members, others, 2000);
    const right = detectBoundary("right", members, others, 2000);
    const bounds = getOpenSpaceBounds(members, others, 2000);

    expect(left.edgeMm).toBe(bounds.startMm);
    expect(right.edgeMm).toBe(bounds.endMm);
  });
});

describe("centerMemberBetweenBoundaries", () => {
  it("falls back to the wall edges with no others: midpoint of the whole wall", () => {
    const member = makeMember({ widthMm: 300, xMm: 250 });
    expect(centerMemberBetweenBoundaries(member, [], 2000)).toBe(1000);
  });

  it("centers between a neighbour on the left and the wall edge on the right", () => {
    // neighbour: width 200, center 200 -> right edge 300
    const member = makeMember({ widthMm: 300, xMm: 900 });
    const others = [makeMember({ id: "n", widthMm: 200, xMm: 200 })];
    // left boundary = 300 (neighbour's right edge), right boundary = 2000 (wall end)
    expect(centerMemberBetweenBoundaries(member, others, 2000)).toBe((300 + 2000) / 2);
  });

  it("centers between the wall edge on the left and a neighbour on the right", () => {
    // neighbour: width 200, center 1800 -> left edge 1700
    const member = makeMember({ widthMm: 300, xMm: 900 });
    const others = [makeMember({ id: "n", widthMm: 200, xMm: 1800 })];
    // left boundary = 0 (wall start), right boundary = 1700 (neighbour's left edge)
    expect(centerMemberBetweenBoundaries(member, others, 2000)).toBe((0 + 1700) / 2);
  });

  it("centers between neighbours on both sides", () => {
    // left neighbour: width 200, center 200 -> right edge 300
    // right neighbour: width 200, center 1800 -> left edge 1700
    const member = makeMember({ widthMm: 300, xMm: 900 });
    const others = [
      makeMember({ id: "left", widthMm: 200, xMm: 200 }),
      makeMember({ id: "right", widthMm: 200, xMm: 1800 })
    ];
    expect(centerMemberBetweenBoundaries(member, others, 2000)).toBe((300 + 1700) / 2);
  });

  it("treats a same-band opening as a boundary, same as any other wall object", () => {
    // door: width 200, center 1000 -> left edge 900; same y-band as the work
    const member = makeMember({ widthMm: 300, xMm: 400 });
    const others = [makeMember({ id: "door", widthMm: 200, xMm: 1000 })];
    // left boundary = 0 (wall start, no left neighbour), right boundary = 900 (door's left edge)
    expect(centerMemberBetweenBoundaries(member, others, 2000)).toBe((0 + 900) / 2);
  });

  it("is unclamped: a work wider than the open span still centers on the midpoint", () => {
    // Span between neighbours is only 200mm wide (300 to 500), work is 400mm wide.
    const member = makeMember({ widthMm: 400, xMm: 400 });
    const others = [
      makeMember({ id: "left", widthMm: 200, xMm: 200 }), // right edge 300
      makeMember({ id: "right", widthMm: 200, xMm: 600 }) // left edge 500
    ];
    expect(centerMemberBetweenBoundaries(member, others, 2000)).toBe((300 + 500) / 2);
  });

  it("ignores a neighbour outside the member's vertical band", () => {
    const member = makeMember({ widthMm: 300, xMm: 500 });
    const others = [
      makeMember({ id: "low", widthMm: 200, xMm: 1000, yMm: -1000, heightMm: 400 })
    ];
    // Out-of-band neighbour is ignored, so both boundaries fall back to the wall edges.
    expect(centerMemberBetweenBoundaries(member, others, 2000)).toBe(1000);
  });
});

describe("slideGroupToBoundaryInset", () => {
  it("returns empty array for fewer than 2 members", () => {
    expect(slideGroupToBoundaryInset([], "left", 0, 100)).toEqual([]);
    expect(slideGroupToBoundaryInset([makeMember()], "left", 0, 100)).toEqual([]);
  });

  it("with boundaryEdgeMm 0/wallLengthMm, reproduces slideGroupToEdgeInset exactly", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];
    expect(slideGroupToBoundaryInset(members, "left", 0, 500)).toEqual(
      slideGroupToEdgeInset(members, 2000, "left", 500)
    );
    expect(slideGroupToBoundaryInset(members, "right", 2000, 300)).toEqual(
      slideGroupToEdgeInset(members, 2000, "right", 300)
    );
  });

  it("left: slides the group so its leftmost edge lands insetMm right of a neighbour's edge", () => {
    // a: width 300, center 250 -> edges [100, 400]
    // b: width 400, center 800 -> edges [600, 1000] (leftmost edge = 100)
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];
    // Neighbour's right edge at 50; target leftmost edge = 50 + 80 = 130.
    const result = slideGroupToBoundaryInset(members, "left", 50, 80);
    const newLeftEdge = Math.min(...result.map((r, i) => r.xMm - members[i].widthMm / 2));
    expect(newLeftEdge).toBeCloseTo(130);
  });

  it("right: slides the group so its rightmost edge lands insetMm left of a neighbour's edge", () => {
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 250 }),
      makeMember({ id: "b", widthMm: 400, xMm: 800 })
    ];
    // Neighbour's left edge at 1500; target rightmost edge = 1500 - 80 = 1420.
    const result = slideGroupToBoundaryInset(members, "right", 1500, 80);
    const newRightEdge = Math.max(...result.map((r, i) => r.xMm + members[i].widthMm / 2));
    expect(newRightEdge).toBeCloseTo(1420);
  });
});

describe("arrangeOnWallInZoneWithInset", () => {
  it("returns [] for fewer than 2 members", () => {
    expect(arrangeOnWallInZoneWithInset([], 0, 2000, 100)).toEqual([]);
    expect(arrangeOnWallInZoneWithInset([makeMember()], 0, 2000, 100)).toEqual([]);
  });

  it("with zone [0, wallLength], reproduces arrangeOnWall exactly", () => {
    const members = [
      makeMember({ id: "a", widthMm: 508, xMm: 100 }),
      makeMember({ id: "b", widthMm: 508, xMm: 1000 }),
      makeMember({ id: "c", widthMm: 508, xMm: 2000 })
    ];
    expect(arrangeOnWallInZoneWithInset(members, 0, 2540, 254)).toEqual(
      arrangeOnWall(members, 2540, { insetMm: 254 })
    );
  });

  it("centres the group within an arbitrary zone at the given inset from each zone edge", () => {
    // 2 works of 300mm in the zone [500, 2000] (length 1500)
    // gap = 1500 - 2*100 - 600 = 700
    const members = [
      makeMember({ id: "a", widthMm: 300, xMm: 700 }),
      makeMember({ id: "b", widthMm: 300, xMm: 1800 })
    ];
    const result = arrangeOnWallInZoneWithInset(members, 500, 2000, 100);

    expect(result[0].xMm - 300 / 2).toBeCloseTo(600); // zoneStart + inset
    expect(result[1].xMm + 300 / 2).toBeCloseTo(1900); // zoneEnd - inset
  });
});
