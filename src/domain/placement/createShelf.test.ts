import { describe, expect, it } from "vitest";
import { createShelf } from "./createShelf";
import { shelfTopYMm } from "../geometry/shelfGlyphs";
import {
  DEFAULT_SHELF_DEPTH_MM,
  DEFAULT_SHELF_THICKNESS_MM,
  DEFAULT_SHELF_TOP_MM,
  DEFAULT_SHELF_WIDTH_MM
} from "../project";

describe("createShelf", () => {
  it("applies the curatorial defaults and anchors the slab by its TOP", () => {
    const shelf = createShelf({ wallId: "wall-north", xMm: 1500 });

    expect(shelf.kind).toBe("shelf");
    expect(shelf.wallId).toBe("wall-north");
    expect(shelf.xMm).toBe(1500);
    expect(shelf.widthMm).toBe(DEFAULT_SHELF_WIDTH_MM);
    expect(shelf.heightMm).toBe(DEFAULT_SHELF_THICKNESS_MM);
    expect(shelf.depthMm).toBe(DEFAULT_SHELF_DEPTH_MM);
    // yMm is the CENTRE; the default top is what a curator means by 1200.
    expect(shelf.yMm).toBe(DEFAULT_SHELF_TOP_MM - DEFAULT_SHELF_THICKNESS_MM / 2);
    expect(shelfTopYMm(shelf)).toBe(DEFAULT_SHELF_TOP_MM);
    expect(shelf.id).toBeTruthy();
  });

  it("honours every override and still resolves the centre from the top", () => {
    const shelf = createShelf({
      wallId: "wall-east",
      xMm: 800,
      topMm: 950,
      widthMm: 2400,
      depthMm: 200,
      thicknessMm: 60
    });

    expect(shelf).toMatchObject({
      wallId: "wall-east",
      xMm: 800,
      widthMm: 2400,
      heightMm: 60,
      depthMm: 200,
      yMm: 920
    });
    expect(shelfTopYMm(shelf)).toBe(950);
  });

  it("does not clamp an out-of-bounds placement", () => {
    // Same discipline as createOpening/createCase: validatePlacement flags a
    // shelf hanging off the end of a wall; the constructor never silently
    // fixes it.
    const shelf = createShelf({ wallId: "wall-north", xMm: -500, topMm: -40 });
    expect(shelf.xMm).toBe(-500);
    expect(shelfTopYMm(shelf)).toBe(-40);
  });

  it("mints a fresh id per call", () => {
    const a = createShelf({ wallId: "wall-north", xMm: 0 });
    const b = createShelf({ wallId: "wall-north", xMm: 0 });
    expect(a.id).not.toBe(b.id);
  });
});
