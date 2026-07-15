import { describe, expect, it } from "vitest";
import {
  buildMeasurePointCandidates,
  constrainMeasurePointToAxis,
  nearestPointOnMeasureSegment,
  resolveMeasurePoint,
  type MeasurePointCandidate
} from "./measurement";

const candidate = (
  id: string,
  kind: MeasurePointCandidate["kind"],
  xMm: number,
  yMm: number,
  priority?: number
): MeasurePointCandidate => ({
  id,
  kind,
  point: { xMm, yMm },
  ...(priority !== undefined ? { priority } : {})
});

describe("resolveMeasurePoint", () => {
  it("returns the proposed point unchanged when no candidate is eligible", () => {
    const proposed = { xMm: 10, yMm: 20 };
    expect(
      resolveMeasurePoint(proposed, [candidate("far", "vertex", 100, 100)], {
        thresholdMm: 5
      })
    ).toEqual({ point: proposed, target: null, snapped: false });
  });

  it("resolves one coherent candidate rather than mixing coordinates", () => {
    const result = resolveMeasurePoint(
      { xMm: 4, yMm: 6 },
      [candidate("x-near", "vertex", 4, 10), candidate("y-near", "vertex", 0, 6)],
      { thresholdMm: 10 }
    );

    expect(result.point).toEqual({ xMm: 4, yMm: 10 });
    expect(result.target?.id).toBe("x-near");
  });

  it("ranks family priority before Euclidean distance", () => {
    const result = resolveMeasurePoint(
      { xMm: 0, yMm: 0 },
      [candidate("near-grid", "grid", 1, 0), candidate("vertex", "vertex", 8, 0)],
      { thresholdMm: 10 }
    );
    expect(result.target?.id).toBe("vertex");
  });

  it("then ranks Euclidean distance within a priority tier", () => {
    const result = resolveMeasurePoint(
      { xMm: 0, yMm: 0 },
      [candidate("far", "edge", 4, 3), candidate("near", "edge", 2, 0)],
      { thresholdMm: 10 }
    );
    expect(result.target?.id).toBe("near");
  });

  it("uses stable id as the final tie-break", () => {
    const result = resolveMeasurePoint(
      { xMm: 0, yMm: 0 },
      [candidate("z-target", "center", -3, 4), candidate("a-target", "center", 3, 4)],
      { thresholdMm: 5 }
    );
    expect(result.target?.id).toBe("a-target");
  });

  it("honors an explicit priority override", () => {
    const result = resolveMeasurePoint(
      { xMm: 0, yMm: 0 },
      [candidate("vertex", "vertex", 1, 0), candidate("special", "grid", 2, 0, 0)],
      { thresholdMm: 5 }
    );
    expect(result.target?.id).toBe("special");
  });

  it("gives only the previously held target the wider break-free threshold", () => {
    const candidates = [
      candidate("held", "edge", 15, 0),
      candidate("other", "edge", 0, 15)
    ];
    const result = resolveMeasurePoint({ xMm: 0, yMm: 0 }, candidates, {
      thresholdMm: 10,
      previousTargetId: "held",
      breakFreeMultiplier: 2
    });
    expect(result.target?.id).toBe("held");
  });

  it("retains the held target over a higher-priority, closer newcomer", () => {
    const result = resolveMeasurePoint(
      { xMm: 0, yMm: 0 },
      [candidate("held", "grid", 12, 0), candidate("new-vertex", "vertex", 1, 0)],
      { thresholdMm: 10, previousTargetId: "held", breakFreeMultiplier: 1.5 }
    );
    expect(result.target?.id).toBe("held");
  });

  it("ranks ordinary candidates again after breaking free of the held target", () => {
    const result = resolveMeasurePoint(
      { xMm: 0, yMm: 0 },
      [candidate("held", "grid", 16, 0), candidate("new-edge", "edge", 8, 0)],
      { thresholdMm: 10, previousTargetId: "held", breakFreeMultiplier: 1.5 }
    );
    expect(result.target?.id).toBe("new-edge");
  });

  it("releases a held target outside its break-free threshold", () => {
    const result = resolveMeasurePoint(
      { xMm: 0, yMm: 0 },
      [candidate("held", "edge", 16, 0)],
      { thresholdMm: 10, previousTargetId: "held" }
    );
    expect(result.snapped).toBe(false);
  });

  it("includes candidates exactly on the threshold", () => {
    const result = resolveMeasurePoint(
      { xMm: 0, yMm: 0 },
      [candidate("edge", "edge", 3, 4)],
      { thresholdMm: 5 }
    );
    expect(result.target?.id).toBe("edge");
  });
});

