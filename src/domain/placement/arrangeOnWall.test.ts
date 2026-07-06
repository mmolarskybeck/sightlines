import { describe, expect, it } from "vitest";
import type { WallObjectBase } from "../project";
import {
  arrangeOnWall,
  gapForInset,
  getArrangeReadout,
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
