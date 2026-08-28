import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerDownload } from "./triggerDownload";

// jsdom has no File System Access API, so each picker test stubs a fake
// showSaveFilePicker on window and removes it afterward — the anchor
// fallback tests rely on it being absent again.
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "showSaveFilePicker");
  vi.restoreAllMocks();
});

function stubSavePicker() {
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const createWritable = vi.fn().mockResolvedValue({ write, close });
  const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable });
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    writable: true,
    value: showSaveFilePicker
  });
  return { showSaveFilePicker, write, close };
}

describe("triggerDownload — save picker path", () => {
  it("offers a PDF-typed filter matching the suggested name, not just the wildcard default", async () => {
    const { showSaveFilePicker } = stubSavePicker();
    const outcome = await triggerDownload(
      new Blob(["%PDF"], { type: "application/pdf" }),
      "My Show.pdf",
      { mimeType: "application/pdf", description: "PDF document" }
    );

    expect(outcome).toBe("saved");
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    const options = showSaveFilePicker.mock.calls[0][0];
    expect(options.suggestedName).toBe("My Show.pdf");
    expect(options.types).toEqual([
      {
        description: "PDF document",
        accept: { "application/pdf": [".pdf"] }
      }
    ]);
  });

  it("derives the accept map from a filename extension + explicit MIME when the caller has raw bytes", async () => {
    const { showSaveFilePicker } = stubSavePicker();
    await triggerDownload(new Uint8Array([1, 2, 3]), "project.sightlines", {
      mimeType: "application/octet-stream",
      description: "Sightlines project package"
    });

    const options = showSaveFilePicker.mock.calls[0][0];
    expect(options.types).toEqual([
      {
        description: "Sightlines project package",
        accept: { "application/octet-stream": [".sightlines"] }
      }
    ]);
  });

  it("accepts both .jpg and .jpeg spellings for a JPEG suggested name", async () => {
    const { showSaveFilePicker } = stubSavePicker();
    await triggerDownload(new Blob(["x"], { type: "image/jpeg" }), "Plan.jpg", {
      mimeType: "image/jpeg",
      description: "JPEG image"
    });

    const options = showSaveFilePicker.mock.calls[0][0];
    expect(options.types).toEqual([
      {
        description: "JPEG image",
        accept: { "image/jpeg": [".jpg", ".jpeg"] }
      }
    ]);
  });

  it("falls back to a typed Blob's own MIME when no explicit options are passed", async () => {
    const { showSaveFilePicker } = stubSavePicker();
    await triggerDownload(
      new Blob(["a,b,c"], { type: "text/csv" }),
      "checklist.csv"
    );

    const options = showSaveFilePicker.mock.calls[0][0];
    expect(options.types).toEqual([
      {
        description: "CSV file",
        accept: { "text/csv": [".csv"] }
      }
    ]);
  });
});

describe("triggerDownload — anchor fallback", () => {
  it("still names the download with the caller's filename when the picker is unavailable", async () => {
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") el.click = clickSpy;
      return el;
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:mock"),
      revokeObjectURL: vi.fn()
    });

    const outcome = await triggerDownload(
      new Blob(["%PDF"], { type: "application/pdf" }),
      "My Show.pdf"
    );

    expect(outcome).toBe("saved");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = vi.mocked(document.createElement).mock.results.find(
      (r) => r.value instanceof HTMLAnchorElement
    )?.value as HTMLAnchorElement;
    expect(anchor.download).toBe("My Show.pdf");
  });
});
