import { describe, expect, it } from "vitest";
import { CURRENT_ARTWORK_SCHEMA_VERSION, DEFAULT_FLOOR_OBJECT_DEPTH_MM, type Artwork, type Dimensions } from "../project";
import { getArtworkOuterDimensionsMm } from "../framing";
import { effectiveFloorDepthMm, effectivePlacementForm } from "./artworkForm";

function makeArtwork(dimensions: Dimensions, placementForm?: "wall" | "floor"): Artwork {
  return {
    id: "artwork-1",
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    dimensions,
    ...(placementForm ? { placementForm } : {}),
    metadata: {}
  };
}

describe("effectivePlacementForm — inference", () => {
  it("infers 'floor' when depth is a positive number", () => {
    const artwork = makeArtwork({ widthMm: 500, depthMm: 300, status: "known" });
    expect(effectivePlacementForm(artwork)).toBe("floor");
  });

  it("infers 'wall' when depth is absent", () => {
    const artwork = makeArtwork({ widthMm: 500, heightMm: 700, status: "known" });
    expect(effectivePlacementForm(artwork)).toBe("wall");
  });

  it("infers 'wall' when depth is zero (not a positive number)", () => {
    const artwork = makeArtwork({ widthMm: 500, depthMm: 0, status: "known" });
    expect(effectivePlacementForm(artwork)).toBe("wall");
  });
});

describe("effectivePlacementForm — override precedence", () => {
  it("a 'wall' override wins over a positive depth (never flips)", () => {
    const artwork = makeArtwork({ widthMm: 500, depthMm: 300, status: "known" }, "wall");
    expect(effectivePlacementForm(artwork)).toBe("wall");
  });

  it("a 'floor' override wins even with no depth", () => {
    const artwork = makeArtwork({ widthMm: 500, heightMm: 700, status: "known" }, "floor");
    expect(effectivePlacementForm(artwork)).toBe("floor");
  });
});

describe("effectiveFloorDepthMm — depth fallback", () => {
  it("uses the real depth when known", () => {
    expect(effectiveFloorDepthMm({ widthMm: 500, depthMm: 300, status: "known" })).toBe(300);
  });

  it("falls back to the width for a squarish footprint when depth is absent", () => {
    expect(effectiveFloorDepthMm({ widthMm: 500, status: "known" })).toBe(500);
  });

  it("falls back to the width when depth is zero", () => {
    expect(effectiveFloorDepthMm({ widthMm: 500, depthMm: 0, status: "known" })).toBe(500);
  });

  it("falls back to the default when neither depth nor width is known", () => {
    expect(effectiveFloorDepthMm({ status: "unknown" })).toBe(DEFAULT_FLOOR_OBJECT_DEPTH_MM);
  });
});

describe("floor form is framing-agnostic (Phase 6b)", () => {
  // A framed work forced onto the floor: mat 75 + frame 25 make the outer width
  // 600 against an image width of 400. Floor geometry must stay image-sized.
  const framedFloorWork: Artwork = {
    ...makeArtwork({ widthMm: 400, heightMm: 300, status: "known" }, "floor"),
    matWidthMm: 75,
    frame: { widthMm: 25, finish: "black" }
  };

  it("derives its plan depth from the image width, never the framed outer width", () => {
    expect(effectivePlacementForm(framedFloorWork)).toBe("floor");
    // The trap: the width fallback would otherwise hand the depth axis a frame
    // band it has no physical relationship to.
    expect(
      getArtworkOuterDimensionsMm(400, 300, framedFloorWork.matWidthMm, framedFloorWork.frame)
        .widthMm
    ).toBe(600);
    expect(effectiveFloorDepthMm(framedFloorWork.dimensions)).toBe(400);
  });

  it("still reads as a wall work — and so is framing-widened — without the floor form", () => {
    const wallWork: Artwork = {
      ...framedFloorWork,
      placementForm: undefined,
      dimensions: { widthMm: 400, heightMm: 300, status: "known" }
    };
    expect(effectivePlacementForm(wallWork)).toBe("wall");
  });
});
