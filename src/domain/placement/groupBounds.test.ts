import { describe, expect, it } from "vitest";
import type { WallObjectBase } from "../project";
import { getGroupBounds, getIdsIntersectingRect } from "./groupBounds";

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

describe("getGroupBounds", () => {
  it("single member degenerates to its own rect (center-based)", () => {
    const members = [
      makeMember({ id: "a", xMm: 1000, yMm: 1500, widthMm: 400, heightMm: 600 })
    ];

    const bounds = getGroupBounds(members);

    expect(bounds).toEqual({
      centerXMm: 1000,
      centerYMm: 1500,
      widthMm: 400,
      heightMm: 600
    });
  });

  it("union box of several members spans min/max edges", () => {
    // Member a: center (500, 600), size 400x300
    // left edge: 500-200=300, right: 500+200=700
    // top edge: 600-150=450, bottom: 600+150=750
    const memberA = makeMember({
      id: "a",
      xMm: 500,
      yMm: 600,
      widthMm: 400,
      heightMm: 300
    });

    // Member b: center (1200, 800), size 600x400
    // left edge: 1200-300=900, right: 1200+300=1500
    // top edge: 800-200=600, bottom: 800+200=1000
    const memberB = makeMember({
      id: "b",
      xMm: 1200,
      yMm: 800,
      widthMm: 600,
      heightMm: 400
    });

    // Member c: center (800, 500), size 200x200
    // left edge: 800-100=700, right: 800+100=900
    // top edge: 500-100=400, bottom: 500+100=600
    const memberC = makeMember({
      id: "c",
      xMm: 800,
      yMm: 500,
      widthMm: 200,
      heightMm: 200
    });

    const bounds = getGroupBounds([memberA, memberB, memberC]);

    // Union: minX=300, maxX=1500, minY=400, maxY=1000
    // centerX = (300 + 1500) / 2 = 900
    // centerY = (400 + 1000) / 2 = 700
    // width = 1500 - 300 = 1200
    // height = 1000 - 400 = 600
    expect(bounds).toEqual({
      centerXMm: 900,
      centerYMm: 700,
      widthMm: 1200,
      heightMm: 600
    });
  });

  it("handles negative coordinates", () => {
    const memberA = makeMember({
      id: "a",
      xMm: -500,
      yMm: -300,
      widthMm: 400,
      heightMm: 200
    });

    const memberB = makeMember({
      id: "b",
      xMm: 300,
      yMm: 200,
      widthMm: 600,
      heightMm: 300
    });

    const bounds = getGroupBounds([memberA, memberB]);

    // Member a: left=-700, right=-300, top=-400, bottom=-200
    // Member b: left=0, right=600, top=50, bottom=350
    // Union: minX=-700, maxX=600, minY=-400, maxY=350
    expect(bounds.centerXMm).toBe(-50);
    expect(bounds.centerYMm).toBe(-25);
    expect(bounds.widthMm).toBe(1300);
    expect(bounds.heightMm).toBe(750);
  });

  it("two members arranged vertically only", () => {
    const members = [
      makeMember({
        id: "a",
        xMm: 1000,
        yMm: 500,
        widthMm: 400,
        heightMm: 200
      }),
      makeMember({
        id: "b",
        xMm: 1000,
        yMm: 1500,
        widthMm: 400,
        heightMm: 200
      })
    ];

    const bounds = getGroupBounds(members);

    // Both have same x=1000, width=400, so centerX=1000, width=400
    // y: 500-100=400 to 500+100=600 and 1500-100=1400 to 1500+100=1600
    // Union: minY=400, maxY=1600, centerY=1000, height=1200
    expect(bounds).toEqual({
      centerXMm: 1000,
      centerYMm: 1000,
      widthMm: 400,
      heightMm: 1200
    });
  });
});

