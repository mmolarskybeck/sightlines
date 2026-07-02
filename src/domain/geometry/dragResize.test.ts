import { describe, expect, it } from "vitest";
import {
  computeDraggedLengthMm,
  MIN_DRAG_LENGTH_MM,
  projectDeltaOntoAxis
} from "./dragResize";

describe("projectDeltaOntoAxis", () => {
  it("returns the full delta magnitude when the drag is parallel to the axis", () => {
    expect(
      projectDeltaOntoAxis({ xMm: 400, yMm: 0 }, { xMm: 1, yMm: 0 })
    ).toBeCloseTo(400);
  });

  it("returns zero when the drag is perpendicular to the axis", () => {
    expect(
      projectDeltaOntoAxis({ xMm: 0, yMm: 400 }, { xMm: 1, yMm: 0 })
    ).toBeCloseTo(0);
  });

  it("only counts the component of a diagonal drag along the axis", () => {
    expect(
      projectDeltaOntoAxis({ xMm: 300, yMm: 400 }, { xMm: 1, yMm: 0 })
    ).toBeCloseTo(300);
    expect(
      projectDeltaOntoAxis({ xMm: 300, yMm: 400 }, { xMm: 0, yMm: 1 })
    ).toBeCloseTo(400);
  });

  it("goes negative when the drag runs opposite the axis direction", () => {
    expect(
      projectDeltaOntoAxis({ xMm: -150, yMm: 0 }, { xMm: 1, yMm: 0 })
    ).toBeCloseTo(-150);
  });
});

describe("computeDraggedLengthMm", () => {
  it("adds the axis-projected delta to the starting length", () => {
    const result = computeDraggedLengthMm(
      3000,
      { xMm: 500, yMm: 0 },
      { xMm: 1, yMm: 0 }
    );

    expect(result).toBeCloseTo(3500);
  });

  it("works for a vertical (depth) axis the same way as horizontal", () => {
    const result = computeDraggedLengthMm(
      2000,
      { xMm: 0, yMm: -300 },
      { xMm: 0, yMm: 1 }
    );

    expect(result).toBeCloseTo(1700);
  });

  it("clamps to the minimum drag length instead of going to zero or negative", () => {
    const result = computeDraggedLengthMm(
      500,
      { xMm: -10_000, yMm: 0 },
      { xMm: 1, yMm: 0 }
    );

    expect(result).toBe(MIN_DRAG_LENGTH_MM);
  });
});
