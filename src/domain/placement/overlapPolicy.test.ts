import { describe, expect, it } from "vitest";
import { getOverlapRule, isBlockingKind } from "./overlapPolicy";

describe("isBlockingKind", () => {
  it("is true only for door, window and blocked-zone", () => {
    expect(isBlockingKind("door")).toBe(true);
    expect(isBlockingKind("window")).toBe(true);
    expect(isBlockingKind("blocked-zone")).toBe(true);
  });

  it("is false for artwork, wall text and cases — furniture, not architecture", () => {
    expect(isBlockingKind("artwork")).toBe(false);
    expect(isBlockingKind("wall-text")).toBe(false);
    expect(isBlockingKind("case")).toBe(false);
  });
});

describe("getOverlapRule", () => {
  it("forbids two architectural openings overlapping (unoverridable physical conflict)", () => {
    expect(getOverlapRule("door", "door")).toBe("forbidden");
    expect(getOverlapRule("door", "window")).toBe("forbidden");
    expect(getOverlapRule("window", "window")).toBe("forbidden");
    expect(getOverlapRule("door", "blocked-zone")).toBe("forbidden");
    expect(getOverlapRule("blocked-zone", "blocked-zone")).toBe("forbidden");
    // Order shouldn't matter.
    expect(getOverlapRule("blocked-zone", "door")).toBe("forbidden");
  });

  it("makes a door overlapping wall text blockable — wall text never blocks placement", () => {
    expect(getOverlapRule("door", "wall-text")).toBe("blockable");
    expect(getOverlapRule("wall-text", "door")).toBe("blockable");
  });

  it("makes a door overlapping a display case blockable — a case never blocks placement", () => {
    expect(getOverlapRule("door", "case")).toBe("blockable");
    expect(getOverlapRule("case", "door")).toBe("blockable");
  });

  it("makes any pair involving artwork blockable", () => {
    expect(getOverlapRule("artwork", "door")).toBe("blockable");
    expect(getOverlapRule("artwork", "artwork")).toBe("blockable");
    expect(getOverlapRule("artwork", "wall-text")).toBe("blockable");
    expect(getOverlapRule("artwork", "case")).toBe("blockable");
  });

  it("makes a wall-text/case pair blockable", () => {
    expect(getOverlapRule("wall-text", "case")).toBe("blockable");
  });
});
