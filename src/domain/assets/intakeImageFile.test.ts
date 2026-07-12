import { describe, expect, it } from "vitest";
import { buildImageAsset, processImageFile } from "./intakeImageFile";
import type { ImageProcessor, ProcessedImage } from "./imageIntake";

function makeImageFile(name: string, type = "image/jpeg", size = 4): File {
  return new File([new Uint8Array(size)], name, { type });
}

// A minimal stand-in for the real (Canvas/crypto-backed) browser processor —
// same role as store.test.ts's FakeImageProcessor, kept local so this domain
// test doesn't reach into the app layer's test utilities.
class FakeImageProcessor implements ImageProcessor {
  processedFilenames: string[] = [];

  constructor(private readonly failingFilenames: ReadonlySet<string> = new Set()) {}

  async process(file: File): Promise<ProcessedImage> {
    this.processedFilenames.push(file.name);
    if (this.failingFilenames.has(file.name)) {
      throw new Error(`${file.name} could not be read as an image.`);
    }
    return {
      widthPx: 100,
      heightPx: 100,
      sha256: `sha256-${file.name}`,
      byteSize: file.size,
      original: new Blob([`original:${file.name}`]),
      display: new Blob([`display:${file.name}`]),
      thumbnail: new Blob([`thumbnail:${file.name}`])
    };
  }
}

describe("processImageFile", () => {
  it("rejects an unsupported type before ever calling the processor", async () => {
    const processor = new FakeImageProcessor();
    const result = await processImageFile(makeImageFile("bad.gif", "image/gif"), processor);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not a supported image type/);
    }
    expect(processor.processedFilenames).toEqual([]);
  });

  it("rejects an oversized file before calling the processor", async () => {
    const processor = new FakeImageProcessor();
    const hugeFile = makeImageFile("huge.jpg", "image/jpeg", 60 * 1024 * 1024);
    const result = await processImageFile(hugeFile, processor);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/too large/);
    }
    expect(processor.processedFilenames).toEqual([]);
  });

  it("returns the processed image for a valid file", async () => {
    const processor = new FakeImageProcessor();
    const result = await processImageFile(makeImageFile("good.jpg"), processor);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.processed.widthPx).toBe(100);
      expect(result.processed.sha256).toBe("sha256-good.jpg");
    }
    expect(processor.processedFilenames).toEqual(["good.jpg"]);
  });

  it("surfaces a processor throw as a failure reason instead of throwing", async () => {
    const processor = new FakeImageProcessor(new Set(["broken.jpg"]));
    const result = await processImageFile(makeImageFile("broken.jpg"), processor);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("broken.jpg could not be read as an image.");
    }
  });
});

describe("buildImageAsset", () => {
  it("derives the three blob-store keys from a single fresh asset id", async () => {
    const processor = new FakeImageProcessor();
    const result = await processImageFile(makeImageFile("piece.jpg"), processor);
    if (!result.ok) throw new Error("expected processing to succeed");

    const asset = buildImageAsset(makeImageFile("piece.jpg"), result.processed);

    expect(asset.originalKey).toBe(`${asset.id}:original`);
    expect(asset.displayKey).toBe(`${asset.id}:display`);
    expect(asset.thumbnailKey).toBe(`${asset.id}:thumbnail`);
    expect(asset.mimeType).toBe("image/jpeg");
    expect(asset.originalFilename).toBe("piece.jpg");
    expect(asset.widthPx).toBe(100);
    expect(asset.heightPx).toBe(100);
    expect(asset.sha256).toBe("sha256-piece.jpg");
  });

  it("assigns a distinct id (and therefore distinct keys) on every call", async () => {
    const processor = new FakeImageProcessor();
    const result = await processImageFile(makeImageFile("twin.jpg"), processor);
    if (!result.ok) throw new Error("expected processing to succeed");

    const first = buildImageAsset(makeImageFile("twin.jpg"), result.processed);
    const second = buildImageAsset(makeImageFile("twin.jpg"), result.processed);

    expect(first.id).not.toBe(second.id);
  });
});
