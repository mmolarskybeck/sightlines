import { describe, expect, it } from "vitest";
import { choosePdfLabelCandidate, type PdfLabelBox } from "./pdfDimensionLayout";

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
      choosePdfLabelCandidate([blocked, clear], [box(0, 0, 10, 10)]).id
    ).toBe("clear");
  });

  it("uses the least-overlapping fallback when a dense wall has no clear slot", () => {
    const crowded = { id: "crowded", box: box(2, 2, 9, 9) };
    const quieter = { id: "quieter", box: box(8, 8, 12, 12) };

    expect(
      choosePdfLabelCandidate([crowded, quieter], [box(0, 0, 10, 10)]).id
    ).toBe("quieter");
  });
});
