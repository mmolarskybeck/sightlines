import { describe, expect, it } from "vitest";
import type { Artwork } from "../project";
import {
  createArtworkPlacement,
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "./placeArtwork";

function makeArtwork(overrides: Partial<Artwork> = {}): Artwork {
  return {
    id: "artwork-1",
    schemaVersion: 1,
    title: "Study in Blue",
    dimensions: { status: "unknown" },
    metadata: {},
    ...overrides
  };
}

describe("getEffectivePlacementSizeMm", () => {
  it("uses known dimensions as-is regardless of status", () => {
    const result = getEffectivePlacementSizeMm({
      widthMm: 500,
      heightMm: 400,
      status: "approximate"
    });

    expect(result).toEqual({ widthMm: 500, heightMm: 400, usedPlaceholder: false });
  });

  it("fills both axes with the placeholder when both are missing", () => {
    const result = getEffectivePlacementSizeMm({ status: "unknown" });

    expect(result).toEqual({
      widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      usedPlaceholder: true
    });
  });

  it("fills only the missing axis with the placeholder when no ratio is available", () => {
    const result = getEffectivePlacementSizeMm({ widthMm: 900, status: "known" });

    expect(result).toEqual({
      widthMm: 900,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      usedPlaceholder: true
    });
  });

  it("ignores an unusable ratio (missing pixel dimension) and uses the placeholder", () => {
    const result = getEffectivePlacementSizeMm(
      { widthMm: 900, status: "known" },
      { widthPx: 400 }
    );

    expect(result).toEqual({
      widthMm: 900,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      usedPlaceholder: true
    });
  });

  it("keeps a curator's off-ratio pair even when a ratio is available", () => {
    const result = getEffectivePlacementSizeMm(
      { widthMm: 500, heightMm: 400, status: "known" },
      { widthPx: 100, heightPx: 400 }
    );

    expect(result).toEqual({ widthMm: 500, heightMm: 400, usedPlaceholder: false });
  });

  it("derives the missing height from a known width via the image ratio", () => {
    // ratio = 300/200 = 1.5, so height = width / ratio = 900 / 1.5 = 600.
    const result = getEffectivePlacementSizeMm(
      { widthMm: 900, status: "known" },
      { widthPx: 300, heightPx: 200 }
    );

    expect(result).toEqual({ widthMm: 900, heightMm: 600, usedPlaceholder: true });
  });

  it("derives the missing width from a known height via the image ratio", () => {
    // ratio = 300/200 = 1.5, so width = height * ratio = 400 * 1.5 = 600.
    const result = getEffectivePlacementSizeMm(
      { heightMm: 400, status: "known" },
      { widthPx: 300, heightPx: 200 }
    );

    expect(result).toEqual({ widthMm: 600, heightMm: 400, usedPlaceholder: true });
  });

  it("rounds a derived axis to 0.01 mm", () => {
    // ratio = 1000/300 ≈ 3.3333, so height = 500 / ratio = 150 exactly here;
    // pick a ratio that forces rounding: width 100, ratio 3 → 33.333...
    const result = getEffectivePlacementSizeMm(
      { widthMm: 100, status: "known" },
      { widthPx: 3, heightPx: 1 }
    );

    expect(result).toEqual({ widthMm: 100, heightMm: 33.33, usedPlaceholder: true });
  });

  it("contains a landscape image ratio inside the placeholder box (width-bound)", () => {
    // ratio 2 > 610/760, so width pins to 610 and height = 610 / 2 = 305.
    const result = getEffectivePlacementSizeMm(
      { status: "unknown" },
      { widthPx: 200, heightPx: 100 }
    );

    expect(result).toEqual({
      widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: 305,
      usedPlaceholder: true
    });
  });

  it("contains a portrait image ratio inside the placeholder box (height-bound)", () => {
    // ratio 0.5 < 610/760, so height pins to 760 and width = 760 * 0.5 = 380.
    const result = getEffectivePlacementSizeMm(
      { status: "unknown" },
      { widthPx: 100, heightPx: 200 }
    );

    expect(result).toEqual({
      widthMm: 380,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      usedPlaceholder: true
    });
  });
});

describe("createArtworkPlacement", () => {
  it("creates a center-anchored artwork wall object using the artwork's real dimensions", () => {
    const artwork = makeArtwork({
      dimensions: { widthMm: 500, heightMm: 400, status: "known" }
    });

    const placement = createArtworkPlacement(artwork, "wall-1", 1200, 1450);

    expect(placement.kind).toBe("artwork");
    expect(placement.artworkId).toBe("artwork-1");
    expect(placement.wallId).toBe("wall-1");
    expect(placement.xMm).toBe(1200);
    expect(placement.yMm).toBe(1450);
    expect(placement.widthMm).toBe(500);
    expect(placement.heightMm).toBe(400);
    expect(placement.id).toEqual(expect.any(String));
    expect(placement.id.length).toBeGreaterThan(0);
  });

  it("falls back to placeholder dimensions when the artwork's dims are unknown", () => {
    const artwork = makeArtwork({ dimensions: { status: "unknown" } });

    const placement = createArtworkPlacement(artwork, "wall-1", 0, 0);

    expect(placement.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
    expect(placement.heightMm).toBe(PLACEHOLDER_ARTWORK_HEIGHT_MM);
  });

  it("sizes an unknown-dimension placement from the linked image's aspect", () => {
    const artwork = makeArtwork({ dimensions: { status: "unknown" } });

    // ratio 2 > 610/760 → width pins to 610, height = 305.
    const placement = createArtworkPlacement(artwork, "wall-1", 0, 0, {
      widthPx: 200,
      heightPx: 100
    });

    expect(placement.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
    expect(placement.heightMm).toBe(305);
  });

  it("does not clamp out-of-bounds coordinates — invalid placement is flagged elsewhere, not fixed here", () => {
    const artwork = makeArtwork({
      dimensions: { widthMm: 500, heightMm: 400, status: "known" }
    });

    const placement = createArtworkPlacement(artwork, "wall-1", -10_000, 50_000);

    expect(placement.xMm).toBe(-10_000);
    expect(placement.yMm).toBe(50_000);
  });
});
