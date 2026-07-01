import { describe, expect, it } from "vitest";
import { resolveSnap } from "./resolveSnap";

describe("resolveSnap", () => {
  it("prioritizes centerline over closer grid targets", () => {
    const result = resolveSnap(
      { xMm: 98, yMm: 1450 },
      [
        { id: "grid-100", kind: "grid", axis: "x", point: { xMm: 100, yMm: 0 } },
        {
          id: "centerline",
          kind: "centerline",
          axis: "y",
          point: { xMm: 0, yMm: 1448 }
        }
      ],
      { thresholdMm: 10 }
    );

    expect(result.point).toEqual({ xMm: 98, yMm: 1448 });
    expect(result.snapTargetId).toBe("centerline");
  });

  it("uses hysteresis for the previous snap target", () => {
    const result = resolveSnap(
      { xMm: 18, yMm: 0 },
      [{ id: "grid", kind: "grid", axis: "x", point: { xMm: 0, yMm: 0 } }],
      { thresholdMm: 10, previousSnapTargetId: "grid", breakFreeMultiplier: 2 }
    );

    expect(result.snapTargetId).toBe("grid");
  });
});
