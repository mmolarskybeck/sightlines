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

    expect(byId.get("neighbor-edge:neighbor-1:left")).toMatchObject({
      axis: "x",
      point: { xMm: 650 }
    });
    expect(byId.get("neighbor-edge:neighbor-1:right")).toMatchObject({
      axis: "x",
      point: { xMm: 1350 }
    });
    expect(byId.get("neighbor-edge:neighbor-1:top")).toMatchObject({
      axis: "y",
      point: { yMm: 1700 }
    });
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

    expect(result.snapTargetIds.y).toBe("centerline");
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

    expect(result.snapTargetIds).toEqual({});
    expect(result.point).toEqual({ xMm: 205, yMm: 900 });
  });

  it("includes grid targets when snapToGrid is true, as the lowest-priority tier", () => {
    const result = resolveArtworkSnap({ xMm: 205, yMm: 930 }, { ...baseArgs, snapToGrid: true });

    expect(result.snapTargetIds).toEqual({ x: "grid-x-200" });
    expect(result.point.xMm).toBe(200);
  });

  it("snaps y to the centerline and x to the grid simultaneously", () => {
    // Regression: centerline y and grid x must snap simultaneously.
    const result = resolveArtworkSnap(
      { xMm: 205, yMm: 1442 },
      { ...baseArgs, snapToGrid: true }
    );

    expect(result.snapTargetIds).toEqual({ x: "grid-x-200", y: "centerline" });
    expect(result.point).toEqual({ xMm: 200, yMm: 1450 });
    expect(result.activeGuides).toHaveLength(2);
  });

  it("carries per-axis hysteresis through via previousSnapTargetIds, same as resolveSnap", () => {
    const result = resolveArtworkSnap(
      { xMm: 213, yMm: 930 },
      {
        ...baseArgs,
        snapToGrid: true,
        thresholdMm: 10,
        previousSnapTargetIds: { x: "grid-x-200" }
      }
    );

    expect(result.snapTargetIds.x).toBe("grid-x-200");
  });

  describe("door floor snapping", () => {
    // Doors snap their bottom edge to wall-local floor y=0.
    const doorArgs = {
      ...baseArgs,
      movingSize: { widthMm: 900, heightMm: 2100 },
      movingKind: "door" as const
    };

    it("snaps a door's bottom edge to the floor with a floor guide", () => {
      const result = resolveArtworkSnap(
        { xMm: 555, yMm: 1062 },
        { ...doorArgs, snapToGrid: false }
      );

      expect(result.point.yMm).toBe(1050);
      expect(result.snapTargetIds.y).toBe("floor");
      expect(result.activeGuides).toEqual([
        { id: "floor-y", axis: "y", positionMm: 1050, targetId: "floor" }
      ]);
    });

    it("prefers the floor over the centerline when both are within threshold", () => {
      // Door floor priority beats the nearer centerline target.
      const result = resolveArtworkSnap(
        { xMm: 555, yMm: 1430 },
        {
          ...doorArgs,
          movingSize: { widthMm: 900, heightMm: 2800 },
          snapToGrid: false,
          thresholdMm: 40
        }
      );

      expect(result.point.yMm).toBe(1400);
      expect(result.snapTargetIds.y).toBe("floor");
    });

    it("keeps the floor tier active regardless of the snapToGrid preference", () => {
      // snapToGrid gates only grid targets, never the floor target.
      const withGrid = resolveArtworkSnap(
        { xMm: 555, yMm: 1062 },
        { ...doorArgs, snapToGrid: true }
      );
      const withoutGrid = resolveArtworkSnap(
        { xMm: 555, yMm: 1062 },
        { ...doorArgs, snapToGrid: false }
      );

      expect(withGrid.snapTargetIds.y).toBe("floor");
      expect(withoutGrid.snapTargetIds.y).toBe("floor");
    });
  });

  describe("floor snapping for non-door kinds", () => {
    it("gives every moving kind a floor target, ranked below centerline for non-doors", () => {
      for (const movingKind of ["artwork", "window", "blocked-zone"] as const) {
        const targets = getArtworkSnapTargets({
          centerlineYMm: baseArgs.centerlineYMm,
          wallLengthMm: baseArgs.wallLengthMm,
          wallHeightMm: baseArgs.wallHeightMm,
          gridIntervalMm: 0,
          neighbors: [],
          movingSize: { widthMm: 900, heightMm: 2100 },
          movingKind
        });

        const floor = targets.find((target) => target.kind === "floor");
        expect(floor).toMatchObject({
          id: "floor",
          axis: "y",
          priority: 1.5,
          point: { yMm: 1050 }
        });
      }
    });

    it("snaps an artwork's bottom edge to the floor when the centerline is out of range", () => {
      const result = resolveArtworkSnap(
        { xMm: 555, yMm: 210 },
        { ...baseArgs, snapToGrid: false }
      );

      expect(result.point.yMm).toBe(200);
      expect(result.snapTargetIds.y).toBe("floor");
      expect(result.activeGuides).toEqual([
        { id: "floor-y", axis: "y", positionMm: 200, targetId: "floor" }
      ]);
    });

    it("prefers the centerline over the floor for a tall artwork with both in range", () => {
      // Artwork centerline priority beats the floor target, opposite doors.
      const result = resolveArtworkSnap(
        { xMm: 555, yMm: 1430 },
        {
          ...baseArgs,
          movingSize: { widthMm: 900, heightMm: 2800 },
          movingKind: "artwork",
          snapToGrid: false,
          thresholdMm: 40
        }
      );

      expect(result.point.yMm).toBe(1450);
      expect(result.snapTargetIds.y).toBe("centerline");
    });

    it("floor-snaps the artwork drop-ghost path (movingKind 'artwork', grid on)", () => {
      // The artwork drop ghost uses the same floor-over-grid priority.
      const result = resolveArtworkSnap(
        { xMm: 555, yMm: 210 },
        { ...baseArgs, movingKind: "artwork", snapToGrid: true }
      );

      expect(result.point.yMm).toBe(200);
      expect(result.snapTargetIds.y).toBe("floor");
    });
  });
});
