import { describe, expect, it } from "vitest";
import type { WallObject, WallObjectBase } from "../project";
import { feetToMm } from "../units/length";
import { doWallObjectsOverlap } from "./collision";
import { fitOpeningOnWall, getOpeningLegalSpan } from "./fitOpeningOnWall";

const WALL_12FT = feetToMm(12);

function fitOnWholeWall(requestedWidthMm: number, currentXMm: number, wallLengthMm = WALL_12FT) {
  return fitOpeningOnWall({
    requestedWidthMm,
    currentXMm,
    spanStartMm: 0,
    spanEndMm: wallLengthMm,
    constraintSource: "wall"
  });
}

function opening(
  over: Partial<WallObjectBase> & { id: string; kind?: "door" | "window" }
): WallObject {
  return {
    kind: "door",
    blocksPlacement: true,
    wallId: "wall-1",
    xMm: feetToMm(3),
    yMm: feetToMm(3.5),
    widthMm: feetToMm(3),
    heightMm: feetToMm(7),
    ...over
  } as WallObject;
}

describe("fitOpeningOnWall", () => {
  // The three stated cases, on a 12' wall with the door at 3'.
  it("keeps a requested width that fits and slides the minimum distance", () => {
    const fit = fitOnWholeWall(feetToMm(11), feetToMm(3));

    expect(fit.widthMm).toBe(feetToMm(11));
    expect(fit.widthClamped).toBe(false);
    // Legal range is [5'6", 6'6"]; the nearest point to 3' is 5'6".
    expect(fit.xMm).toBeCloseTo(feetToMm(5.5), 6);
    expect(fit.positionAdjusted).toBe(true);
    expect(fit.movedByMm).toBeCloseTo(feetToMm(2.5), 6);
  });

  it("does not centre when sliding — minimum movement, not a tidy result", () => {
    const fit = fitOnWholeWall(feetToMm(11), feetToMm(3));
    // Centring would give 6'. That would be a larger move than necessary.
    expect(fit.xMm).not.toBeCloseTo(feetToMm(6), 3);
  });

  it("reduces the width only when it cannot fit at all", () => {
    const fit = fitOnWholeWall(feetToMm(14), feetToMm(3));

    expect(fit.widthMm).toBe(WALL_12FT);
    expect(fit.widthClamped).toBe(true);
    // A full-span opening has exactly one legal centre.
    expect(fit.xMm).toBeCloseTo(feetToMm(6), 6);
    expect(fit.requestedWidthMm).toBe(feetToMm(14));
  });

  it("leaves position alone when the new width already fits where it is", () => {
    const fit = fitOnWholeWall(feetToMm(4), feetToMm(6));

    expect(fit.widthMm).toBe(feetToMm(4));
    expect(fit.xMm).toBe(feetToMm(6));
    expect(fit.positionAdjusted).toBe(false);
    expect(fit.movedByMm).toBe(0);
    expect(fit.constraint).toBe("none");
  });

  it("treats a width exactly equal to the wall length as valid, not an overflow", () => {
    const fit = fitOnWholeWall(WALL_12FT, feetToMm(6));

    expect(fit.widthClamped).toBe(false);
    expect(fit.widthMm).toBe(WALL_12FT);
    expect(fit.xMm).toBeCloseTo(feetToMm(6), 6);
  });

  it("absorbs float noise at the exact-fit boundary rather than clamping", () => {
    // The kind of value a unit round-trip produces for "12 ft".
    const fit = fitOnWholeWall(WALL_12FT + 0.0000001, feetToMm(6));
    expect(fit.widthClamped).toBe(false);
  });

  it("reports width clamping and repositioning independently", () => {
    // Too wide for the span AND parked hard against the left end.
    const fit = fitOpeningOnWall({
      requestedWidthMm: feetToMm(9),
      currentXMm: feetToMm(1),
      spanStartMm: feetToMm(4),
      spanEndMm: feetToMm(10),
      constraintSource: "neighbor"
    });

    expect(fit.widthClamped).toBe(true);
    expect(fit.widthMm).toBeCloseTo(feetToMm(6), 6);
    expect(fit.positionAdjusted).toBe(true);
    expect(fit.xMm).toBeCloseTo(feetToMm(7), 6);
    expect(fit.constraint).toBe("neighbor");
  });

  it("never returns geometry outside the span", () => {
    for (const requestedFt of [0.5, 3, 11, 12, 14, 40]) {
      for (const currentFt of [-5, 0, 3, 6, 12, 30]) {
        const fit = fitOnWholeWall(feetToMm(requestedFt), feetToMm(currentFt));
        expect(fit.xMm - fit.widthMm / 2).toBeGreaterThanOrEqual(-0.5);
        expect(fit.xMm + fit.widthMm / 2).toBeLessThanOrEqual(WALL_12FT + 0.5);
      }
    }
  });
});

