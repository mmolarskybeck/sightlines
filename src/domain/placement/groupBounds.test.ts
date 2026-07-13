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
    const memberA = makeMember({
      id: "a",
      xMm: 500,
      yMm: 600,
      widthMm: 400,
      heightMm: 300
    });

    const memberB = makeMember({
      id: "b",
      xMm: 1200,
      yMm: 800,
      widthMm: 600,
      heightMm: 400
    });

    const memberC = makeMember({
      id: "c",
      xMm: 800,
      yMm: 500,
      widthMm: 200,
      heightMm: 200
    });

    const bounds = getGroupBounds([memberA, memberB, memberC]);

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

    let result = getIdsIntersectingRect(members, {
      minXMm: 450,
      maxXMm: 600,
      minYMm: 400,
      maxYMm: 600
    });
    expect(result).toEqual(["a"]);

    result = getIdsIntersectingRect(members, {
      minXMm: 400,
      maxXMm: 550,
      minYMm: 400,
      maxYMm: 600
    });
    expect(result).toEqual(["a"]);

    result = getIdsIntersectingRect(members, {
      minXMm: 400,
      maxXMm: 600,
      minYMm: 450,
      maxYMm: 600
    });
    expect(result).toEqual(["a"]);

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

    const result = getIdsIntersectingRect(members, {
      minXMm: 600,
      maxXMm: 550,
      minYMm: 600,
      maxYMm: 550
    });

    const result2 = getIdsIntersectingRect(members, {
      minXMm: 400,
      maxXMm: 450,
      minYMm: 400,
      maxYMm: 450
    });

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

    expect(result).toEqual(["c", "a", "b"]);
  });

  it("mixed inside, outside, overlapping preserves order of selected", () => {
    const members = [
      makeMember({ id: "a", xMm: 200, yMm: 500, widthMm: 100, heightMm: 100 }),
      makeMember({ id: "b", xMm: 500, yMm: 500, widthMm: 100, heightMm: 100 }),
      makeMember({ id: "c", xMm: 800, yMm: 500, widthMm: 100, heightMm: 100 }),
      makeMember({ id: "d", xMm: 1100, yMm: 500, widthMm: 100, heightMm: 100 })
    ];

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

    const result = getIdsIntersectingRect(members, {
      minXMm: 0,
      maxXMm: 1,
      minYMm: 0,
      maxYMm: 1
    });

    expect(result).toEqual(["a"]);
  });
});
