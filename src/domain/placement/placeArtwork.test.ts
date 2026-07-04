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

  it("fills only the missing axis, keeping the known one", () => {
    const result = getEffectivePlacementSizeMm({ widthMm: 900, status: "known" });

    expect(result).toEqual({
      widthMm: 900,
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

  it("does not clamp out-of-bounds coordinates — invalid placement is flagged elsewhere, not fixed here", () => {
    const artwork = makeArtwork({
      dimensions: { widthMm: 500, heightMm: 400, status: "known" }
    });

    const placement = createArtworkPlacement(artwork, "wall-1", -10_000, 50_000);

    expect(placement.xMm).toBe(-10_000);
    expect(placement.yMm).toBe(50_000);
  });
});
