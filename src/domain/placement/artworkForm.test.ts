import { describe, expect, it } from "vitest";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type ArtworkWallObject,
  type CaseWallObject,
  type Dimensions,
  type DoorWallObject,
  type ShelfWallObject
} from "../project";
import { WALL_OBJECT_PLAN_DEPTH_MM } from "../geometry/planObjects";
import { getArtworkOuterDimensionsMm } from "../framing";
import {
  effectiveDisplayAs,
  effectiveFloorDepthMm,
  effectivePlacementForm,
  effectiveWallArtworkDepthMm,
  effectiveWallObjectPlanDepthMm
} from "./artworkForm";

function makeArtwork(dimensions: Dimensions, placementForm?: "wall" | "floor"): Artwork {
  return {
    id: "artwork-1",
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    dimensions,
    ...(placementForm ? { placementForm } : {}),
    metadata: {}
  };
}

// Medium is virtual — it lives at metadata.medium, the slot the importer writes.
function withMedium(artwork: Artwork, medium: string): Artwork {
  return { ...artwork, metadata: { ...artwork.metadata, medium } };
}

const FLAT: Dimensions = { widthMm: 600, heightMm: 800, status: "known" };
const DEEP: Dimensions = { widthMm: 600, heightMm: 800, depthMm: 450, status: "known" };

describe("effectiveDisplayAs — resolution ladder", () => {
  it("lets an explicit choice win over everything", () => {
    const stated = { ...withMedium(makeArtwork(FLAT), "Sculpture"), displayAs: "framed" as const };
    expect(effectiveDisplayAs(stated)).toBe("framed");
  });

  it("GUARD: a stored mat or frame reads as framed, whatever the medium says", () => {
    // The protection for existing real projects: a work someone matted and
    // framed must not silently restage itself because its medium string
    // happens to name a category.
    const matted = { ...withMedium(makeArtwork(FLAT), "Sculpture"), matWidthMm: 75 };
    expect(effectiveDisplayAs(matted)).toBe("framed");

    const framed = {
      ...withMedium(makeArtwork(FLAT), "Film/video"),
      frame: { widthMm: 25, finish: "black" as const }
    };
    expect(effectiveDisplayAs(framed)).toBe("framed");
  });

  it("derives from the medium when nothing is stated and nothing is framed", () => {
    expect(effectiveDisplayAs(withMedium(makeArtwork(FLAT), "Photograph"))).toBe("framed");
    expect(effectiveDisplayAs(withMedium(makeArtwork(FLAT), "Film/video"))).toBe("projection");
    expect(effectiveDisplayAs(withMedium(makeArtwork(FLAT), "Sculpture"))).toBe("sculpture");
    expect(effectiveDisplayAs(withMedium(makeArtwork(FLAT), "Installation"))).toBe("sculpture");
  });

  it("falls back to framed for prose and for an unrecorded medium", () => {
    expect(effectiveDisplayAs(withMedium(makeArtwork(FLAT), "Oil on canvas"))).toBe("framed");
    expect(effectiveDisplayAs(makeArtwork(FLAT))).toBe("framed");
  });
});

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

