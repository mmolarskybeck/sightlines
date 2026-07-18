import { describe, expect, it } from "vitest";
import {
  choosePdfLabelCandidate,
  findPdfLeaderRoute,
  type PdfLabelBox
} from "./pdfDimensionLayout";

const box = (
  left: number,
  bottom: number,
  right: number,
  top: number
): PdfLabelBox => ({ left, bottom, right, top });

describe("choosePdfLabelCandidate", () => {
  it("prefers the first candidate clear of artwork and prior labels", () => {
    const blocked = { id: "blocked", box: box(2, 2, 8, 8) };
    const clear = { id: "clear", box: box(20, 20, 26, 26) };

    expect(
      choosePdfLabelCandidate([blocked, clear], [box(0, 0, 10, 10)])!.id
    ).toBe("clear");
  });

  it("uses the least-overlapping fallback when a dense wall has no clear slot", () => {
    const crowded = { id: "crowded", box: box(2, 2, 9, 9) };
    const quieter = { id: "quieter", box: box(8, 8, 12, 12) };

    expect(
      choosePdfLabelCandidate([crowded, quieter], [box(0, 0, 10, 10)])!.id
    ).toBe("quieter");
  });

  it("keeps artwork hard even when a prior label has a clearer slot", () => {
    const overArtwork = { id: "over-artwork", box: box(2, 2, 8, 8) };
    const overLabel = { id: "over-label", box: box(20, 20, 26, 26) };
    const artwork = box(0, 0, 10, 10);

    expect(
      choosePdfLabelCandidate(
        [overArtwork, overLabel],
        [artwork, overLabel.box],
        [artwork]
      )!.id
    ).toBe("over-label");
  });

  it("does not fall back to artwork when every supplied candidate is blocked", () => {
    const artwork = box(0, 0, 10, 10);

    expect(
      choosePdfLabelCandidate(
        [{ id: "over-artwork", box: box(2, 2, 8, 8) }],
        [artwork],
        [artwork]
      )
    ).toBeNull();
  });

  it("returns null when a caller has no routable candidates to place", () => {
    expect(choosePdfLabelCandidate([], [])).toBeNull();
  });
});

describe("findPdfLeaderRoute", () => {
  it("uses an elbow when a direct leader crosses artwork", () => {
    const route = findPdfLeaderRoute(
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      [box(8, 8, 12, 12)]
    );

    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 }
    ]);
  });

  it("routes through a real gap even when padded label halos cover its start", () => {
    const actualArtwork = box(10, 10, 20, 20);
    const paddedLabelHalo = box(7, 7, 23, 23);
    const from = { x: 8, y: 9 };
    const to = { x: 30, y: 9 };

    expect(findPdfLeaderRoute(from, to, [paddedLabelHalo])).toBeNull();
    expect(findPdfLeaderRoute(from, to, [actualArtwork])).toEqual([from, to]);
  });
});
