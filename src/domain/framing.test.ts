import { describe, expect, it } from "vitest";
import {
  FRAME_FINISHES,
  FRAME_FINISH_HEX,
  deriveFrameWidthFromOverallMm,
  getArtworkOuterDimensionsMm,
  getPlacementFootprintMm,
  withArtworkFootprint
} from "./framing";
import type { ArtworkFrame, FrameFinish, WallObject } from "./project";

describe("getArtworkOuterDimensionsMm", () => {
  it("returns the image size unchanged with no mat or frame (legacy records)", () => {
    expect(getArtworkOuterDimensionsMm(600, 400)).toEqual({ widthMm: 600, heightMm: 400 });
  });

  it("adds the mat band twice per axis", () => {
    // 50mm mat on every side → +100mm each axis.
    expect(getArtworkOuterDimensionsMm(600, 400, 50)).toEqual({
      widthMm: 700,
      heightMm: 500
    });
  });

  it("adds mat and frame bands together, each twice per axis", () => {
    const frame: ArtworkFrame = { widthMm: 30, finish: "gold" };
    // (50 + 30) * 2 = 160mm added per axis.
    expect(getArtworkOuterDimensionsMm(600, 400, 50, frame)).toEqual({
      widthMm: 760,
      heightMm: 560
    });
  });

  it("adds only the frame when there is no mat", () => {
    const frame: ArtworkFrame = { widthMm: 20, finish: "black" };
    expect(getArtworkOuterDimensionsMm(600, 400, undefined, frame)).toEqual({
      widthMm: 640,
      heightMm: 440
    });
  });

  it("treats zero or negative bands as absent", () => {
    const frame: ArtworkFrame = { widthMm: 0, finish: "white" };
    expect(getArtworkOuterDimensionsMm(600, 400, 0, frame)).toEqual({
      widthMm: 600,
      heightMm: 400
    });
  });
});

describe("placement footprint contract", () => {
  const placement: WallObject = {
    id: "placement-1",
    kind: "artwork",
    artworkId: "artwork-1",
    wallId: "wall-1",
    groupId: "group-1",
    xMm: 900,
    yMm: 1200,
    widthMm: 400,
    heightMm: 300,
    rotationDeg: 5,
    displayDimensionsOverride: {
      widthMm: 999,
      heightMm: 888,
      status: "known"
    }
  };

  const artwork = {
    matWidthMm: 75,
    frame: { widthMm: 25, finish: "black" as const }
  };

  it("expands stored placement dimensions without resolving the display override", () => {
    expect(getPlacementFootprintMm(placement, artwork)).toEqual({
      widthMm: 600,
      heightMm: 500
    });
  });

  it("adapts artwork size while preserving placement identity and position fields", () => {
    expect(withArtworkFootprint(placement, artwork)).toEqual({
      ...placement,
      widthMm: 600,
      heightMm: 500
    });
  });

  it("passes openings through unchanged", () => {
    const opening: WallObject = {
      id: "door-1",
      kind: "door",
      wallId: "wall-1",
      xMm: 500,
      yMm: 1000,
      widthMm: 900,
      heightMm: 2100,
      blocksPlacement: true
    };

    expect(withArtworkFootprint(opening, artwork)).toBe(opening);
  });

  it("passes dangling artwork placements through unchanged", () => {
    expect(withArtworkFootprint(placement)).toBe(placement);
  });

  it("preserves identity for an unframed artwork placement", () => {
    const unframed = { ...placement, displayDimensionsOverride: undefined };
    expect(withArtworkFootprint(unframed, {})).toBe(unframed);
  });
});

describe("deriveFrameWidthFromOverallMm", () => {
  it("solves for the frame band from an overall dimension", () => {
    // image 600, mat 50: overall 760 → frame (760 − 600 − 100) / 2 = 30.
    expect(deriveFrameWidthFromOverallMm(760, 600, 50)).toEqual({
      ok: true,
      frameWidthMm: 30
    });
  });

  it("solves with no mat", () => {
    expect(deriveFrameWidthFromOverallMm(640, 600)).toEqual({
      ok: true,
      frameWidthMm: 20
    });
  });

  it("inverts getArtworkOuterDimensionsMm on both axes", () => {
    const frame: ArtworkFrame = { widthMm: 22.5, finish: "wood" };
    const outer = getArtworkOuterDimensionsMm(600, 400, 76.2, frame);

    // toBeCloseTo, not exact equality — the non-integer mat band leaves float
    // dust well inside any display precision.
    const fromWidth = deriveFrameWidthFromOverallMm(outer.widthMm, 600, 76.2);
    const fromHeight = deriveFrameWidthFromOverallMm(outer.heightMm, 400, 76.2);
    expect(fromWidth.ok).toBe(true);
    expect(fromHeight.ok).toBe(true);
    if (fromWidth.ok && fromHeight.ok) {
      expect(fromWidth.frameWidthMm).toBeCloseTo(22.5, 6);
      expect(fromHeight.frameWidthMm).toBeCloseTo(22.5, 6);
    }
  });

  it("clears the frame when the overall exactly equals image + 2·mat", () => {
    expect(deriveFrameWidthFromOverallMm(700, 600, 50)).toEqual({
      ok: true,
      frameWidthMm: undefined
    });
  });

  it("treats float dust around zero as an exact match, not an error", () => {
    expect(deriveFrameWidthFromOverallMm(700.0000005, 600, 50)).toEqual({
      ok: true,
      frameWidthMm: undefined
    });
    expect(deriveFrameWidthFromOverallMm(699.9999995, 600, 50)).toEqual({
      ok: true,
      frameWidthMm: undefined
    });
  });

  it("rejects an overall smaller than image + 2·mat with the minimum legal value", () => {
    expect(deriveFrameWidthFromOverallMm(650, 600, 50)).toEqual({
      ok: false,
      minOverallMm: 700
    });
  });

  it("rejects an overall smaller than the bare image when there is no mat", () => {
    expect(deriveFrameWidthFromOverallMm(500, 600)).toEqual({
      ok: false,
      minOverallMm: 600
    });
  });
});

describe("frame finishes", () => {
  it("has a hex value for every finish the dropdown offers", () => {
    for (const option of FRAME_FINISHES) {
      expect(FRAME_FINISH_HEX[option.value]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("covers every FrameFinish in the type", () => {
    const finishes: FrameFinish[] = ["gold", "white", "black", "silver", "wood"];
    const offered = FRAME_FINISHES.map((option) => option.value);
    expect(new Set(offered)).toEqual(new Set(finishes));
  });
});