describe("getOpeningLegalSpan", () => {
  it("uses the whole wall when nothing else is on it", () => {
    const door = opening({ id: "d1" });
    const span = getOpeningLegalSpan(door, [door], WALL_12FT);

    expect(span.spanStartMm).toBe(0);
    expect(span.spanEndMm).toBe(WALL_12FT);
    expect(span.boundedByNeighbor).toBe(false);
  });

  it("stops at a y-overlapping neighbour's edge", () => {
    const door = opening({ id: "d1", xMm: feetToMm(2), widthMm: feetToMm(3) });
    // A second door from 8' to 10'.
    const neighbor = opening({ id: "d2", xMm: feetToMm(9), widthMm: feetToMm(2) });

    const span = getOpeningLegalSpan(door, [door, neighbor], WALL_12FT);

    expect(span.spanStartMm).toBe(0);
    expect(span.spanEndMm).toBeCloseTo(feetToMm(8), 6);
    expect(span.boundedByNeighbor).toBe(true);
  });

  it("ignores artwork, whose overlap is overridable rather than forbidden", () => {
    const door = opening({ id: "d1", xMm: feetToMm(2), widthMm: feetToMm(3) });
    const art = {
      id: "a1",
      kind: "artwork",
      artworkId: "art-1",
      wallId: "wall-1",
      xMm: feetToMm(9),
      yMm: feetToMm(4),
      widthMm: feetToMm(2),
      heightMm: feetToMm(2)
    } as unknown as WallObject;

    const span = getOpeningLegalSpan(door, [door, art], WALL_12FT);
    expect(span.spanEndMm).toBe(WALL_12FT);
  });

  it("ignores a neighbour that does not overlap vertically", () => {
    const door = opening({ id: "d1", xMm: feetToMm(2), widthMm: feetToMm(3) });
    // A high window well above the door's band.
    const window = opening({
      id: "w1",
      kind: "window",
      xMm: feetToMm(9),
      widthMm: feetToMm(2),
      yMm: feetToMm(9),
      heightMm: feetToMm(2)
    });

    const span = getOpeningLegalSpan(door, [door, window], WALL_12FT);
    expect(span.spanEndMm).toBe(WALL_12FT);
  });

  // The two subsystems must agree about contact, or fitting flush against a
  // neighbour would immediately register as a forbidden overlap.
  it("produces a flush fit that collision detection does not call an overlap", () => {
    const door = opening({ id: "d1", xMm: feetToMm(2), widthMm: feetToMm(3) });
    const neighbor = opening({ id: "d2", xMm: feetToMm(9), widthMm: feetToMm(2) });

    const span = getOpeningLegalSpan(door, [door, neighbor], WALL_12FT);
    const fit = fitOpeningOnWall({
      requestedWidthMm: feetToMm(20), // force a full-span, flush result
      currentXMm: door.xMm,
      spanStartMm: span.spanStartMm,
      spanEndMm: span.spanEndMm,
      constraintSource: "neighbor"
    });

    const fitted = { ...door, widthMm: fit.widthMm, xMm: fit.xMm };
    expect(fitted.xMm + fitted.widthMm / 2).toBeCloseTo(feetToMm(8), 6);
    expect(doWallObjectsOverlap(fitted, neighbor)).toBe(false);
  });
});
