import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  DISPLAY_MAX_PX,
  MAX_IMAGE_FILE_BYTES,
  THUMBNAIL_MAX_PX,
  fitWithin,
  isAcceptedImageType,
  titleFromFilename,
  validateImageFile
} from "./imageIntake";

describe("isAcceptedImageType", () => {
  it("accepts jpeg, png, and webp", () => {
    for (const mimeType of ACCEPTED_IMAGE_MIME_TYPES) {
      expect(isAcceptedImageType(mimeType)).toBe(true);
    }
  });

  it("rejects other types", () => {
    expect(isAcceptedImageType("image/tiff")).toBe(false);
    expect(isAcceptedImageType("application/pdf")).toBe(false);
    expect(isAcceptedImageType("")).toBe(false);
  });
});

describe("fitWithin", () => {
  it("scales a landscape image down by its longer (width) edge", () => {
    expect(fitWithin(3600, 1800, DISPLAY_MAX_PX)).toEqual({ widthPx: 1800, heightPx: 900 });
  });

  it("scales a portrait image down by its longer (height) edge", () => {
    expect(fitWithin(1800, 3600, DISPLAY_MAX_PX)).toEqual({ widthPx: 900, heightPx: 1800 });
  });

  it("scales a square image down to a square", () => {
    expect(fitWithin(4000, 4000, THUMBNAIL_MAX_PX)).toEqual({
      widthPx: THUMBNAIL_MAX_PX,
      heightPx: THUMBNAIL_MAX_PX
    });
  });

  it("leaves an exact-fit image unchanged", () => {
    expect(fitWithin(1800, 1200, DISPLAY_MAX_PX)).toEqual({ widthPx: 1800, heightPx: 1200 });
  });

  it("never upscales an image already smaller than the cap", () => {
    expect(fitWithin(200, 100, THUMBNAIL_MAX_PX)).toEqual({ widthPx: 200, heightPx: 100 });
  });

  it("rounds fractional results to integers", () => {
    const result = fitWithin(1001, 667, 400);

    expect(Number.isInteger(result.widthPx)).toBe(true);
    expect(Number.isInteger(result.heightPx)).toBe(true);
  });

  it("never rounds an extreme aspect ratio's shorter edge down to 0", () => {
    const result = fitWithin(10000, 1, DISPLAY_MAX_PX);

    expect(result.widthPx).toBe(DISPLAY_MAX_PX);
    expect(result.heightPx).toBeGreaterThanOrEqual(1);
  });

  it("never rounds an extreme portrait aspect ratio's shorter edge down to 0", () => {
    const result = fitWithin(1, 10000, THUMBNAIL_MAX_PX);

    expect(result.heightPx).toBe(THUMBNAIL_MAX_PX);
    expect(result.widthPx).toBeGreaterThanOrEqual(1);
  });
});

describe("validateImageFile", () => {
  it("accepts a supported, reasonably sized file", () => {
    const result = validateImageFile({ name: "hopper.jpg", type: "image/jpeg", size: 1024 });

    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported type and names the file", () => {
    const result = validateImageFile({ name: "scan.tiff", type: "image/tiff", size: 1024 });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toContain("scan.tiff");
    expect(result.ok ? "" : result.reason).toContain("not a supported image type");
  });

  it("rejects a file over the size cap and states the limit", () => {
    const result = validateImageFile({
      name: "huge.png",
      type: "image/png",
      size: MAX_IMAGE_FILE_BYTES + 1
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toContain("huge.png");
    expect(result.ok ? "" : result.reason).toContain("50.0 MB");
  });

  it("accepts a file exactly at the size cap", () => {
    const result = validateImageFile({
      name: "at-cap.png",
      type: "image/png",
      size: MAX_IMAGE_FILE_BYTES
    });

    expect(result.ok).toBe(true);
  });
});

describe("titleFromFilename", () => {
  it("strips a simple extension", () => {
    expect(titleFromFilename("hopper_nighthawks-scan2.jpg")).toBe("hopper_nighthawks-scan2");
  });

  it("strips only the last extension when there are multiple dots", () => {
    expect(titleFromFilename("hopper.nighthawks.v2.jpg")).toBe("hopper.nighthawks.v2");
  });

  it("returns the whole name unchanged when there is no extension", () => {
    expect(titleFromFilename("untitled")).toBe("untitled");
  });

  it("treats a leading-dot filename as having no extension", () => {
    expect(titleFromFilename(".scan")).toBe(".scan");
  });

  it("trims surrounding whitespace", () => {
    expect(titleFromFilename("  hopper.jpg  ")).toBe("hopper");
  });

  it("falls back to the full filename if the stem would be empty", () => {
    expect(titleFromFilename("  .jpg  ")).toBe(".jpg");
  });
});
