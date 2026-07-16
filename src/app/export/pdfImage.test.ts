import { describe, expect, it } from "vitest";
import { prepareImageForPdf } from "./pdfImage";

describe("prepareImageForPdf", () => {
  it("passes PNG bytes through without browser transcoding", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const result = await prepareImageForPdf(
      new Blob([bytes], { type: "image/png" })
    );

    expect(result.format).toBe("png");
    expect([...result.bytes]).toEqual([...bytes]);
  });

  it("passes JPEG bytes through without browser transcoding", async () => {
    const bytes = new Uint8Array([255, 216, 255, 217]);
    const result = await prepareImageForPdf(
      new Blob([bytes], { type: "image/jpeg" })
    );

    expect(result.format).toBe("jpeg");
    expect([...result.bytes]).toEqual([...bytes]);
  });
});