describe("getIdsIntersectingRect", () => {
  it("fully inside: member within rect is selected", () => {
    const members = [
      makeMember({ id: "a", xMm: 500, yMm: 500, widthMm: 200, heightMm: 200 })
    ];

    const result = getIdsIntersectingRect(members, {
      minXMm: 100,
      maxXMm: 900,
      minYMm: 100,
      maxYMm: 900
    });

    expect(result).toEqual(["a"]);
  });

  it("partial overlap: member partially in rect is selected", () => {
    const members = [
      makeMember({ id: "a", xMm: 800, yMm: 500, widthMm: 400, heightMm: 200 })
    ];

    // Member a: left=600, right=1000, top=400, bottom=600
    const result = getIdsIntersectingRect(members, {
      minXMm: 700,
      maxXMm: 900,
      minYMm: 300,
      maxYMm: 700
    });

    expect(result).toEqual(["a"]);
  });

  it("fully outside: member not in rect is not selected", () => {
    const members = [
      makeMember({ id: "a", xMm: 100, yMm: 100, widthMm: 100, heightMm: 100 })
    ];

    const result = getIdsIntersectingRect(members, {
      minXMm: 500,
      maxXMm: 700,
      minYMm: 500,
      maxYMm: 700
    });

    expect(result).toEqual([]);
  });

  it("edge touch is INCLUSIVE: member at exact boundary is selected", () => {
    const members = [
      makeMember({ id: "a", xMm: 1000, yMm: 500, widthMm: 200, heightMm: 200 })
    ];

    // Member a: left=900, right=1100
    // Rect with maxXMm=900 should touch the left edge and select
    const result = getIdsIntersectingRect(members, {
      minXMm: 100,
      maxXMm: 900,
      minYMm: 100,
      maxYMm: 900
    });

    expect(result).toEqual(["a"]);
  });

  it("edge touch on all four sides", () => {
    const members = [
      makeMember({ id: "a", xMm: 500, yMm: 500, widthMm: 100, heightMm: 100 })
    ];

    // Member a: left=450, right=550, top=450, bottom=550

    // Touch left edge
    let result = getIdsIntersectingRect(members, {
      minXMm: 450,
      maxXMm: 600,
      minYMm: 400,
      maxYMm: 600
    });
    expect(result).toEqual(["a"]);

    // Touch right edge
    result = getIdsIntersectingRect(members, {
      minXMm: 400,
      maxXMm: 550,
      minYMm: 400,
      maxYMm: 600
    });
    expect(result).toEqual(["a"]);

    // Touch top edge
    result = getIdsIntersectingRect(members, {
      minXMm: 400,
      maxXMm: 600,
      minYMm: 450,
      maxYMm: 600
    });
    expect(result).toEqual(["a"]);

    // Touch bottom edge
    result = getIdsIntersectingRect(members, {
      minXMm: 400,
      maxXMm: 600,
      minYMm: 400,
      maxYMm: 550
    });
    expect(result).toEqual(["a"]);
  });

  it("corner touch: rect touching at corner is inclusive", () => {
    const members = [
      makeMember({ id: "a", xMm: 500, yMm: 500, widthMm: 100, heightMm: 100 })
    ];

    // Member a: left=450, right=550, top=450, bottom=550
    // Rect corner at (550, 550) — right/bottom corner touch
    const result = getIdsIntersectingRect(members, {
      minXMm: 600,
      maxXMm: 550,
      minYMm: 600,
      maxYMm: 550
    });

    // This is a degenerate rect (min > max), but the math should still work
    // Actually, let's test proper corner touch
    const result2 = getIdsIntersectingRect(members, {
      minXMm: 400,
      maxXMm: 450,
      minYMm: 400,
      maxYMm: 450
    });

    // Rect: left=400, right=450, top=400, bottom=450
    // Member a: left=450, right=550, top=450, bottom=550
    // Touch at (450, 450)
    expect(result2).toEqual(["a"]);
  });

  it("multiple members preserves input order", () => {
    const members = [
      makeMember({ id: "c", xMm: 1500, yMm: 500, widthMm: 100, heightMm: 100 }),
      makeMember({ id: "a", xMm: 300, yMm: 500, widthMm: 100, heightMm: 100 }),
      makeMember({ id: "b", xMm: 900, yMm: 500, widthMm: 100, heightMm: 100 })
    ];

    const result = getIdsIntersectingRect(members, {
      minXMm: 0,
      maxXMm: 2000,
      minYMm: 0,
      maxYMm: 1000
    });

    // All three are inside, should maintain input order: c, a, b
    expect(result).toEqual(["c", "a", "b"]);
  });

  it("mixed inside, outside, overlapping preserves order of selected", () => {
    const members = [
      makeMember({ id: "a", xMm: 200, yMm: 500, widthMm: 100, heightMm: 100 }),
      makeMember({ id: "b", xMm: 500, yMm: 500, widthMm: 100, heightMm: 100 }),
      makeMember({ id: "c", xMm: 800, yMm: 500, widthMm: 100, heightMm: 100 }),
      makeMember({ id: "d", xMm: 1100, yMm: 500, widthMm: 100, heightMm: 100 })
    ];

    // Select members b, c, d (overlap with a but not select it)
    const result = getIdsIntersectingRect(members, {
      minXMm: 400,
      maxXMm: 1150,
      minYMm: 400,
      maxYMm: 600
    });

    expect(result).toEqual(["b", "c", "d"]);
  });

  it("negative coordinates in rect", () => {
    const members = [
      makeMember({ id: "a", xMm: -500, yMm: -300, widthMm: 200, heightMm: 200 })
    ];

    // Member a: left=-600, right=-400, top=-400, bottom=-200
    const result = getIdsIntersectingRect(members, {
      minXMm: -700,
      maxXMm: -300,
      minYMm: -500,
      maxYMm: 0
    });

    expect(result).toEqual(["a"]);
  });

  it("small rect with tight coordinates", () => {
    const members = [
      makeMember({ id: "a", xMm: 0.5, yMm: 0.5, widthMm: 1, heightMm: 1 })
    ];

    // Member a: left=0, right=1, top=0, bottom=1
    const result = getIdsIntersectingRect(members, {
      minXMm: 0,
      maxXMm: 1,
      minYMm: 0,
      maxYMm: 1
    });

    expect(result).toEqual(["a"]);
  });
});
