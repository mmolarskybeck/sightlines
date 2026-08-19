import { describe, expect, it } from "vitest";
import {
  buildChecklistImageStem,
  createFilenameAllocator,
  extensionForMimeType,
  sanitizeFilenameSegment
} from "./filenames";

describe("extensionForMimeType", () => {
  it("maps the tiers the pipeline actually produces", () => {
    expect(extensionForMimeType("image/webp")).toBe("webp");
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("image/png")).toBe("png");
  });

  it("ignores parameters and casing on the stored blob type", () => {
    expect(extensionForMimeType("IMAGE/JPEG; charset=binary")).toBe("jpg");
  });

  it("falls back rather than inventing an extension", () => {
    expect(extensionForMimeType("application/octet-stream")).toBe("bin");
  });
});

describe("sanitizeFilenameSegment", () => {
  it("folds accents to base letters instead of dropping them", () => {
    expect(sanitizeFilenameSegment("Constantin Brâncuși")).toBe("Constantin-Brancusi");
  });

  it("collapses whitespace runs and strips path separators", () => {
    expect(sanitizeFilenameSegment("The  Large   Glass / study")).toBe(
      "The-Large-Glass-study"
    );
  });

  it("trims leading and trailing punctuation", () => {
    expect(sanitizeFilenameSegment("  ...Untitled...  ")).toBe("Untitled");
  });

  it("returns empty for a segment with nothing usable in it", () => {
    expect(sanitizeFilenameSegment("？？？")).toBe("");
  });
});

describe("buildChecklistImageStem", () => {
  it("leads with the accession number when there is one", () => {
    expect(
      buildChecklistImageStem({
        accessionNumber: "1979.620.1",
        artist: "Agnes Martin",
        title: "Untitled #3",
        index: 0,
        total: 12
      })
    ).toBe("1979.620.1_Agnes-Martin_Untitled-3");
  });

  it("falls back to a zero-padded index, padded to the row count", () => {
    expect(
      buildChecklistImageStem({ artist: "Agnes Martin", index: 4, total: 1200 })
    ).toBe("0005_Agnes-Martin");
  });

  it("pads to at least three digits on a small checklist", () => {
    expect(buildChecklistImageStem({ index: 0, total: 2 })).toBe("001");
  });

  it("truncates long stems without leaving a trailing separator", () => {
    const stem = buildChecklistImageStem({
      artist: "A".repeat(60),
      title: `${"B".repeat(20)} tail`,
      index: 0,
      total: 3
    });
    expect(stem.length).toBeLessThanOrEqual(80);
    expect(stem.endsWith("-")).toBe(false);
    expect(stem.startsWith("001_")).toBe(true);
  });

  it("never returns an empty stem", () => {
    expect(buildChecklistImageStem({ artist: "？", title: "？", index: 6, total: 9 })).toBe(
      "007"
    );
  });
});

describe("createFilenameAllocator", () => {
  it("suffixes collisions in order", () => {
    const allocate = createFilenameAllocator();
    expect(allocate("work", "jpg")).toBe("work.jpg");
    expect(allocate("work", "jpg")).toBe("work-2.jpg");
    expect(allocate("work", "jpg")).toBe("work-3.jpg");
  });

  it("treats names as case-insensitive, like the filesystems these unzip onto", () => {
    const allocate = createFilenameAllocator();
    expect(allocate("Work", "jpg")).toBe("Work.jpg");
    expect(allocate("work", "jpg")).toBe("work-2.jpg");
  });

  it("keeps different extensions apart", () => {
    const allocate = createFilenameAllocator();
    expect(allocate("work", "jpg")).toBe("work.jpg");
    expect(allocate("work", "png")).toBe("work.png");
  });
});
