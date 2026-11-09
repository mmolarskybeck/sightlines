import { describe, expect, it } from "vitest";
import type { FloorObject, SupportFloorObject } from "../../../domain/project";
import { resolveFloorArtworkDragSeat, translateSupportRiders } from "./supportDrag";

function makeSupport(overrides: Partial<SupportFloorObject> = {}): SupportFloorObject {
  return {
    id: "support-1",
    kind: "support",
    supportKind: "pedestal",
    xMm: 1000,
    yMm: 1000,
    widthMm: 400,
    depthMm: 400,
    heightMm: 900,
    rotationDeg: 0,
    wallYMm: 0,
    ...overrides
  };
}

describe("translateSupportRiders", () => {
  it("carries every rider by the support's own delta, keeping their offsets", () => {
    const riders = [
      { id: "rider-1", offsetMm: { xMm: 100, yMm: -50 } },
      { id: "rider-2", offsetMm: { xMm: -100, yMm: 50 } }
    ];

    const moves = translateSupportRiders(1200, 800, riders);

    expect(moves).toEqual([
      { id: "rider-1", xMm: 1300, yMm: 750 },
      { id: "rider-2", xMm: 1100, yMm: 850 }
    ]);
  });

  it("returns an empty array for a support with no riders", () => {
    expect(translateSupportRiders(1200, 800, [])).toEqual([]);
  });
});

describe("resolveFloorArtworkDragSeat", () => {
  it("reports the widest-overlapping support as the seat candidate", () => {
    const support = makeSupport();
    const floorObjects: FloorObject[] = [support];

    const result = resolveFloorArtworkDragSeat({
      objectId: "work-1",
      xMm: 1000,
      yMm: 1000,
      widthMm: 300,
      depthMm: 300,
      rotationDeg: 0,
      floorObjects,
      bypassSeating: false
    });

    expect(result.supportId).toBe("support-1");
    expect(result.baseHeightMm).toBe(900);
    // No starting support, so no clamp — the raw candidate position passes
    // through untouched.
    expect(result).toMatchObject({ xMm: 1000, yMm: 1000 });
  });

  it("reports no seat when the footprint overlaps nothing", () => {
    const floorObjects: FloorObject[] = [makeSupport({ xMm: 5000, yMm: 5000 })];

    const result = resolveFloorArtworkDragSeat({
      objectId: "work-1",
      xMm: 1000,
      yMm: 1000,
      widthMm: 300,
      depthMm: 300,
      rotationDeg: 0,
      floorObjects,
      bypassSeating: false
    });

    expect(result.supportId).toBeUndefined();
    expect(result.baseHeightMm).toBeUndefined();
  });

  it("clamps onto the starting support when the work is dragged past its edge", () => {
    const support = makeSupport({ overhangAllowed: false });
    const floorObjects: FloorObject[] = [support];

    // Dragged far past the support's right edge (200mm half-width).
    const result = resolveFloorArtworkDragSeat({
      objectId: "work-1",
      xMm: 5000,
      yMm: 1000,
      widthMm: 100,
      depthMm: 100,
      rotationDeg: 0,
      startingSupportId: "support-1",
      floorObjects,
      bypassSeating: false
    });

    // Clamped back onto the top face, so it is still reported as seated on
    // its own support rather than dropped onto the floor.
    expect(result.xMm).toBeLessThan(5000);
    expect(result.supportId).toBe("support-1");
    expect(result.baseHeightMm).toBe(900);
  });

  it("does not clamp or seat while the precision bypass is held", () => {
    const support = makeSupport({ overhangAllowed: false });
    const floorObjects: FloorObject[] = [support];

    const result = resolveFloorArtworkDragSeat({
      objectId: "work-1",
      xMm: 5000,
      yMm: 1000,
      widthMm: 100,
      depthMm: 100,
      rotationDeg: 0,
      startingSupportId: "support-1",
      floorObjects,
      bypassSeating: true
    });

    expect(result).toEqual({ xMm: 5000, yMm: 1000 });
  });

  it("ignores a startingSupportId that no longer resolves to a support", () => {
    const floorObjects: FloorObject[] = [];

    const result = resolveFloorArtworkDragSeat({
      objectId: "work-1",
      xMm: 1000,
      yMm: 1000,
      widthMm: 100,
      depthMm: 100,
      rotationDeg: 0,
      startingSupportId: "gone",
      floorObjects,
      bypassSeating: false
    });

    expect(result).toEqual({ xMm: 1000, yMm: 1000, supportId: undefined, baseHeightMm: undefined });
  });
});