describe("nearestPointOnMeasureSegment", () => {
  it("projects onto horizontal and diagonal segments", () => {
    expect(
      nearestPointOnMeasureSegment(
        { xMm: 4, yMm: 3 },
        { xMm: 0, yMm: 0 },
        { xMm: 10, yMm: 0 }
      )
    ).toEqual({ xMm: 4, yMm: 0 });
    expect(
      nearestPointOnMeasureSegment(
        { xMm: 10, yMm: 0 },
        { xMm: 0, yMm: 0 },
        { xMm: 10, yMm: 10 }
      )
    ).toEqual({ xMm: 5, yMm: 5 });
  });

  it("clamps to finite endpoints instead of extending the segment", () => {
    expect(
      nearestPointOnMeasureSegment(
        { xMm: 15, yMm: 2 },
        { xMm: 0, yMm: 0 },
        { xMm: 10, yMm: 0 }
      )
    ).toEqual({ xMm: 10, yMm: 0 });
  });

  it("treats a degenerate segment as its single point", () => {
    expect(
      nearestPointOnMeasureSegment(
        { xMm: 50, yMm: 60 },
        { xMm: 2, yMm: 3 },
        { xMm: 2, yMm: 3 }
      )
    ).toEqual({ xMm: 2, yMm: 3 });
  });
});

describe("buildMeasurePointCandidates", () => {
  it("passes point sources through and projects finite segment sources", () => {
    expect(
      buildMeasurePointCandidates(
        { xMm: 12, yMm: 4 },
        {
          points: [
            { id: "corner", kind: "vertex", point: { xMm: 1, yMm: 2 } },
            { id: "grid", kind: "grid", point: { xMm: 10, yMm: 5 }, priority: 9 }
          ],
          segments: [
            {
              id: "wall-edge",
              kind: "edge",
              start: { xMm: 0, yMm: 0 },
              end: { xMm: 10, yMm: 0 }
            },
            {
              id: "floorline",
              kind: "datum",
              start: { xMm: 0, yMm: 20 },
              end: { xMm: 30, yMm: 20 },
              priority: 3.5
            }
          ]
        }
      )
    ).toEqual([
      { id: "corner", kind: "vertex", point: { xMm: 1, yMm: 2 } },
      { id: "grid", kind: "grid", point: { xMm: 10, yMm: 5 }, priority: 9 },
      { id: "wall-edge", kind: "edge", point: { xMm: 10, yMm: 0 } },
      { id: "floorline", kind: "datum", point: { xMm: 12, yMm: 20 }, priority: 3.5 }
    ]);
  });

  it("feeds directly into coherent resolution", () => {
    const proposed = { xMm: 5, yMm: 2 };
    const candidates = buildMeasurePointCandidates(proposed, {
      segments: [
        {
          id: "edge",
          kind: "edge",
          start: { xMm: 0, yMm: 0 },
          end: { xMm: 10, yMm: 0 }
        }
      ]
    });
    expect(resolveMeasurePoint(proposed, candidates, { thresholdMm: 3 }).point).toEqual({
      xMm: 5,
      yMm: 0
    });
  });
});

describe("constrainMeasurePointToAxis", () => {
  it("locks a predominantly horizontal gesture to the anchor y", () => {
    expect(
      constrainMeasurePointToAxis({ xMm: 10, yMm: 20 }, { xMm: 50, yMm: 30 })
    ).toEqual({ xMm: 50, yMm: 20 });
  });

  it("locks a predominantly vertical gesture to the anchor x", () => {
    expect(
      constrainMeasurePointToAxis({ xMm: 10, yMm: 20 }, { xMm: 15, yMm: -40 })
    ).toEqual({ xMm: 10, yMm: -40 });
  });

  it("resolves exact diagonals horizontally and preserves a coincident point", () => {
    expect(
      constrainMeasurePointToAxis({ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 10 })
    ).toEqual({ xMm: 10, yMm: 0 });
    expect(
      constrainMeasurePointToAxis({ xMm: 5, yMm: 6 }, { xMm: 5, yMm: 6 })
    ).toEqual({ xMm: 5, yMm: 6 });
  });
});