describe("effectivePlacementForm — display type", () => {
  const monitor = (dimensions: Dimensions, placementForm?: "wall" | "floor"): Artwork => ({
    ...makeArtwork(dimensions, placementForm),
    displayAs: "monitor"
  });

  it("stands a box monitor on the floor even with no recorded depth", () => {
    expect(
      effectivePlacementForm(monitor({ widthMm: 500, heightMm: 375, status: "known" }))
    ).toBe("floor");
  });

  it("an explicit 'wall' override still beats the monitor display type", () => {
    expect(
      effectivePlacementForm(monitor({ widthMm: 500, status: "known" }, "wall"))
    ).toBe("wall");
  });

  it("leaves a framed image on the depth heuristic (absent displayAs)", () => {
    expect(
      effectivePlacementForm(makeArtwork({ widthMm: 500, status: "known" }))
    ).toBe("wall");
  });

  it("stands a sculpture on the floor, and throws a projection at a wall", () => {
    const sculpture = { ...makeArtwork(FLAT), displayAs: "sculpture" as const };
    expect(effectivePlacementForm(sculpture)).toBe("floor");

    const projection = { ...makeArtwork(DEEP), displayAs: "projection" as const };
    expect(effectivePlacementForm(projection)).toBe("wall");
  });

  it("lets an EXPLICIT 'framed' pin a deep work to the wall", () => {
    // "Wall work" chosen in the dropdown is an answer, not a guess: a deep
    // stretcher or shadow box stays hung.
    const pinned = { ...makeArtwork(DEEP), displayAs: "framed" as const };
    expect(effectivePlacementForm(pinned)).toBe("wall");
  });

  it("PRESERVES the depth heuristic for a merely-DERIVED 'framed'", () => {
    // The whole compatibility guarantee: nothing in a project that predates
    // display types moves. A deep painting with no stored displayAs still
    // stands up, exactly as it always did — a derived "framed" must not reach
    // the explicit-pin rule above.
    expect(effectivePlacementForm(withMedium(makeArtwork(DEEP), "Painting"))).toBe("floor");
    expect(effectivePlacementForm(makeArtwork(DEEP))).toBe("floor");
    // ...and a matted deep work, whose "framed" comes from the mat guard.
    expect(
      effectivePlacementForm({ ...makeArtwork(DEEP), matWidthMm: 75 })
    ).toBe("floor");
  });

  it("follows a medium-derived display type with no displayAs stored at all", () => {
    expect(effectivePlacementForm(withMedium(makeArtwork(FLAT), "Film/video"))).toBe("wall");
    expect(effectivePlacementForm(withMedium(makeArtwork(FLAT), "Sculpture"))).toBe("floor");
    // ...and a flat photograph is still a wall work, as before.
    expect(effectivePlacementForm(withMedium(makeArtwork(FLAT), "Photograph"))).toBe("wall");
  });

  it("keeps the Type row's explicit override above every display type", () => {
    expect(
      effectivePlacementForm({
        ...withMedium(makeArtwork(FLAT, "wall"), "Sculpture")
      })
    ).toBe("wall");
    expect(
      effectivePlacementForm({ ...makeArtwork(FLAT, "floor"), displayAs: "projection" })
    ).toBe("floor");
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

function wallArtwork(overrides: Partial<ArtworkWallObject> = {}): ArtworkWallObject {
  return {
    id: "wo-art",
    kind: "artwork",
    artworkId: "artwork-1",
    wallId: "wall-1",
    xMm: 1000,
    yMm: 1450,
    widthMm: 600,
    heightMm: 800,
    ...overrides
  };
}

describe("effectiveWallArtworkDepthMm — deep wall artwork", () => {
  it("uses the artwork record's depth for a hung work", () => {
    const artwork = makeArtwork({ widthMm: 600, heightMm: 800, depthMm: 120, status: "known" }, "wall");
    expect(effectiveWallArtworkDepthMm(wallArtwork(), artwork)).toBe(120);
  });

  it("is undefined when the record records no depth (flat — today's behavior)", () => {
    const artwork = makeArtwork({ widthMm: 600, heightMm: 800, status: "known" });
    expect(effectiveWallArtworkDepthMm(wallArtwork(), artwork)).toBeUndefined();
  });

  it("treats zero and negative depth as flat, never as a zero-thickness body", () => {
    expect(
      effectiveWallArtworkDepthMm(wallArtwork(), makeArtwork({ widthMm: 600, depthMm: 0, status: "known" }))
    ).toBeUndefined();
    expect(
      effectiveWallArtworkDepthMm(wallArtwork(), makeArtwork({ widthMm: 600, depthMm: -50, status: "known" }))
    ).toBeUndefined();
  });

  it("is undefined when the artwork record is missing entirely", () => {
    expect(effectiveWallArtworkDepthMm(wallArtwork(), undefined)).toBeUndefined();
  });

  it("lets the placement's displayDimensionsOverride win over the record", () => {
    const artwork = makeArtwork({ widthMm: 600, heightMm: 800, depthMm: 120, status: "known" });
    const placement = wallArtwork({
      displayDimensionsOverride: { widthMm: 600, heightMm: 800, depthMm: 300, status: "known" }
    });
    expect(effectiveWallArtworkDepthMm(placement, artwork)).toBe(300);
  });

  it("falls through to the record when the override carries no depth", () => {
    const artwork = makeArtwork({ widthMm: 600, heightMm: 800, depthMm: 120, status: "known" });
    const placement = wallArtwork({
      displayDimensionsOverride: { widthMm: 600, heightMm: 800, status: "known" }
    });
    expect(effectiveWallArtworkDepthMm(placement, artwork)).toBe(120);
  });

  it("never falls back to the floor default (a depth-less hung work is flat, not 400mm proud)", () => {
    expect(effectiveWallArtworkDepthMm(wallArtwork(), undefined)).not.toBe(
      DEFAULT_FLOOR_OBJECT_DEPTH_MM
    );
  });
});

describe("effectiveWallObjectPlanDepthMm — one plan depth for every wall object", () => {
  const wallCase: CaseWallObject = {
    id: "wo-case",
    kind: "case",
    wallId: "wall-1",
    xMm: 2000,
    yMm: 950,
    widthMm: 1500,
    heightMm: 180,
    depthMm: 450
  };
  const door: DoorWallObject = {
    id: "wo-door",
    kind: "door",
    blocksPlacement: true,
    wallId: "wall-1",
    xMm: 1000,
    yMm: 1050,
    widthMm: 900,
    heightMm: 2100
  };

  it("gives a case its real protrusion", () => {
    expect(effectiveWallObjectPlanDepthMm(wallCase, undefined)).toBe(450);
  });

  it("gives a shelf its real protrusion — the same branch as a case", () => {
    const shelf: ShelfWallObject = {
      id: "wo-shelf",
      kind: "shelf",
      wallId: "wall-1",
      xMm: 2000,
      yMm: 1180,
      widthMm: 1200,
      heightMm: 40,
      depthMm: 300
    };
    expect(effectiveWallObjectPlanDepthMm(shelf, undefined)).toBe(300);
  });

  it("gives a deep work its real protrusion", () => {
    const artwork = makeArtwork({ widthMm: 600, heightMm: 800, depthMm: 120, status: "known" });
    expect(effectiveWallObjectPlanDepthMm(wallArtwork(), artwork)).toBe(120);
  });

  it("gives a flat work the nominal band (bit-for-bit today's behavior)", () => {
    const artwork = makeArtwork({ widthMm: 600, heightMm: 800, status: "known" });
    expect(effectiveWallObjectPlanDepthMm(wallArtwork(), artwork)).toBe(WALL_OBJECT_PLAN_DEPTH_MM);
    expect(effectiveWallObjectPlanDepthMm(wallArtwork(), undefined)).toBe(
      WALL_OBJECT_PLAN_DEPTH_MM
    );
  });

  it("gives openings the nominal band and ignores any artwork handed in", () => {
    const artwork = makeArtwork({ widthMm: 600, heightMm: 800, depthMm: 120, status: "known" });
    expect(effectiveWallObjectPlanDepthMm(door, artwork)).toBe(WALL_OBJECT_PLAN_DEPTH_MM);
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
