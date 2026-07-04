import { describe, expect, it } from "vitest";
import type { ArtworkWallObject } from "../project";
import { getArtworkSnapTargets, resolveArtworkSnap } from "./artworkSnapTargets";
import { resolveSnap } from "./resolveSnap";

function neighbor(overrides: Partial<ArtworkWallObject> = {}): ArtworkWallObject {
  return {
    id: "neighbor-1",
    kind: "artwork",
    artworkId: "artwork-1",
    wallId: "wall-1",
    xMm: 1000,
    yMm: 1500,
    widthMm: 400,
    heightMm: 600,
    ...overrides
  };
}

describe("getArtworkSnapTargets", () => {
  it("produces exactly one centerline target, keyed to axis y", () => {
    const targets = getArtworkSnapTargets({
      centerlineYMm: 1450,
      wallLengthMm: 4000,
      wallHeightMm: 3000,
      gridIntervalMm: 0,
      neighbors: [],
      movingSize: { widthMm: 300, heightMm: 400 }
    });

    const centerlineTargets = targets.filter((target) => target.kind === "centerline");
    expect(centerlineTargets).toEqual([
      { id: "centerline", kind: "centerline", axis: "y", point: { xMm: 0, yMm: 1450 } }
    ]);
  });

  it("produces neighbor-center targets on both axes per neighbor", () => {
    const targets = getArtworkSnapTargets({
      centerlineYMm: 1450,
      wallLengthMm: 4000,
      wallHeightMm: 3000,
      gridIntervalMm: 0,
      neighbors: [neighbor({ id: "n1" }), neighbor({ id: "n2", xMm: 2000, yMm: 1600 })],
      movingSize: { widthMm: 300, heightMm: 400 }
    });

    const centerTargets = targets.filter((target) => target.kind === "neighbor-center");
    expect(centerTargets).toHaveLength(4);
    expect(centerTargets.map((target) => target.id).sort()).toEqual([
      "neighbor-center:n1:x",
      "neighbor-center:n1:y",
      "neighbor-center:n2:x",
      "neighbor-center:n2:y"
    ]);
    expect(centerTargets.find((target) => target.id === "neighbor-center:n1:x")?.point.xMm).toBe(
      1000
    );
    expect(centerTargets.find((target) => target.id === "neighbor-center:n2:y")?.point.yMm).toBe(
      1600
    );
  });

  it("computes neighbor-edge flush/align candidate centers from neighbor bounds and moving size", () => {
    // Neighbor: center (1000, 1500), 400 wide x 600 tall -> left 800, right
    // 1200, top 1800, bottom 1200. Moving artwork: 300 wide x 200 tall.
    const targets = getArtworkSnapTargets({
      centerlineYMm: 1450,
      wallLengthMm: 4000,
      wallHeightMm: 3000,
      gridIntervalMm: 0,
      neighbors: [neighbor()],
      movingSize: { widthMm: 300, heightMm: 200 }
    });

    const edgeTargets = targets.filter((target) => target.kind === "neighbor-edge");
    const byId = new Map(edgeTargets.map((target) => [target.id, target]));

    // Moving's right edge flush with neighbor's left edge (800): center = 800 - 150 = 650.
    expect(byId.get("neighbor-edge:neighbor-1:left")).toMatchObject({
      axis: "x",
      point: { xMm: 650 }
    });
    // Moving's left edge flush with neighbor's right edge (1200): center = 1200 + 150 = 1350.
    expect(byId.get("neighbor-edge:neighbor-1:right")).toMatchObject({
      axis: "x",
      point: { xMm: 1350 }
    });
    // Moving's top edge aligned with neighbor's top edge (1800): center = 1800 - 100 = 1700.
    expect(byId.get("neighbor-edge:neighbor-1:top")).toMatchObject({
      axis: "y",
      point: { yMm: 1700 }
    });
    // Moving's bottom edge aligned with neighbor's bottom edge (1200): center = 1200 + 100 = 1300.
    expect(byId.get("neighbor-edge:neighbor-1:bottom")).toMatchObject({
      axis: "y",
      point: { yMm: 1300 }
    });
  });

  it("bounds grid targets to the wall's own length and height, not an arbitrary viewport", () => {
    const targets = getArtworkSnapTargets({
      centerlineYMm: 1450,
      wallLengthMm: 1000,
      wallHeightMm: 500,
      gridIntervalMm: 100,
      neighbors: [],
      movingSize: { widthMm: 300, heightMm: 200 }
    });

    const gridTargets = targets.filter((target) => target.kind === "grid");
    const xValues = gridTargets.filter((t) => t.axis === "x").map((t) => t.point.xMm);
    const yValues = gridTargets.filter((t) => t.axis === "y").map((t) => t.point.yMm);

    expect(Math.min(...xValues)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xValues)).toBeLessThanOrEqual(1000);
    expect(Math.min(...yValues)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...yValues)).toBeLessThanOrEqual(500);
  });

  it("lets resolveSnap prioritize centerline over a coexisting, closer neighbor-center target", () => {
    const targets = getArtworkSnapTargets({
      centerlineYMm: 1500,
      wallLengthMm: 4000,
      wallHeightMm: 3000,
      gridIntervalMm: 50,
      neighbors: [neighbor({ yMm: 1505 })],
      movingSize: { widthMm: 400, heightMm: 600 }
    });

    const result = resolveSnap({ xMm: 1000, yMm: 1502 }, targets, { thresholdMm: 20 });

    expect(result.snapTargetId).toBe("centerline");
    expect(result.point.yMm).toBe(1500);
  });
});

describe("resolveArtworkSnap", () => {
  const baseArgs = {
    centerlineYMm: 1450,
    wallLengthMm: 4000,
    wallHeightMm: 3000,
    gridIntervalMm: 100,
    neighbors: [] as ArtworkWallObject[],
    movingSize: { widthMm: 300, heightMm: 400 },
    thresholdMm: 20
  };

  it("excludes grid targets entirely when snapToGrid is false", () => {
    const result = resolveArtworkSnap(
      { xMm: 205, yMm: 900 },
      { ...baseArgs, snapToGrid: false }
    );

    // No centerline/neighbor target is anywhere near (205, 900); with grid
    // disabled there is nothing left to snap to.
    expect(result.snapTargetId).toBeUndefined();
    expect(result.point).toEqual({ xMm: 205, yMm: 900 });
  });

  it("includes grid targets when snapToGrid is true, as the lowest-priority tier", () => {
    // yMm: 930 is deliberately off any grid line (nearest is 900/1000, both
    // outside the 20mm threshold) so only the x-axis grid target is in play.
    const result = resolveArtworkSnap({ xMm: 205, yMm: 930 }, { ...baseArgs, snapToGrid: true });

    expect(result.snapTargetId).toBe("grid-x-200");
    expect(result.point.xMm).toBe(200);
  });

  it("carries hysteresis through via previousSnapTargetId, same as resolveSnap", () => {
    const result = resolveArtworkSnap(
      { xMm: 213, yMm: 930 },
      {
        ...baseArgs,
        snapToGrid: true,
        thresholdMm: 10,
        previousSnapTargetId: "grid-x-200"
      }
    );

    // 13mm away exceeds the plain 10mm threshold but not resolveSnap's
    // default 1.5x break-free multiplier (15mm) applied to the previously-
    // active target.
    expect(result.snapTargetId).toBe("grid-x-200");
  });
});
