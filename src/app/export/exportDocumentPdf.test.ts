import { describe, expect, it, vi } from "vitest";
import { exportDocumentPdf } from "./exportDocumentPdf";
import type {
  CreateDocumentPdfInput,
  CreateDocumentPdfResult
} from "./createDocumentPdf";
import type { EffectiveDocumentSettings } from "../../domain/export/documentSettings";
import type { Artwork, Asset, Project, SavedView } from "../../domain/project";

const savedView: SavedView = {
  id: "v1",
  ordinal: 1,
  title: "View",
  roomId: "r1",
  pose: {
    position: { x: 1, y: 1.5, z: 2 },
    target: { x: 1, y: 1.5, z: 0 }
  },
  createdAt: "2026-07-16T00:00:00.000Z"
};

// One included wall carrying one asset-bearing work, plus one included valid
// Saved view: total = 1 image (1) + 1 view (×3) + 1 assembly = 5.
const settings: EffectiveDocumentSettings = {
  sections: {
    overview: true,
    roomPlans: false,
    elevations: true,
    threeDViews: true
  },
  rooms: [
    {
      roomId: "r1",
      name: "Room",
      planIncluded: false,
      walls: [{ wallId: "w1", name: "W1", hasWork: true, included: true }]
    }
  ],
  savedViews: [{ view: savedView, valid: true, included: true }],
  dimensions: true,
  grid: false,
  paperSize: "a4"
};

const project = {
  title: "Test",
  wallObjects: [
    {
      id: "o1",
      kind: "artwork",
      artworkId: "a1",
      wallId: "w1",
      xMm: 0,
      yMm: 0,
      widthMm: 1,
      heightMm: 1
    }
  ]
} as unknown as Project;

const artworks = [
  { id: "a1", assetId: "asset1" } as unknown as Artwork
];

const TOTAL = 5;

function successResult(
  overrides?: Partial<CreateDocumentPdfResult>
): CreateDocumentPdfResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    pageCount: 2,
    warnings: [],
    manifest: [],
    ...overrides
  };
}

function baseOptions(progress: { done: number; total: number }[]) {
  return {
    project,
    settings,
    artworks,
    getAsset: vi.fn(async () => ({}) as unknown as Asset),
    getBlob: vi.fn(async () => new Blob()),
    renderSavedView: vi.fn(async () => new Blob()),
    onProgress: (p: { done: number; total: number }) => progress.push(p)
  };
}

// A writer that exercises the wrapped callbacks in the order the real writer
// would: asset lookup, blob fetch, then the 3D render.
async function drivingWriter(
  input: CreateDocumentPdfInput
): Promise<CreateDocumentPdfResult> {
  await input.getAsset!("a1");
  await input.getBlob!("asset1");
  await input.renderSavedView!(savedView, { widthPx: 10, heightPx: 10 });
  return successResult();
}

describe("exportDocumentPdf", () => {
  it("reports monotonic progress that ends at total exactly once on success", async () => {
    const progress: { done: number; total: number }[] = [];
    const result = await exportDocumentPdf({
      ...baseOptions(progress),
      createPdf: drivingWriter
    });

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));

    // Monotonic non-decreasing.
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]!.done).toBeGreaterThanOrEqual(progress[i - 1]!.done);
    }
    // Only the final tick reaches total; nothing before it does.
    expect(progress.at(-1)).toEqual({ done: TOTAL, total: TOTAL });
    expect(
      progress.slice(0, -1).every((p) => p.done <= TOTAL - 1)
    ).toBe(true);
    expect(progress.filter((p) => p.done === TOTAL)).toHaveLength(1);
  });

  it("passes writer warnings through unchanged", async () => {
    const progress: { done: number; total: number }[] = [];
    const result = await exportDocumentPdf({
      ...baseOptions(progress),
      createPdf: async (input) => {
        await input.getBlob!("asset1");
        return successResult({ warnings: ["Image unavailable for Study."] });
      }
    });
    expect(result.warnings).toEqual(["Image unavailable for Study."]);
  });

  it("forwards fontBytes to the writer unchanged", async () => {
    const fontBytes = {
      regular: new Uint8Array([1, 2]),
      strong: new Uint8Array([3, 4])
    };
    let received: unknown;
    await exportDocumentPdf({
      ...baseOptions([]),
      fontBytes,
      createPdf: async (input) => {
        received = input.fontBytes;
        return successResult();
      }
    });
    expect(received).toBe(fontBytes);
  });

  it("rejects with AbortError and never resolves bytes when aborted before starting", async () => {
    const controller = new AbortController();
    controller.abort();
    const writer = vi.fn(async () => successResult());

    await expect(
      exportDocumentPdf({
        ...baseOptions([]),
        signal: controller.signal,
        createPdf: writer
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    // Aborted before starting: the writer is never invoked.
    expect(writer).not.toHaveBeenCalled();
  });

  it("rejects with AbortError when the signal trips during a callback", async () => {
    const controller = new AbortController();
    const progress: { done: number; total: number }[] = [];
    const options = baseOptions(progress);
    // Abort mid-fetch: the wrapped getBlob rechecks after settling and throws.
    options.getBlob = vi.fn(async () => {
      controller.abort();
      return new Blob();
    });

    let bytes: Uint8Array | undefined;
    await expect(
      exportDocumentPdf({
        ...options,
        signal: controller.signal,
        createPdf: async (input) => {
          const result = await drivingWriter(input);
          bytes = result.bytes;
          return result;
        }
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(bytes).toBeUndefined();
  });

  it("rejects when the abort lands after the writer resolves", async () => {
    const controller = new AbortController();

    await expect(
      exportDocumentPdf({
        ...baseOptions([]),
        signal: controller.signal,
        createPdf: async () => {
          // Writer finished, but the export was canceled during assembly.
          controller.abort();
          return successResult();
        }
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates a writer failure", async () => {
    await expect(
      exportDocumentPdf({
        ...baseOptions([]),
        createPdf: async () => {
          throw new Error("pdf assembly failed");
        }
      })
    ).rejects.toThrow("pdf assembly failed");
  });
});
